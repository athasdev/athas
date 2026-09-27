export interface AttachmentBudget {
  /** The most tokens one attachment may contribute before it is truncated. */
  perAttachmentTokens: number;
  /** The most tokens all attachments of one message may contribute together. */
  totalTokens: number;
}

export interface TruncatedText {
  text: string;
  truncated: boolean;
  originalTokens: number;
}

export type ContextBudgetItemKind =
  | "system"
  | "rules"
  | "history"
  | "attachment"
  | "context"
  | "message";

export interface ContextBudgetItem {
  id: string;
  kind: ContextBudgetItemKind;
  label: string;
  tokens: number;
  truncated: boolean;
}

export interface ContextBudgetAttachment {
  name: string;
  path: string;
  content: string;
  truncated?: boolean;
}

export interface ContextBudgetInput {
  /** The model's context window. Without one, the budget reports usage but no limit. */
  contextWindowTokens?: number;
  /** Tokens kept free for the model's answer. */
  reservedOutputTokens?: number;
  systemPrompt?: string;
  rules?: string;
  rulesTruncated?: boolean;
  history?: { content: string }[];
  attachments?: ContextBudgetAttachment[];
  /** Resolved @folder, @git, @problems and @chat references. */
  contextReferences?: { id: string; label: string; content: string; truncated?: boolean }[];
  message?: string;
}

export interface ContextBudget {
  items: ContextBudgetItem[];
  usedTokens: number;
  /** Tokens available for input, or null when the context window is unknown. */
  limitTokens: number | null;
  remainingTokens: number | null;
  /** Used share of the limit between 0 and 1, or null when the limit is unknown. */
  ratio: number | null;
  overLimit: boolean;
  /** Whether any item was cut to fit its budget. */
  truncated: boolean;
}
