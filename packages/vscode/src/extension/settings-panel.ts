import * as vscode from 'vscode';
import type { AIServices } from './services.js';
import type { AIProfile, AIProvider } from '@oj-agent/core';
import { looksLikeApiKey, normalizeBaseUrl } from '@oj-agent/core';

interface ProfileViewRow {
  id: string;
  label: string;
  provider: AIProvider;
  baseUrl?: string;
  model: string;
  hasKey: boolean;
  active: boolean;
}

type MsgIn =
  | { kind: 'refresh' }
  | { kind: 'save'; draft: Partial<AIProfile>; apiKey?: string }
  | { kind: 'delete'; id: string }
  | { kind: 'setActive'; id: string }
  | { kind: 'clearKey'; id: string }
  | { kind: 'test'; id: string };

type MsgOut =
  | { kind: 'list'; rows: ProfileViewRow[] }
  | { kind: 'toast'; level: 'info' | 'warn' | 'error'; text: string };

export class SettingsPanel {
  private static current?: SettingsPanel;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(private readonly ctx: vscode.ExtensionContext, private readonly services: AIServices) {
    this.panel = vscode.window.createWebviewPanel(
      'ojAgent.aiSettings',
      'OJ-Agent · AI 模型设置',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((m: MsgIn) => this.onMessage(m), null, this.disposables);
    this.refresh();
  }

  static show(ctx: vscode.ExtensionContext, services: AIServices): SettingsPanel {
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal();
      return SettingsPanel.current;
    }
    SettingsPanel.current = new SettingsPanel(ctx, services);
    return SettingsPanel.current;
  }

  private async refresh(): Promise<void> {
    const activeId = this.services.profiles.getActiveId();
    const rows: ProfileViewRow[] = [];
    for (const p of this.services.profiles.list()) {
      rows.push({
        id: p.id,
        label: p.label,
        provider: p.provider,
        baseUrl: p.baseUrl,
        model: p.model,
        hasKey: await this.services.vault.has(p.id),
        active: p.id === activeId,
      });
    }
    this.post({ kind: 'list', rows });
  }

  private async onMessage(m: MsgIn): Promise<void> {
    try {
      switch (m.kind) {
        case 'refresh':
          await this.refresh();
          break;
        case 'save': {
          if (m.apiKey && (looksLikeApiKey(m.draft.model) || looksLikeApiKey(m.draft.label))) {
            this.toast('warn', 'model/label 疑似 API Key，请检查');
          }
          if (m.draft.baseUrl) m.draft.baseUrl = normalizeBaseUrl(m.draft.baseUrl);
          let id = m.draft.id;
          let warns: string[] = [];
          if (id) {
            const r = await this.services.profiles.update(id, m.draft);
            warns = r.warnings;
          } else {
            const r = await this.services.profiles.add(m.draft);
            id = r.profile.id;
            warns = r.warnings;
          }
          if (m.apiKey && id) await this.services.vault.set(id, m.apiKey);
          for (const w of warns) this.toast('warn', w);
          this.toast('info', '已保存');
          await this.refresh();
          break;
        }
        case 'delete': {
          const target = this.services.profiles.list().find((p) => p.id === m.id);
          const confirm = await vscode.window.showWarningMessage(
            `确认删除 Profile "${target?.label ?? m.id}"？同时会清除其 API Key。`,
            { modal: true },
            '删除',
          );
          if (confirm !== '删除') return;
          await this.services.profiles.remove(m.id);
          await this.services.vault.delete(m.id);
          this.toast('info', '已删除');
          await this.refresh();
          break;
        }
        case 'setActive':
          await this.services.profiles.setActive(m.id);
          this.toast('info', '已切换活动 Profile');
          await this.refresh();
          break;
        case 'clearKey':
          await this.services.vault.delete(m.id);
          this.toast('info', '已清除 API Key');
          await this.refresh();
          break;
        case 'test':
          await this.services.profiles.setActive(m.id);
          await vscode.commands.executeCommand('ojAgent.ai.testConnection');
          break;
      }
    } catch (e) {
      this.toast('error', e instanceof Error ? e.message : String(e));
    }
  }

