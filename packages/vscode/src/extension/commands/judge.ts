import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { JudgeLang, JudgeCaseInput, JudgeRunResult } from '@oj-agent/core';
import type { OJServices } from '../oj-services.js';
import type { JudgePanelManager } from '../views/judge-panel.js';
import type { ProblemRef } from '../utils/problem-ref.js';
import { findProblemDir, inferRefFromDir } from '../utils/workspace-resolver.js';
import { resolveWorkspaceRoot } from '../oj-services.js';

const EXT_TO_LANG: Record<string, JudgeLang> = {
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  c: 'c',
  py: 'python3',
  java: 'java',
  js: 'javascript',
  mjs: 'javascript',
};

/**
 * 扫 problemDir 推断当前语言。
 *
 * 优先级：
 *   1. preferLang（调用方明确指定，如 webview 顶部当前选中的语言）—— 若该 lang 对应文件存在则采纳
 *   2. 目录里 mtime 最新的 solution.* / Main.java —— 反映用户最近在编辑的语言
 *   3. defaultLang —— 最终兜底
 *
 * 旧实现按目录返回顺序简单循环，恰好让字母序更靠前的 Main.java 抢占第一，
 * 导致用户切换语言后判题始终走 java。
 */
export async function inferLangFromDir(
  dir: string,
  defaultLang: JudgeLang,
  preferLang?: JudgeLang,
): Promise<JudgeLang> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);

  // 步骤 1：调用方明确指定的 lang 优先（文件存在才采纳）
  if (preferLang) {
    if (preferLang === 'java') {
      if (files.includes('Solution.java') || files.includes('Main.java')) return 'java';
    } else {
      const want = `solution.${LANG_TO_EXT[preferLang]}`;
      if (files.includes(want)) return preferLang;
    }
  }

  // 步骤 2：按 mtime 倒序找最近编辑过的 solution.* / Solution.java / Main.java
  const candidates: Array<{ file: string; lang: JudgeLang; mtimeMs: number }> = [];
  for (const f of files) {
    let lang: JudgeLang | undefined;
    if (f === 'Main.java' || f === 'Solution.java') lang = 'java';
    else {
      const m = f.match(/^solution\.([a-z]+)$/i);
      if (m) lang = EXT_TO_LANG[m[1]!.toLowerCase()];
    }
    if (!lang) continue;
    try {
      const st = await fs.stat(path.join(dir, f));
      candidates.push({ file: f, lang, mtimeMs: st.mtimeMs });
    } catch {
      // ignore: stat 失败则该文件不参与
    }
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]!.lang;
  }

  // 步骤 3：什么都没有，回退到 defaultLang
  return defaultLang;
}

/** EXT_TO_LANG 的反向映射，供 preferLang 路径快速取文件名。 */
const LANG_TO_EXT: Record<JudgeLang, string> = {
  cpp: 'cpp',
  c: 'c',
  python3: 'py',
  java: 'java',
  javascript: 'js',
};

