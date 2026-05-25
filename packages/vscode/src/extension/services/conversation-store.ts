import * as vscode from 'vscode';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  topic: string;
  systemPrompt: string;
  messages: ChatMessage[];
  profileId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  topic: string;
  updatedAt: number;
}

const STORE_KEY = 'ai.conversations';
const MAX_CONVERSATIONS = 50;
const FLUSH_DEBOUNCE_MS = 200;

function toSummary(c: Conversation): ConversationSummary {
  return { id: c.id, title: c.title, topic: c.topic, updatedAt: c.updatedAt };
}

function genId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export type ConversationsChangeListener = () => void;

export class ConversationStore {
  private items: Conversation[];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<ConversationsChangeListener>();

  constructor(private readonly memento: vscode.Memento) {
    const raw = memento.get<Conversation[]>(STORE_KEY);
    this.items = Array.isArray(raw) ? raw : [];
  }

  onChange(fn: ConversationsChangeListener): vscode.Disposable {
    this.listeners.add(fn);
    return { dispose: () => this.listeners.delete(fn) };
  }

  list(): ConversationSummary[] {
    return [...this.items]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toSummary);
  }

  get(id: string): Conversation | undefined {
    const c = this.items.find((x) => x.id === id);
    return c ? structuredClone(c) : undefined;
  }

  latest(): Conversation | undefined {
    if (this.items.length === 0) return undefined;
    let best = this.items[0]!;
    for (const c of this.items) if (c.updatedAt > best.updatedAt) best = c;
    return structuredClone(best);
  }

  create(draft: {
    title?: string;
    topic?: string;
    systemPrompt: string;
    profileId: string;
  }): Conversation {
    const now = Date.now();
    const conv: Conversation = {
      id: genId(),
      title: draft.title?.trim() || '新对话',
      topic: draft.topic ?? '',
      systemPrompt: draft.systemPrompt,
      messages: [],
      profileId: draft.profileId,
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(conv);
    this.evictIfNeeded();
    this.scheduleFlush();
    this.emit();
    return structuredClone(conv);
  }

  update(id: string, patch: Partial<Pick<Conversation, 'title' | 'topic' | 'systemPrompt' | 'profileId'>>): void {
    const c = this.items.find((x) => x.id === id);
    if (!c) return;
    if (patch.title !== undefined) c.title = patch.title;
    if (patch.topic !== undefined) c.topic = patch.topic;
    if (patch.systemPrompt !== undefined) c.systemPrompt = patch.systemPrompt;
    if (patch.profileId !== undefined) c.profileId = patch.profileId;
    c.updatedAt = Date.now();
    this.scheduleFlush();
    this.emit();
  }

  setTitle(id: string, title: string): void {
    this.update(id, { title: title.trim() || '新对话' });
  }

  appendMessage(id: string, msg: ChatMessage): void {
    const c = this.items.find((x) => x.id === id);
    if (!c) return;
    c.messages.push({ role: msg.role, content: msg.content });
    c.updatedAt = Date.now();
    // 标题：若仍是默认且这是第一条 user 消息，自动用前 20 字
    if ((c.title === '新对话' || c.title === '') && msg.role === 'user') {
      const text = msg.content.trim().replace(/\s+/g, ' ');
      if (text) c.title = text.length > 20 ? text.slice(0, 20) + '…' : text;
    }
    this.scheduleFlush();
    this.emit();
  }

  clearMessages(id: string): void {
    const c = this.items.find((x) => x.id === id);
    if (!c) return;
    c.messages = [];
    c.updatedAt = Date.now();
    this.scheduleFlush();
    this.emit();
  }

  remove(id: string): void {
    const idx = this.items.findIndex((x) => x.id === id);
    if (idx === -1) return;
    this.items.splice(idx, 1);
    this.scheduleFlush();
    this.emit();
  }

  private evictIfNeeded(): void {
    if (this.items.length <= MAX_CONVERSATIONS) return;
    this.items.sort((a, b) => a.updatedAt - b.updatedAt);
    while (this.items.length > MAX_CONVERSATIONS) this.items.shift();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    try {
      await this.memento.update(STORE_KEY, this.items);
    } catch {
      /* ignore persistence errors; in-memory state remains usable */
    }
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* ignore listener errors */
      }
    }
  }
}
