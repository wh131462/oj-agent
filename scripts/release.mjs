#!/usr/bin/env node
/**
 * 统一发布脚本：core / cli / vscode 三个产物一次性发布。
 *
 * 流程：
 *   1. 校验三个 package.json 版本号一致
 *   2. pnpm -r build
 *   3. pnpm -r test  (排除 vscode，因为 vscode 包没有 test 脚本)
 *   4. 各包 npm publish --dry-run（dry-run 模式则到此为止）
 *   5. 真发布：pnpm -r publish + scripts/vsce-package.mjs --publish
 *
 * 任一步失败立即停止并打印回滚指引。
 *
 * 用法：
 *   node scripts/release.mjs --dry-run    # 演练
 *   node scripts/release.mjs              # 真发布（需提前 npm login + vsce login）
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

const log = (msg) => console.log(`[release] ${msg}`);
const err = (msg) => console.error(`[release][ERROR] ${msg}`);
const run = (cmd, opts = {}) => {
  log(`$ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: REPO_ROOT, ...opts });
};

const pkgs = [
  { name: '@oj-agent/core', path: 'packages/core' },
  { name: '@oj-agent/cli', path: 'packages/cli' },
  { name: 'oj-agent', path: 'packages/vscode' },
];

function readVersion(p) {
  const json = JSON.parse(readFileSync(resolve(REPO_ROOT, p, 'package.json'), 'utf8'));
  return json.version;
}

// --- step 1: version consistency ---
log('step 1: 校验版本一致性');
const versions = pkgs.map((p) => ({ ...p, version: readVersion(p.path) }));
for (const p of versions) log(`  ${p.name.padEnd(24)} ${p.version}`);
const uniq = new Set(versions.map((p) => p.version));
if (uniq.size > 1) {
  err(`版本号不一致: ${[...uniq].join(' / ')}; 请用 \`pnpm -r exec npm version <ver>\` 统一后重试`);
  process.exit(1);
}
const VERSION = versions[0].version;
log(`版本一致: ${VERSION}`);

// --- step 2: build & test ---
log('step 2: 构建 & 测试');
try {
  run('pnpm -r build');
  run('pnpm --filter @oj-agent/core --filter @oj-agent/cli test');
} catch (e) {
  err('构建或测试失败，发布中止');
  process.exit(1);
}

// --- step 3: dry-run npm publish for core/cli ---
log('step 3: npm publish --dry-run');
try {
  run('pnpm --filter @oj-agent/core publish --dry-run --no-git-checks --registry https://registry.npmjs.com');
  run('pnpm --filter @oj-agent/cli publish --dry-run --no-git-checks --registry https://registry.npmjs.com');
} catch (e) {
  err('npm dry-run 失败，发布中止（包名冲突 / 元数据缺失？）');
  process.exit(1);
}

// --- step 4: dry-run vsce package ---
log('step 4: vsce package --dry-run');
try {
  run('node scripts/vsce-package.mjs --dry-run');
} catch (e) {
  err('vsce dry-run 失败，发布中止');
  process.exit(1);
}

if (DRY_RUN) {
  log(`✓ dry-run 全部通过 (version=${VERSION})`);
  process.exit(0);
}

// --- step 5: 真发布 ---
log('step 5: 真发布开始');

function isNpmPublished(pkgName, version) {
  try {
    const result = execSync(
      `npm view ${pkgName}@${version} version --registry https://registry.npmjs.com 2>/dev/null`,
      { encoding: 'utf8', cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return result === version;
  } catch {
    return false;
  }
}

log('  5a. pnpm publish (npm)');
const npmPkgs = [
  { filter: '@oj-agent/core', name: '@oj-agent/core' },
  { filter: '@oj-agent/cli', name: '@oj-agent/cli' },
];
let npmAllSkipped = true;
for (const pkg of npmPkgs) {
  if (isNpmPublished(pkg.name, VERSION)) {
    log(`  跳过 ${pkg.name}@${VERSION}（已发布）`);
    continue;
  }
  npmAllSkipped = false;
  try {
    run(`pnpm --filter ${pkg.filter} publish --no-git-checks --access public --registry https://registry.npmjs.com`);
  } catch (e) {
    err(`npm 发布失败: ${pkg.name}`);
    err('回滚指引：已发布的版本无法删除，仅能 npm deprecate <pkg>@<ver> 后发修复版');
    process.exit(1);
  }
}
if (npmAllSkipped) log('  所有 npm 包均已发布，跳过');

log('  5b. vsce publish (Marketplace)');
try {
  run('node scripts/vsce-package.mjs --publish');
} catch (e) {
  err('vsce 发布失败');
  err('回滚指引：可在 Marketplace 控制台下架 .vsix；npm 已发布，下次发版时同步');
  process.exit(1);
}

log(`✓ 发布完成 (version=${VERSION})`);
