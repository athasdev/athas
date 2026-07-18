import type { Message } from "@/features/ai/types/ai-chat.types";

export const FOLLOW_UP_ACTIONS_START = "[FOLLOW_UP_ACTIONS]";
export const FOLLOW_UP_ACTIONS_END = "[/FOLLOW_UP_ACTIONS]";

export const FOLLOW_UP_ACTION_ICONS = [
  "ArrowRight",
  "Bug",
  "CheckCircle",
  "FileText",
  "GitBranch",
  "MagnifyingGlass",
  "Play",
  "RocketLaunch",
  "ShieldCheck",
  "Stack",
  "Terminal",
  "UploadSimple",
  "WarningCircle",
  "Wrench",
] as const;

export type FollowUpActionIcon = (typeof FOLLOW_UP_ACTION_ICONS)[number];

export interface ChatFollowUpAction {
  id: string;
  label: string;
  prompt: string;
  icon: FollowUpActionIcon;
}

const DEFAULT_ICON: FollowUpActionIcon = "ArrowRight";
const FOLLOW_UP_ACTIONS_PATTERN = /\[FOLLOW_UP_ACTIONS\]([\s\S]*?)\[\/FOLLOW_UP_ACTIONS\]/i;
const OPEN_FOLLOW_UP_ACTIONS_PATTERN = /\[FOLLOW_UP_ACTIONS\][\s\S]*$/i;
const ALLOWED_ICON_SET = new Set<string>(FOLLOW_UP_ACTION_ICONS);

export function getFollowUpActionsInstruction() {
  return `At the very end of each assistant response, include a hidden follow-up action block:

${FOLLOW_UP_ACTIONS_START}
[
  {"label":"Run tests","prompt":"Run the relevant tests and verify this change.","icon":"ShieldCheck"}
]
${FOLLOW_UP_ACTIONS_END}

Rules for follow-up actions:
- Generate 1-3 actions that fit the work you just completed or the next likely user intent.
- Each action must be a short UI button, not a sentence.
- Each prompt must be the exact message to send if the user clicks it.
- Pick an icon from this app icon set only: ${FOLLOW_UP_ACTION_ICONS.join(", ")}.
- Do not mention the follow-up block in the visible response.`;
}

function toFollowUpIcon(value: unknown): FollowUpActionIcon {
  return typeof value === "string" && ALLOWED_ICON_SET.has(value)
    ? (value as FollowUpActionIcon)
    : DEFAULT_ICON;
}

function normalizeFollowUpAction(value: unknown, index: number): ChatFollowUpAction | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!label || !prompt) return null;

  const rawId = typeof record.id === "string" ? record.id.trim() : "";
  return {
    id:
      rawId ||
      `${label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}-${index}`,
    label: label.slice(0, 28),
    prompt,
    icon: toFollowUpIcon(record.icon),
  };
}

function parseFollowUpActions(rawJson: string): ChatFollowUpAction[] {
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, index) => normalizeFollowUpAction(item, index))
      .filter((item): item is ChatFollowUpAction => Boolean(item))
      .slice(0, 3);
  } catch {
    return [];
  }
}

export function extractFollowUpActions(content: string): {
  content: string;
  actions: ChatFollowUpAction[];
} {
  const match = content.match(FOLLOW_UP_ACTIONS_PATTERN);
  if (!match) {
    return {
      content: content.replace(OPEN_FOLLOW_UP_ACTIONS_PATTERN, "").trimEnd(),
      actions: [],
    };
  }

  const visibleContent = content.replace(match[0], "").trimEnd();
  return {
    content: visibleContent,
    actions: parseFollowUpActions(match[1] || ""),
  };
}

export function normalizeMessageFollowUpActions(message: Message): Message {
  if (message.role !== "assistant" || typeof message.content !== "string") return message;

  const extracted = extractFollowUpActions(message.content);
  const contentChanged = extracted.content !== message.content;
  if (!contentChanged && extracted.actions.length === 0) return message;

  return {
    ...message,
    content: extracted.content,
    followUpActions:
      contentChanged || extracted.actions.length > 0 ? extracted.actions : message.followUpActions,
  };
}

export function getFollowUpActionsForMessage(
  message: Message | null | undefined,
): ChatFollowUpAction[] {
  if (!message || message.role !== "assistant" || message.isStreaming) return [];
  return message.followUpActions || [];
}