/** 解析当前激活的 problemRef:优先从活跃编辑器路径推断,失败时弹窗让用户选。 */
async function resolveActiveRef(services: OJServices): Promise<{ ref: ProblemRef; dir: string } | undefined> {
  const ed = vscode.window.activeTextEditor;
  if (ed) {
    const dir = path.dirname(ed.document.uri.fsPath);
    const ref = inferRefFromDir(dir);
    if (ref) return { ref, dir };
  }
  // 兜底:从工作区根扫描所有已拉取题目
  const root = resolveWorkspaceRoot(services.configBackend);
  const entries: Array<{ label: string; description: string; ref: ProblemRef; dir: string }> = [];
  try {
    const platforms = await fs.readdir(root);
    for (const p of platforms) {
      const pdir = path.join(root, p);
      const stat = await fs.stat(pdir).catch(() => undefined);
      if (!stat?.isDirectory()) continue;
      const items = await fs.readdir(pdir).catch(() => [] as string[]);
      for (const name of items) {
        const dir = path.join(pdir, name);
        const ref = inferRefFromDir(dir);
        if (ref) entries.push({ label: `${ref.platform} ${ref.id}`, description: name, ref, dir });
      }
    }
  } catch {
    /* ignore */
  }
  if (entries.length === 0) {
    void vscode.window.showWarningMessage('未找到本地题目,请先拉取一道题。');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(entries, { placeHolder: '选择要测试的题目' });
  return pick ? { ref: pick.ref, dir: pick.dir } : undefined;
}

async function loadCases(problemDir: string): Promise<JudgeCaseInput[]> {
  const casesDir = path.join(problemDir, 'cases');
  const files = await fs.readdir(casesDir).catch(() => [] as string[]);
  const indices = new Set<number>();
  for (const f of files) {
    const m = f.match(/^in_(\d+)\.txt$/);
    if (m) indices.add(Number(m[1]));
  }
  const out: JudgeCaseInput[] = [];
  for (const n of [...indices].sort((a, b) => a - b)) {
    const input = await fs.readFile(path.join(casesDir, `in_${n}.txt`), 'utf-8').catch(() => '');
    const expected = await fs.readFile(path.join(casesDir, `out_${n}.txt`), 'utf-8').catch(() => undefined);
    out.push({ index: n, input, expected });
  }
  return out;
}

export interface JudgeCommandDeps {
  services: OJServices;
  panel: JudgePanelManager;
  /** 单次结果记忆,用于 AI explainError 与 submission.openLatest。 */
  recordResult: (ref: ProblemRef, res: JudgeRunResult) => void;
}

export function registerJudgeCommands(deps: JudgeCommandDeps): vscode.Disposable[] {
  const { services, panel, recordResult } = deps;
  const timeoutMs = () => services.configBackend.get<number>('judge.timeoutMs') ?? 3000;
  const defaultLang = () => (services.configBackend.get<JudgeLang>('ui.defaultLang') ?? 'cpp');

  async function runAll(refIn?: ProblemRef & { _preferLang?: JudgeLang }): Promise<void> {
    let target: { ref: ProblemRef; dir: string } | undefined;
    if (refIn) {
      const root = resolveWorkspaceRoot(services.configBackend);
      const dir = await findProblemDir(root, refIn);
      if (!dir) {
        void vscode.window.showWarningMessage(`未找到题目目录: ${refIn.platform}/${refIn.id}`);
        return;
      }
      target = { ref: refIn, dir };
    } else {
      target = await resolveActiveRef(services);
    }
    if (!target) return;
    const lang = await inferLangFromDir(target.dir, defaultLang(), refIn?._preferLang);
    panel.show(target.ref);
    panel.setRunning(target.ref);
    try {
      const cases = await loadCases(target.dir);
      const result = await services.judgeRunner.runAll({
        problemDir: target.dir,
        lang,
        cases,
        timeoutMs: timeoutMs(),
      });
      panel.update(target.ref, result);
      recordResult(target.ref, result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`本地测试失败: ${msg}`);
      panel.update(target.ref, { cases: [], compileError: msg });
    }
  }

  async function runCase(args?: { platform?: string; id?: string; slug?: string; caseIndex?: number; _preferLang?: JudgeLang }): Promise<void> {
    let refIn: ProblemRef | undefined;
    if (args && args.platform && args.id) {
      refIn = { platform: args.platform as ProblemRef['platform'], id: args.id, slug: args.slug };
    }
    const target = refIn
      ? (async () => {
          const root = resolveWorkspaceRoot(services.configBackend);
          const dir = await findProblemDir(root, refIn!);
          return dir ? { ref: refIn!, dir } : undefined;
        })()
      : Promise.resolve(await resolveActiveRef(services));
    const t = await target;
    if (!t) return;
    const lang = await inferLangFromDir(t.dir, defaultLang(), args?._preferLang);
    const allCases = await loadCases(t.dir);
    let chosen = allCases;
    if (typeof args?.caseIndex === 'number') {
      chosen = allCases.filter((c) => c.index === args.caseIndex);
      if (chosen.length === 0) {
        void vscode.window.showWarningMessage(`用例 #${args.caseIndex} 不存在`);
        return;
      }
    } else {
      const pick = await vscode.window.showQuickPick(
        allCases.map((c) => ({ label: `#${c.index}`, value: c.index })),
        { placeHolder: '选择要重跑的用例' },
      );
      if (!pick) return;
      chosen = allCases.filter((c) => c.index === pick.value);
    }
    panel.show(t.ref);
    panel.setRunning(t.ref);
    try {
      const res = await services.judgeRunner.runAll({
        problemDir: t.dir,
        lang,
        cases: chosen,
        timeoutMs: timeoutMs(),
      });
      panel.update(t.ref, res);
      recordResult(t.ref, res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`运行失败: ${msg}`);
    }
  }

  async function openToolchain(): Promise<void> {
    const snap = await services.toolchainProbe.probe();
    const lines: string[] = [];
    const fmt = (k: string, v: { path: string; version: string } | null): string =>
      v ? `✓ ${k}: ${v.path} (${v.version.split('\n')[0]})` : `✗ ${k}: 未安装`;
    lines.push(fmt('g++', snap.gpp));
    lines.push(fmt('clang++', snap.clangpp));
    lines.push(fmt('python3', snap.python3));
    lines.push(fmt('python', snap.python));
    lines.push(fmt('javac', snap.javac));
    lines.push(fmt('java', snap.java));
    lines.push(fmt('node', snap.node));
    const text = lines.join('\n');
    void vscode.window.showInformationMessage(text, { modal: true });
  }

  return [
    vscode.commands.registerCommand('ojAgent.judge.runAll', (args?: ProblemRef) => runAll(args)),
    vscode.commands.registerCommand('ojAgent.judge.runCase', (args?: { platform?: string; id?: string; slug?: string; caseIndex?: number }) =>
      runCase(args),
    ),
    vscode.commands.registerCommand('ojAgent.judge.openToolchain', openToolchain),
  ];
}
