#!/usr/bin/env node
/**
 * VSCode 扩展打包脚本。
 *
 * 模式：
 * - deploy（默认）：用 `pnpm deploy --filter oj-agent --prod` 把 @oj-agent/core 落成真实文件再 vsce package
 * - bundle：用 esbuild 把 core 打成单文件 bundle，体积更小
 *
 * 通过 `OJA_VSCE_MODE=bundle` 环境变量切换。
 * 传 `--publish` 时会调用 vsce publish；否则只生成 .vsix。
 */

import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const VSCODE_PKG_DIR = resolve(REPO_ROOT, 'packages/vscode');
const MODE = process.env.OJA_VSCE_MODE === 'bundle' ? 'bundle' : 'deploy';
const PUBLISH = process.argv.includes('--publish');
const DRY_RUN = process.argv.includes('--dry-run');

const log = (msg) => console.log(`[vsce-package] ${msg}`);
const run = (cmd, opts = {}) => {
  log(`$ ${cmd}`);
  if (DRY_RUN) return '';
  return execSync(cmd, { stdio: 'inherit', cwd: REPO_ROOT, ...opts });
};

log(`mode=${MODE} publish=${PUBLISH} dryRun=${DRY_RUN}`);

// 1. 确保 core 与 vscode 都已构建
run('pnpm --filter @oj-agent/core build');
run('pnpm --filter oj-agent build');

if (MODE === 'deploy') {
  // 2a. pnpm deploy 把 workspace:* 解析成真实 node_modules
  const deployDir = join(VSCODE_PKG_DIR, 'dist-deploy');
  if (existsSync(deployDir)) rmSync(deployDir, { recursive: true, force: true });
  run(`pnpm deploy --filter oj-agent --prod --legacy ${deployDir}`);
  // 3a. 在 deploy 目录里跑 vsce package
  const cmd = PUBLISH
    ? `npx --yes @vscode/vsce publish ${DRY_RUN ? '--no-update-package-json' : ''}`
    : `npx --yes @vscode/vsce package --no-dependencies --out ${VSCODE_PKG_DIR}`;
  run(cmd, { cwd: deployDir });
} else {
  // 2b. esbuild 把 core 打到 dist/extension.js（单文件）
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [resolve(VSCODE_PKG_DIR, 'dist/extension.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: resolve(VSCODE_PKG_DIR, 'dist/extension.bundled.js'),
    external: ['vscode', 'playwright-core', 'keytar'],
    minify: true,
    sourcemap: true,
  });
  // 用 bundled 替换原 extension.js（vsce 仍读 dist/extension.js）
  copyFileSync(
    resolve(VSCODE_PKG_DIR, 'dist/extension.bundled.js'),
    resolve(VSCODE_PKG_DIR, 'dist/extension.js'),
  );
  // 3b. 在 vscode 目录直接 package；--no-dependencies 跳过依赖解析
  const cmd = PUBLISH
    ? `npx --yes @vscode/vsce publish --no-dependencies`
    : `npx --yes @vscode/vsce package --no-dependencies`;
  run(cmd, { cwd: VSCODE_PKG_DIR });
}

log('done.');
