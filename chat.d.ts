export const DEFAULT_CHAT_HOST: string;
export const CHAT_EVENTS: readonly string[];
export const TYPING_SHOW_MS: number;

export interface ChatMember {
  user_id: string;
  read_seq: number;
  role?: string;
}

export interface ChatConversation {
  id: string;
  name?: string;
  metadata?: Record<string, unknown>;
  members: ChatMember[];
  last_seq: number;
  created_at: string;
  updated_at: string;
  /** In conversation lists: messages after the user's read_seq that are not system messages. */
  unread?: number;
}

export interface ChatAttachment {
  id: string;
  name: string;
  content_type: string;
  size?: number;
  /** A download link, valid for an hour. */
  url?: string;
}

export interface ChatMessage {
  id: string;
  seq: number;
  /** The sender's user ID; absent on system messages. */
  sender?: string;
  name?: string;
  /** "text", or "system" for messages your server posts. */
  kind?: string;
  text: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  edited_at?: string;
  deleted_at?: string;
  /** Each emoji and the members who reacted, in order. */
  reactions?: Record<string, string[]>;
  attachments?: ChatAttachment[];
  visible_to?: string[];
  /** The language text was written in. */
  language?: string;
  /** The text translated, by BCP 47 language tag. */
  translations?: Record<string, string>;
}

export interface ChatReport {
  id: string;
  conversation_id: string;
  seq: number;
  reported_by: string;
  reason: string;
  message: ChatMessage;
}

export interface SendInput {
  text?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  attachments?: Pick<ChatAttachment, 'id' | 'name' | 'content_type'>[];
  visible_to?: string[];
}

/** A Blob, or what an image or document picker returns. */
export type UploadFile = Blob | { uri: string; name?: string; type?: string; size?: number };

export interface ChatClientOptions {
  /** The Hibira app ID. */
  appId: string;
  /** The user token, or a function returning one; called again before it expires and after a 401. */
  token?: string | (() => string | Promise<string>);
  /** Instead of token: a URL on your server that answers { token }. */
  tokenUrl?: string;
  /** A pusher-js client signed in as the user (pusher.signin()), for live events. */
  pusher?: unknown;
  /** The HTTP API host (default api.hibira.io); may include http://. */
  host?: string;
  fetch?: typeof fetch;
}

type Opts = { signal?: AbortSignal };
export type ChatEventHandler = (event: string, data: any) => void;

export interface ChatClient {
  /** The token's user (sub), once a token is known. */
  user(): string;
  currentUser(): Promise<string>;
  conversations(options?: { limit?: number; before?: string } & Opts): Promise<{ conversations: ChatConversation[]; next: string }>;
  conversation(id: string, options?: Opts): Promise<ChatConversation>;
  messages(id: string, options?: { after?: number; last?: number; limit?: number } & Opts): Promise<{ messages: ChatMessage[]; last_seq: number }>;
  search(id: string, q: string, options?: { before?: number | string; limit?: number } & Opts): Promise<{ messages: ChatMessage[]; next: string }>;
  send(id: string, message: string | SendInput): Promise<{ message: ChatMessage; push?: { users: number; error?: string } }>;
  edit(id: string, seq: number, change: string | { text?: string; metadata?: Record<string, unknown> }): Promise<ChatMessage>;
  remove(id: string, seq: number): Promise<ChatMessage>;
  react(id: string, seq: number, emoji: string, on?: boolean): Promise<ChatMessage>;
  report(id: string, seq: number, reason?: string): Promise<ChatReport>;
  read(id: string, seq: number): Promise<{ read_seq: number }>;
  typing(id: string, typing?: boolean): Promise<unknown>;
  translate(id: string, seq: number, language: string): Promise<ChatMessage>;
  me(): Promise<{ user_id: string; language?: string | null }>;
  setLanguage(language: string | null): Promise<{ user_id: string; language?: string | null }>;
  upload(id: string, file: UploadFile, options?: { name?: string; type?: string; size?: number }): Promise<ChatAttachment>;
  on(handler: ChatEventHandler): () => void;
  onLive(handler: () => void): () => void;
  handleEvent(event: string, data: unknown): boolean;
  notifyLive(): void;
  attach(pusher: unknown): () => void;
}

export class ChatApiError extends Error {
  status: number;
  constructor(status: number, message?: string);
}

export function createChatClient(options: ChatClientOptions): ChatClient;
export function tokenUser(token: string): string;
export function messageText(message: ChatMessage | null | undefined, lang?: string | null): string;

export interface ConversationState {
  conversation: ChatConversation | null;
  messages: ChatMessage[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  /** Members typing right now (not the user). */
  typing: string[];
  /** Each member's read_seq. */
  reads: Record<string, number>;
  /** Deleted, or the user was removed. */
  closed: boolean;
  error: unknown;
}

export interface ConversationStore {
  get(): ConversationState;
  subscribe(fn: () => void): () => void;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
  apply: ChatEventHandler;
  loadOlder(): Promise<void>;
  send(message: string | SendInput): Promise<ChatMessage>;
  edit(seq: number, change: string | { text?: string; metadata?: Record<string, unknown> }): Promise<ChatMessage>;
  remove(seq: number): Promise<ChatMessage>;
  translate(seq: number, language: string): Promise<ChatMessage>;
  toggleReaction(seq: number, emoji: string): Promise<ChatMessage>;
  markRead(): Promise<void>;
  /** Call on every keystroke. */
  typing(): void;
  stopTyping(): Promise<void>;
  readBy(seq: number): string[];
}

export interface ConversationListState {
  conversations: ChatConversation[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** Unread messages across the loaded conversations. */
  unread: number;
  error: unknown;
}

export interface ConversationListStore {
  get(): ConversationListState;
  subscribe(fn: () => void): () => void;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
  apply: ChatEventHandler;
  loadMore(): Promise<void>;
}

export function createConversationStore(client: ChatClient, id: string, options?: { pageSize?: number }): ConversationStore;
export function createConversationListStore(client: ChatClient, options?: { pageSize?: number }): ConversationListStore;

export function useChatClient(options: Omit<ChatClientOptions, 'pusher'>): ChatClient;
export function useChatConversation(
  client: ChatClient,
  id: string,
  options?: { pageSize?: number },
): Omit<ConversationStore, 'get' | 'subscribe' | 'start' | 'stop'> & Omit<ConversationState, 'typing'> & { typingUsers: string[] };
export function useChatConversations(
  client: ChatClient,
  options?: { pageSize?: number },
): Omit<ConversationListStore, 'get' | 'subscribe' | 'start' | 'stop'> & ConversationListState;