  private post(msg: MsgOut): void {
    void this.panel.webview.postMessage(msg);
  }

  private toast(level: 'info' | 'warn' | 'error', text: string): void {
    this.post({ kind: 'toast', level, text });
  }

  private dispose(): void {
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    SettingsPanel.current = undefined;
  }

  private html(): string {
    const nonce = Math.random().toString(36).slice(2);
    return /* html */ `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --fg: var(--vscode-foreground);
    --fg-muted: var(--vscode-descriptionForeground);
    --bg: var(--vscode-editor-background);
    --bg-input: var(--vscode-input-background);
    --bg-hover: var(--vscode-list-hoverBackground, rgba(128,128,128,0.08));
    --border: var(--vscode-widget-border, rgba(128,128,128,0.18));
    --focus: var(--vscode-focusBorder);
    --error: var(--vscode-errorForeground);
    --easy:   #4ade80;
  }
  body {
    font-family: var(--vscode-font-family);
    color: var(--fg);
    background: var(--bg);
    padding: 28px 32px 48px;
    max-width: 820px;
    margin: 0 auto;
    font-size: 13px;
    line-height: 1.6;
  }

  /* ── Page Header ── */
  .page-header { margin-bottom: 24px; }
  .page-header h1 {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.3px;
    margin-bottom: 6px;
  }
  .page-header p { font-size: 12px; color: var(--fg-muted); }

  /* ── Section ── */
  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    margin-bottom: 8px;
  }

  /* ── Profile Rows ── */
  #profileList { margin-bottom: 28px; }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 4px;
    border: 1px solid transparent;
    cursor: default;
  }
  .row:hover { background: var(--bg-hover); }
  .row + .row { margin-top: 2px; }
  .row .dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    border: 1.5px solid var(--fg-muted);
    flex-shrink: 0;
  }
  .row.active .dot {
    background: var(--easy);
    border-color: var(--easy);
  }
  .row .info { flex: 1; min-width: 0; }
  .row .name {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
  }
  .row .meta {
    font-size: 11px;
    color: var(--fg-muted);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row .meta.warn { color: var(--error); }
  .row .actions { display: flex; gap: 2px; flex-shrink: 0; }
  .empty {
    padding: 18px 12px;
    color: var(--fg-muted);
    font-size: 12px;
    font-style: italic;
  }

  /* ── Buttons ── */
  button {
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--fg);
    padding: 4px 10px;
    border-radius: 3px;
    transition: background 0.12s;
  }
  button:hover:not(:disabled) { background: var(--bg-hover); }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    padding: 6px 16px;
    font-weight: 500;
  }
  button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button.danger { color: var(--error); }
  button.danger:hover:not(:disabled) { background: rgba(248,113,113,0.08); }

  /* ── Form ── */
  .form-section { margin-top: 8px; }
  .form-section h2 {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 18px;
  }
  .presets .label {
    font-size: 12px;
    color: var(--fg-muted);
    margin-right: 4px;
    align-self: center;
  }
  .preset-btn {
    font-size: 11px;
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--fg-muted);
    background: transparent;
  }
  .preset-btn:hover { color: var(--fg); border-color: var(--focus); background: var(--bg-hover); }

  .form-grid { display: grid; gap: 14px 16px; grid-template-columns: 1fr 1fr; }
  .form-grid .full { grid-column: 1 / -1; }
  .form-group label {
    display: block;
    font-size: 12px;
    color: var(--fg);
    margin-bottom: 4px;
  }
  .form-group .hint {
    font-size: 11px;
    color: var(--fg-muted);
    margin-top: 4px;
  }
  .form-group input,
  .form-group select {
    width: 100%;
    background: var(--bg-input);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 5px 8px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }
  .form-group input:focus,
  .form-group select:focus {
    border-color: var(--focus);
  }
  .form-group select {
    appearance: none;
    -webkit-appearance: none;
    padding-right: 28px;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><path d='M4 6l4 4 4-4'/></svg>");
    background-repeat: no-repeat;
    background-position: right 8px center;
    background-size: 12px 12px;
    cursor: pointer;
  }

  /* ── Custom dropdown (replaces native select for nicer popup) ── */
  .dropdown { position: relative; }
  .dropdown-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--bg-input);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 5px 8px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    outline: none;
    text-align: left;
  }
  .dropdown-trigger:hover { border-color: var(--focus); }
  .dropdown.open .dropdown-trigger { border-color: var(--focus); }
  .dropdown-trigger .chevron {
    width: 12px; height: 12px;
    flex-shrink: 0;
    opacity: 0.7;
    transition: transform 0.15s;
  }
  .dropdown.open .dropdown-trigger .chevron { transform: rotate(180deg); }
  .dropdown-menu {
    display: none;
    position: absolute;
    left: 0; right: 0;
    top: calc(100% + 4px);
    background: var(--vscode-menu-background, var(--bg));
    color: var(--vscode-menu-foreground, var(--fg));
    border: 1px solid var(--vscode-menu-border, var(--border));
    border-radius: 4px;
    box-shadow: 0 6px 16px rgba(0,0,0,0.32);
    padding: 4px;
    z-index: 20;
    max-height: 240px;
    overflow-y: auto;
  }
  .dropdown.open .dropdown-menu { display: block; }
  .dropdown-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 5px 10px;
    border: none;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    border-radius: 3px;
  }
  .dropdown-item:hover {
    background: var(--vscode-menu-selectionBackground, var(--bg-hover));
    color: var(--vscode-menu-selectionForeground, inherit);
  }
  .dropdown-item.selected {
    background: var(--bg-hover);
  }

  /* ── Advanced collapsible ── */
  details.advanced { margin-top: 14px; }
  details.advanced > summary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
    color: var(--fg-muted);
    padding: 6px 0;
    user-select: none;
    list-style: none;
  }
  details.advanced > summary::-webkit-details-marker { display: none; }
  details.advanced > summary .chevron {
    width: 12px; height: 12px;
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  details.advanced[open] > summary .chevron { transform: rotate(90deg); }
  details.advanced > summary:hover { color: var(--fg); }
  details.advanced .form-grid { margin-top: 10px; grid-template-columns: 1fr 1fr 1fr; }

  .form-actions { display: flex; gap: 8px; margin-top: 20px; align-items: center; }

  /* ── Toast ── */
  #toast {
    position: fixed;
    right: 20px;
    bottom: 20px;
    padding: 8px 14px;
    border-radius: 3px;
    font-size: 12px;
    display: none;
    z-index: 100;
    border: 1px solid var(--border);
    background: var(--vscode-notifications-background, var(--bg));
    color: var(--fg);
    max-width: 320px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }
  #toast.warn  { border-color: rgba(251,191,36,0.4); }
  #toast.error { border-color: rgba(248,113,113,0.4); color: var(--error); }
</style></head><body>

<div class="page-header">
  <h1>AI 模型配置</h1>
  <p>管理用于解题辅助的模型 Profile。API Key 仅存于 VS Code SecretStorage，不写入 settings.json。</p>
</div>

<p class="section-label">已配置 Profile</p>
<div id="profileList"><div class="empty">暂无 Profile，请在下方新建</div></div>

<div class="form-section">
  <h2 id="formTitle">新建 Profile</h2>
  <input type="hidden" id="id" />

  <div class="presets">
    <span class="label">从模板：</span>
    <span id="presets"></span>
  </div>

  <div class="form-grid">
    <div class="form-group">
      <label for="label">名称</label>
      <input id="label" placeholder="e.g. GPT-4o · Daily" />
    </div>
    <div class="form-group">
      <label for="providerTrigger">提供商</label>
      <div class="dropdown" id="providerDropdown">
        <button type="button" class="dropdown-trigger" id="providerTrigger" aria-haspopup="listbox" aria-expanded="false">
          <span id="providerLabel">openai (ChatCompletion)</span>
          <svg class="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>
        </button>
        <div class="dropdown-menu" role="listbox">
          <button type="button" class="dropdown-item" data-value="openai">openai (ChatCompletion)</button>
          <button type="button" class="dropdown-item" data-value="anthropic">anthropic (Messages)</button>
        </div>
        <input type="hidden" id="provider" value="openai" />
      </div>
    </div>
    <div class="form-group">
      <label for="model">模型 ID</label>
      <input id="model" placeholder="gpt-4o / claude-sonnet-4-6" />
    </div>
    <div class="form-group">
      <label for="baseUrl">Base URL</label>
      <input id="baseUrl" placeholder="留空使用官方端点" />
    </div>
    <div class="form-group full">
      <label for="apiKey">API Key</label>
      <input id="apiKey" type="password" placeholder="留空则不更新现有 Key" autocomplete="off" />
      <div class="hint">保存到 VS Code SecretStorage，不写入任何文件</div>
    </div>
  </div>

  <details class="advanced">
    <summary>
      <svg class="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>
      高级参数
    </summary>
    <div class="form-grid">
      <div class="form-group">
        <label for="temperature">temperature</label>
        <input id="temperature" type="number" step="0.1" min="0" max="2" value="0.2" />
      </div>
      <div class="form-group">
        <label for="maxOutputTokens">maxOutputTokens</label>
        <input id="maxOutputTokens" type="number" min="1" value="2048" />
      </div>
      <div class="form-group">
        <label for="requestTimeoutMs">timeoutMs</label>
        <input id="requestTimeoutMs" type="number" min="1000" value="60000" />
      </div>
    </div>
  </details>

  <div class="form-actions">
    <button class="primary" id="save">保存</button>
    <button id="reset">重置</button>
  </div>
</div>

<div id="toast"></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  const PRESETS = [
    { label: 'OpenAI gpt-4o',     provider: 'openai',    model: 'gpt-4o' },
    { label: 'gpt-4o-mini',       provider: 'openai',    model: 'gpt-4o-mini' },
    { label: 'Claude Opus 4.7',   provider: 'anthropic', model: 'claude-opus-4-7' },
    { label: 'Claude Sonnet 4.6', provider: 'anthropic', model: 'claude-sonnet-4-6' },
    { label: 'Claude Haiku 4.5',  provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    { label: 'DeepSeek Chat',     provider: 'openai',    model: 'deepseek-chat',  baseUrl: 'https://api.deepseek.com' },
    { label: 'OpenRouter',        provider: 'openai',    model: 'openai/gpt-4o', baseUrl: 'https://openrouter.ai/api' },
  ];

  const presetsEl = $('presets');
  PRESETS.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.type = 'button';
    btn.textContent = p.label;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      $('label').value = p.label;
      setProvider(p.provider);
      $('model').value = p.model;
      $('baseUrl').value = p.baseUrl || '';
    });
    presetsEl.appendChild(btn);
  });

  // ── Provider dropdown ──
  const PROVIDER_LABELS = {
    openai: 'openai (ChatCompletion)',
    anthropic: 'anthropic (Messages)',
  };
  const providerDropdown = $('providerDropdown');
  const providerTrigger = $('providerTrigger');
  const providerLabelEl = $('providerLabel');
  function setProvider(value) {
    $('provider').value = value;
    providerLabelEl.textContent = PROVIDER_LABELS[value] || value;
    providerDropdown.querySelectorAll('.dropdown-item').forEach((b) => {
      b.classList.toggle('selected', b.dataset.value === value);
    });
  }
  providerTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = providerDropdown.classList.toggle('open');
    providerTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  providerDropdown.querySelectorAll('.dropdown-item').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setProvider(b.dataset.value);
      providerDropdown.classList.remove('open');
      providerTrigger.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('click', () => {
    providerDropdown.classList.remove('open');
    providerTrigger.setAttribute('aria-expanded', 'false');
  });
  setProvider('openai');

  function readDraft() {
    return {
      id: $('id').value || undefined,
      label: $('label').value,
      provider: $('provider').value,
      model: $('model').value,
      baseUrl: $('baseUrl').value.trim() || undefined,
      temperature: Number($('temperature').value),
      maxOutputTokens: Number($('maxOutputTokens').value),
      maxInputTokens: 32000,
      requestTimeoutMs: Number($('requestTimeoutMs').value),
    };
  }

  function resetForm() {
    $('id').value = '';
    $('label').value = '';
    $('provider').value = 'openai';
    setProvider('openai');
    $('model').value = '';
    $('baseUrl').value = '';
    $('apiKey').value = '';
    $('temperature').value = '0.2';
    $('maxOutputTokens').value = '2048';
    $('requestTimeoutMs').value = '60000';
    $('formTitle').textContent = '新建 Profile';
  }

  $('save').onclick = () => {
    const draft = readDraft();
    const apiKey = $('apiKey').value || undefined;
    vscode.postMessage({ kind: 'save', draft, apiKey });
    $('apiKey').value = '';
  };
  $('reset').onclick = resetForm;

  function esc(s) {
    return String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }

  function renderRow(r) {
    const div = document.createElement('div');
    div.className = 'row' + (r.active ? ' active' : '');
    const metaParts = [esc(r.provider), esc(r.model)];
    if (r.baseUrl) metaParts.push(esc(r.baseUrl));
    const metaCls = r.hasKey ? 'meta' : 'meta warn';
    const metaSuffix = r.hasKey ? '' : ' · 未配置 Key';
    div.innerHTML =
      '<span class="dot" title="' + (r.active ? '当前激活' : '点击激活') + '"></span>' +
      '<div class="info">' +
        '<div class="name">' + esc(r.label) + '</div>' +
        '<div class="' + metaCls + '">' + metaParts.join(' · ') + metaSuffix + '</div>' +
      '</div>' +
      '<div class="actions">' +
        (!r.active ? '<button data-act="setActive" data-id="' + esc(r.id) + '" title="设为当前激活">激活</button>' : '') +
        '<button data-act="test" data-id="' + esc(r.id) + '" title="测试连接">测试</button>' +
        '<button data-act="edit" data-id="' + esc(r.id) + '" title="编辑">编辑</button>' +
        (r.hasKey ? '<button data-act="clearKey" data-id="' + esc(r.id) + '" title="清除已保存的 Key">清除 Key</button>' : '') +
        '<button class="danger" data-act="delete" data-id="' + esc(r.id) + '" title="删除">删除</button>' +
      '</div>';
    return div;
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.kind === 'list') {
      const listEl = $('profileList');
      listEl.innerHTML = '';
      if (m.rows.length === 0) {
        listEl.innerHTML = '<div class="empty">暂无 Profile，请在下方新建</div>';
      } else {
        m.rows.forEach((r) => {
          const row = renderRow(r);
          row.querySelectorAll('button[data-act]').forEach((b) => {
            b.addEventListener('click', (e) => {
              e.stopPropagation();
              const id = b.dataset.id;
              const act = b.dataset.act;
              if (act === 'edit') {
                const found = m.rows.find((x) => x.id === id);
                if (!found) return;
                $('id').value = found.id;
                $('label').value = found.label;
                $('provider').value = found.provider;
                setProvider(found.provider);
                $('model').value = found.model;
                $('baseUrl').value = found.baseUrl || '';
                $('formTitle').textContent = '编辑：' + found.label;
                document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth' });
              } else if (act === 'delete') {
                vscode.postMessage({ kind: 'delete', id });
              } else {
                vscode.postMessage({ kind: act, id });
              }
            });
          });
          // Click row dot/info area to activate
          if (!r.active) {
            row.querySelector('.dot').style.cursor = 'pointer';
            row.querySelector('.dot').addEventListener('click', () => {
              vscode.postMessage({ kind: 'setActive', id: r.id });
            });
          }
          listEl.appendChild(row);
        });
      }
    } else if (m.kind === 'toast') {
      showToast(m.level, m.text);
    }
  });

  function showToast(level, text) {
    const t = $('toast');
    t.textContent = text;
    t.className = level;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.display = 'none'; }, 2800);
  }

  vscode.postMessage({ kind: 'refresh' });
</script></body></html>`;
  }
}
