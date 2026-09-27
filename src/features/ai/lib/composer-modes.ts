import type { ChatMode } from "@/features/ai/types/ai-chat.types";
import type {
  ChatModeSource,
  ComposerModeIntent,
  ComposerModeOption,
} from "@/features/ai/types/composer-mode.types";
import type { AcpSessionState } from "@/features/ai/types/acp.types";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";

export const BUILT_IN_MODES: ComposerModeOption[] = [
  { id: "chat", label: "Agent", intent: "agent" },
  { id: "ask", label: "Ask", intent: "ask" },
  { id: "plan", label: "Plan", intent: "plan" },
];

const CODEX_MODES: ComposerModeOption[] = [
  { id: "default", label: "Agent", intent: "agent" },
  { id: "plan", label: "Plan", intent: "plan" },
];

const AGENT_WORDS = new Set([
  "default",
  "agent",
  "code",
  "auto",
  "build",
  "normal",
  "edit",
  "edits",
]);

function modeWords(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/**
 * Agents name their modes freely (`plan`, `read-only`, `acceptEdits`). This reads the name and
 * id for the three modes every chat offers, so `/plan`, `/ask` and `/agent` find the closest one.
 */
export function inferModeIntent(mode: { id: string; name?: string }): ComposerModeIntent | null {
  const words = modeWords(`${mode.id} ${mode.name ?? ""}`);
  if (words.includes("plan") || words.includes("planning")) return "plan";
  const readOnly = words.includes("readonly") || (words.includes("read") && words.includes("only"));
  if (readOnly || words[0] === "ask" || words[0] === "chat") return "ask";
  if (words.some((word) => AGENT_WORDS.has(word))) return "agent";
  return null;
}

function fromAgentModes(modes: { id: string; name: string }[]): ComposerModeOption[] {
  return modes.map((mode) => ({
    id: mode.id,
    label: mode.name || mode.id,
    intent: inferModeIntent(mode) ?? undefined,
  }));
}

export function isBuiltInChatMode(value: string): value is ChatMode {
  return BUILT_IN_MODES.some((mode) => mode.id === value);
}

/**
 * Where a chat's mode lives: the built-in agent keeps it in the chat store, Codex in its thread
 * settings, and ACP agents in either their session modes or a "mode" config option.
 */
export function getChatModeSource({
  agentId,
  builtInMode,
  codexMode,
  acpSession,
  acpSessionId,
}: {
  agentId: string;
  builtInMode: ChatMode;
  codexMode?: string | null;
  acpSession: AcpSessionState;
  acpSessionId: string | null;
}): ChatModeSource {
  if (agentId === "custom") {
    return { kind: "built-in", options: BUILT_IN_MODES, currentId: builtInMode };
  }
  if (agentId === CODEX_INTEGRATION_ID) {
    return { kind: "codex", options: CODEX_MODES, currentId: codexMode || "default" };
  }

  const configOption = acpSession.configOptions.find(
    (option) => option.kind.type === "select" && classifySessionConfigOption(option) === "mode",
  );
  if (configOption?.kind.type === "select" && configOption.kind.options.length > 0) {
    const options = fromAgentModes(configOption.kind.options);
    return {
      kind: "acp-config",
      options,
      currentId: configOption.kind.currentValue || options[0]?.id || null,
      sessionId: acpSessionId,
      configOptionId: configOption.id,
    };
  }

  const options = fromAgentModes(acpSession.modeState.availableModes);
  return {
    kind: "acp-mode",
    options,
    currentId: acpSession.modeState.currentModeId ?? options[0]?.id ?? null,
    sessionId: acpSessionId,
  };
}

export function getCurrentModeOption(source: ChatModeSource): ComposerModeOption | null {
  return (
    source.options.find((option) => option.id === source.currentId) ?? source.options[0] ?? null
  );
}

/** The mode after the current one, wrapping around, as Shift+Tab steps through them. */
export function getNextModeOption(source: ChatModeSource): ComposerModeOption | null {
  if (source.options.length < 2) return null;
  const index = source.options.findIndex((option) => option.id === source.currentId);
  return source.options[(index + 1) % source.options.length] ?? null;
}

/**
 * The mode `/agent`, `/ask` or `/plan` should pick. An agent without a matching mode only has
 * a fallback for "agent": its first mode that is neither planning nor read-only.
 */
export function findModeForIntent(
  source: ChatModeSource,
  intent: ComposerModeIntent,
): ComposerModeOption | null {
  const match = source.options.find((option) => option.intent === intent);
  if (match) return match;
  if (intent !== "agent") return null;
  return (
    source.options.find((option) => option.intent !== "plan" && option.intent !== "ask") ?? null
  );
}
