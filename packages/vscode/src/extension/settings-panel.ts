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
        case 'delete':
          await this.services.profiles.remove(m.id);
          await this.services.vault.delete(m.id);
          this.toast('info', '已删除');
          await this.refresh();
          break;
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
    return /* html */ `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  h2 { margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px; border-bottom: 1px solid var(--vscode-panel-border); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 3px 8px; cursor: pointer; margin-right: 4px; font-size: 12px; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.danger { background: var(--vscode-inputValidation-errorBackground); }
  input, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 6px; width: 100%; box-sizing: border-box; }
  label { display: block; font-size: 11px; opacity: 0.8; margin-top: 6px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .badge { font-size: 10px; padding: 1px 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); margin-left: 4px; }
  #toast { position: fixed; right: 12px; bottom: 12px; padding: 6px 10px; border-radius: 4px; background: var(--vscode-notifications-background); color: var(--vscode-notifications-foreground); display: none; }
  .presets button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style></head><body>
<h2>已配置 Profile</h2>
<table><thead><tr><th>名称</th><th>Provider</th><th>Model</th><th>BaseURL</th><th>状态</th><th>操作</th></tr></thead>
<tbody id="rows"></tbody></table>

<h2 id="formTitle">新建 Profile</h2>
<input type="hidden" id="id" />
<div class="row">
  <div><label>名称 (label)</label><input id="label" placeholder="如 OpenAI GPT-4o" /></div>
  <div><label>Provider</label>
    <select id="provider"><option value="openai">openai</option><option value="anthropic">anthropic</option></select>
  </div>
</div>
<div class="row">
  <div><label>Model</label><input id="model" placeholder="如 gpt-4o / claude-sonnet-4-6" /></div>
  <div><label>Base URL（可选，缺省走官方端点）</label><input id="baseUrl" placeholder="https://api.example.com" /></div>
</div>
<div class="row">
  <div><label>API Key（保存在 SecretStorage，不写入 settings.json）</label><input id="apiKey" type="password" placeholder="留空则不更新现有 Key" /></div>
  <div><label>常用预设</label>
    <div class="presets">
      <button data-preset="openai-gpt-4o">OpenAI gpt-4o</button>
      <button data-preset="openai-mini">OpenAI gpt-4o-mini</button>
      <button data-preset="anthropic-opus">Claude Opus 4.7</button>
      <button data-preset="anthropic-sonnet">Claude Sonnet 4.6</button>
      <button data-preset="anthropic-haiku">Claude Haiku 4.5</button>
      <button data-preset="deepseek">DeepSeek</button>
      <button data-preset="openrouter">OpenRouter</button>
    </div>
  </div>
</div>
<div class="row">
  <div><label>temperature</label><input id="temperature" type="number" step="0.1" value="0.2" /></div>
  <div><label>maxOutputTokens</label><input id="maxOutputTokens" type="number" value="2048" /></div>
</div>
<div class="row">
  <div><label>maxInputTokens</label><input id="maxInputTokens" type="number" value="32000" /></div>
  <div><label>requestTimeoutMs</label><input id="requestTimeoutMs" type="number" value="60000" /></div>
</div>
<div style="margin-top: 10px;">
  <button id="save">保存</button>
  <button id="reset" class="secondary">重置表单</button>
</div>

<div id="toast"></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const PRESETS = {
    'openai-gpt-4o':    { label:'OpenAI gpt-4o',    provider:'openai',    model:'gpt-4o' },
    'openai-mini':      { label:'OpenAI gpt-4o-mini',provider:'openai',   model:'gpt-4o-mini' },
    'anthropic-opus':   { label:'Claude Opus 4.7',  provider:'anthropic', model:'claude-opus-4-7' },
    'anthropic-sonnet': { label:'Claude Sonnet 4.6',provider:'anthropic', model:'claude-sonnet-4-6' },
    'anthropic-haiku':  { label:'Claude Haiku 4.5', provider:'anthropic', model:'claude-haiku-4-5-20251001' },
    'deepseek':         { label:'DeepSeek Chat',    provider:'openai',    model:'deepseek-chat', baseUrl:'https://api.deepseek.com' },
    'openrouter':       { label:'OpenRouter',       provider:'openai',    model:'openai/gpt-4o', baseUrl:'https://openrouter.ai/api' },
  };
  document.querySelectorAll('button[data-preset]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const p = PRESETS[b.dataset.preset];
      if (!p) return;
      $('label').value = p.label; $('provider').value = p.provider;
      $('model').value = p.model; $('baseUrl').value = p.baseUrl || '';
    });
  });

  function readDraft() {
    return {
      id: $('id').value || undefined,
      label: $('label').value, provider: $('provider').value,
      model: $('model').value,
      baseUrl: $('baseUrl').value.trim() || undefined,
      temperature: Number($('temperature').value),
      maxOutputTokens: Number($('maxOutputTokens').value),
      maxInputTokens: Number($('maxInputTokens').value),
      requestTimeoutMs: Number($('requestTimeoutMs').value),
    };
  }
  function resetForm() {
    $('id').value=''; $('label').value=''; $('provider').value='openai';
    $('model').value=''; $('baseUrl').value=''; $('apiKey').value='';
    $('temperature').value='0.2'; $('maxOutputTokens').value='2048';
    $('maxInputTokens').value='32000'; $('requestTimeoutMs').value='60000';
    $('formTitle').textContent='新建 Profile';
  }
  $('save').onclick = () => {
    const draft = readDraft();
    const apiKey = $('apiKey').value || undefined;
    vscode.postMessage({ kind: 'save', draft, apiKey });
    $('apiKey').value = '';
  };
  $('reset').onclick = resetForm;

  function rowHTML(r) {
    return '<tr>' +
      '<td>' + escape(r.label) + (r.active ? '<span class="badge">活动</span>' : '') + '</td>' +
      '<td>' + escape(r.provider) + '</td>' +
      '<td>' + escape(r.model) + '</td>' +
      '<td>' + escape(r.baseUrl || '(官方)') + '</td>' +
      '<td>' + (r.hasKey ? 'Key: sk-****' : '<i>未配置 Key</i>') + '</td>' +
      '<td>' +
        '<button data-act="edit" data-id="' + r.id + '">编辑</button>' +
        '<button data-act="setActive" data-id="' + r.id + '">设为活动</button>' +
        '<button data-act="test" data-id="' + r.id + '" class="secondary">测试连接</button>' +
        '<button data-act="clearKey" data-id="' + r.id + '" class="secondary">清除 Key</button>' +
        '<button data-act="delete" data-id="' + r.id + '" class="danger">删除</button>' +
      '</td></tr>';
  }
  function escape(s) { return String(s || '').replace(/[<>&"]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  let lastRows = [];
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.kind === 'list') {
      lastRows = m.rows;
      $('rows').innerHTML = m.rows.map(rowHTML).join('') || '<tr><td colspan=6><i>暂无 Profile</i></td></tr>';
      document.querySelectorAll('#rows button').forEach((b) => {
        b.addEventListener('click', () => {
          const id = b.dataset.id; const act = b.dataset.act;
          if (act === 'edit') {
            const r = m.rows.find((x) => x.id === id); if (!r) return;
            $('id').value = r.id; $('label').value = r.label;
            $('provider').value = r.provider; $('model').value = r.model;
            $('baseUrl').value = r.baseUrl || '';
            $('formTitle').textContent = '编辑 Profile: ' + r.label;
          } else if (act === 'delete') {
            if (confirm('删除该 Profile？')) vscode.postMessage({ kind: 'delete', id });
          } else {
            vscode.postMessage({ kind: act, id });
          }
        });
      });
    } else if (m.kind === 'toast') {
      const t = $('toast'); t.textContent = m.text; t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 2500);
    }
  });
  vscode.postMessage({ kind: 'refresh' });
</script></body></html>`;
  }
}
