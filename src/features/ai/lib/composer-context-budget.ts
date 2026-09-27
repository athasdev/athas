import { buildContextBudget } from "@/features/ai/lib/context-budget";
import {
  buildConversationHistory,
  getProviderRequestLimits,
} from "@/features/ai/lib/conversation-history";
import type { ChatMode, Message } from "@/features/ai/types/ai-chat.types";
import type { EditorSelectionContext } from "@/features/ai/types/ai-context.types";
import type { ContextBudget } from "@/features/ai/types/context-budget.types";
import type {
  ComposerBudgetGroup,
  ComposerBudgetTone,
} from "@/features/ai/types/composer-context-budget.types";
import { hasTextContent, type PaneContent } from "@/features/panes/types/pane-content.types";
import { buildSystemPrompt } from "@/features/ai/utils/ai-context-builder";

/** Context use at or above this share of the limit is shown as a warning. */
const WARNING_RATIO = 0.8;
/** Context use at or above this share of the limit is shown as an error. */
const ERROR_RATIO = 0.95;
const CHARS_PER_TOKEN = 4;

/**
 * The window the meter measures against. Hosted Athas requests are capped by size rather than
 * by the model's window, so their request cap is the limit that matters.
 */
export function resolveComposerContextWindow(
  providerId: string,
  modelContextWindow: number | undefined,
): { contextWindowTokens?: number; reservedOutputTokens?: number } {
  const requestLimits = getProviderRequestLimits(providerId);
  if (requestLimits) {
    return {
      contextWindowTokens: Math.floor(requestLimits.maxBytes / CHARS_PER_TOKEN),
      reservedOutputTokens: 0,
    };
  }
  return modelContextWindow ? { contextWindowTokens: modelContextWindow } : {};
}

export interface ComposerContextBudgetInput {
  providerId: string;
  modelContextWindow?: number;
  mode: ChatMode;
  messages: Message[];
  buffers: PaneContent[];
  selectedBufferIds: Set<string>;
  editorContexts: EditorSelectionContext[];
  rules?: { text: string; truncated: boolean } | null;
}

/** What the built-in agent's next request would carry, before the new message is typed. */
export function getComposerContextBudget(input: ComposerContextBudgetInput): ContextBudget {
  const attachments = input.buffers
    .filter((buffer) => input.selectedBufferIds.has(buffer.id))
    .filter(hasTextContent)
    .map((buffer) => ({ name: buffer.name, path: buffer.path, content: buffer.content }));

  return buildContextBudget({
    ...resolveComposerContextWindow(input.providerId, input.modelContextWindow),
    systemPrompt: buildSystemPrompt("", input.mode),
    rules: input.rules?.text,
    rulesTruncated: input.rules?.truncated,
    history: buildConversationHistory(input.messages),
    attachments,
    contextReferences: input.editorContexts.map((selection) => ({
      id: `selection:${selection.id}`,
      label: `${selection.fileName}:${selection.startLine}-${selection.endLine}`,
      content: selection.selectedText,
    })),
  });
}

const GROUP_LABELS: Record<ComposerBudgetGroup["id"], string> = {
  files: "Files",
  rules: "Rules",
  history: "Conversation",
  references: "References",
  system: "Instructions",
};

/** The meter's breakdown: files, rules, conversation and references, largest share first. */
export function groupComposerBudget(budget: ContextBudget): ComposerBudgetGroup[] {
  const groups = new Map<ComposerBudgetGroup["id"], ComposerBudgetGroup>();
  for (const item of budget.items) {
    const id: ComposerBudgetGroup["id"] =
      item.kind === "attachment"
        ? "files"
        : item.kind === "rules"
          ? "rules"
          : item.kind === "history"
            ? "history"
            : item.kind === "context"
              ? "references"
              : "system";
    const group = groups.get(id) ?? {
      id,
      label: GROUP_LABELS[id],
      tokens: 0,
      count: 0,
      truncated: false,
    };
    group.tokens += item.tokens;
    group.count += 1;
    group.truncated ||= item.truncated;
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => b.tokens - a.tokens);
}

export function getComposerBudgetTone(budget: ContextBudget): ComposerBudgetTone {
  if (budget.overLimit || (budget.ratio ?? 0) >= ERROR_RATIO) return "error";
  if ((budget.ratio ?? 0) >= WARNING_RATIO) return "warning";
  return "accent";
}
