import type {
  AttachmentBudget,
  ContextBudget,
  ContextBudgetInput,
  ContextBudgetItem,
  TruncatedText,
} from "@/features/ai/types/context-budget.types";

/** Rough characters per token for source code and English prose. */
const CHARS_PER_TOKEN = 4;

export const DEFAULT_ATTACHMENT_BUDGET: AttachmentBudget = {
  perAttachmentTokens: 8_000,
  totalTokens: 32_000,
};

/** Tokens kept free for the answer when the model does not report its output limit. */
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 4_096;

/**
 * A fast, provider-independent token estimate. It errs slightly high for code, which keeps
 * budgets conservative; it is not a tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function formatTruncationMarker(shownTokens: number, originalTokens: number): string {
  return `... [truncated: showing about ${shownTokens} of ${originalTokens} tokens] ...`;
}

/**
 * Cuts `text` to about `maxTokens`, keeping the start and the end, which usually carry the
 * imports, the declarations and the most recent output. Cuts fall on line breaks when possible.
 */
export function truncateTextToTokens(text: string, maxTokens: number): TruncatedText {
  const originalTokens = estimateTokens(text);
  const limit = Number.isFinite(maxTokens) ? Math.max(0, Math.floor(maxTokens)) : 0;
  if (originalTokens <= limit) return { text, truncated: false, originalTokens };
  const maxChars = limit * CHARS_PER_TOKEN;
  const marker = formatTruncationMarker(limit, originalTokens);
  if (maxChars < marker.length + 2) {
    return { text: "[truncated]".slice(0, maxChars), truncated: true, originalTokens };
  }
  const contentChars = maxChars - marker.length - 2;
  const headChars = Math.floor(contentChars * 0.8);
  const tailChars = contentChars - headChars;
  let head = text.slice(0, headChars);
  const headBreak = head.lastIndexOf("\n");
  if (headBreak > headChars / 2) head = head.slice(0, headBreak);
  let tail = tailChars > 0 ? text.slice(text.length - tailChars) : "";
  const tailBreak = tail.indexOf("\n");
  if (tailBreak >= 0 && tailBreak < tail.length / 2) tail = tail.slice(tailBreak + 1);
  const fittedMarker = formatTruncationMarker(
    estimateTokens(head) + estimateTokens(tail),
    originalTokens,
  );
  return { text: `${head}\n${fittedMarker}\n${tail}`, truncated: true, originalTokens };
}

export interface BudgetedAttachment {
  content: string;
  truncated?: boolean;
  originalTokens?: number;
}

/**
 * Fits attachments into one message's budget. Each attachment is cut to the per-attachment
 * cap, and once the total is spent their content is omitted. Paths and truncation metadata
 * remain available so the model can read the files with a tool.
 */
export function applyAttachmentBudget<T extends BudgetedAttachment>(
  attachments: T[],
  budget: AttachmentBudget = DEFAULT_ATTACHMENT_BUDGET,
): { attachments: T[]; usedTokens: number; truncated: boolean } {
  let remaining = Number.isFinite(budget.totalTokens)
    ? Math.max(0, Math.floor(budget.totalTokens))
    : 0;
  let usedTokens = 0;
  let anyTruncated = false;

  const fitted = attachments.map((attachment) => {
    const allowance = Math.max(0, Math.min(budget.perAttachmentTokens, remaining));
    const originalTokens = attachment.originalTokens ?? estimateTokens(attachment.content);
    if (allowance === 0) {
      anyTruncated = true;
      return {
        ...attachment,
        content: "",
        truncated: true,
        originalTokens,
      };
    }
    const result = truncateTextToTokens(attachment.content, allowance);
    const tokens = estimateTokens(result.text);
    remaining -= tokens;
    usedTokens += tokens;
    const truncated = Boolean(attachment.truncated) || result.truncated;
    anyTruncated ||= truncated;
    return {
      ...attachment,
      content: result.text,
      truncated,
      originalTokens: Math.max(originalTokens, result.originalTokens),
    };
  });

  return { attachments: fitted, usedTokens, truncated: anyTruncated };
}

/**
 * What a request would send, item by item, measured against the model's context window.
 * The composer shows this as a context meter.
 */
export function buildContextBudget(input: ContextBudgetInput): ContextBudget {
  const items: ContextBudgetItem[] = [];
  const add = (item: ContextBudgetItem) => {
    if (item.tokens > 0) items.push(item);
  };

  add({
    id: "system",
    kind: "system",
    label: "System prompt",
    tokens: estimateTokens(input.systemPrompt ?? ""),
    truncated: false,
  });
  add({
    id: "rules",
    kind: "rules",
    label: "Project rules",
    tokens: estimateTokens(input.rules ?? ""),
    truncated: Boolean(input.rulesTruncated),
  });
  add({
    id: "history",
    kind: "history",
    label: "Conversation",
    tokens: (input.history ?? []).reduce(
      (total, message) => total + estimateTokens(message.content),
      0,
    ),
    truncated: false,
  });
  for (const attachment of input.attachments ?? []) {
    add({
      id: `attachment:${attachment.path}`,
      kind: "attachment",
      label: attachment.name,
      tokens: estimateTokens(attachment.content),
      truncated: Boolean(attachment.truncated),
    });
  }
  for (const reference of input.contextReferences ?? []) {
    add({
      id: reference.id,
      kind: "context",
      label: reference.label,
      tokens: estimateTokens(reference.content),
      truncated: Boolean(reference.truncated),
    });
  }
  add({
    id: "message",
    kind: "message",
    label: "Message",
    tokens: estimateTokens(input.message ?? ""),
    truncated: false,
  });

  const usedTokens = items.reduce((total, item) => total + item.tokens, 0);
  const limitTokens = input.contextWindowTokens
    ? Math.max(
        0,
        input.contextWindowTokens - (input.reservedOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS),
      )
    : null;

  return {
    items,
    usedTokens,
    limitTokens,
    remainingTokens: limitTokens === null ? null : limitTokens - usedTokens,
    ratio: limitTokens ? Math.min(1, usedTokens / limitTokens) : null,
    overLimit: limitTokens !== null && usedTokens > limitTokens,
    truncated: items.some((item) => item.truncated),
  };
}
