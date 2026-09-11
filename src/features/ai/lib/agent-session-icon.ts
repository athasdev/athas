import type { Chat } from "@/features/ai/types/ai-chat.types";

type SessionIdentity = Pick<Chat, "agentId"> & Partial<Pick<Chat, "providerId">>;

/**
 * The provider icon id for an agent session.
 *
 * Sessions run either through a named agent (`gemini-cli`, `codex`, …) or
 * through the built-in chat against an API provider, where the identity lives
 * on `providerId` instead. Every surface that shows a session must resolve it
 * the same way, otherwise the same session picks up a different mark in the
 * tab bar, the sidebar and the history menu.
 */
export function resolveAgentSessionIconId(
  session: SessionIdentity | null | undefined,
  fallbackProviderId?: string | null,
): string {
  if (!session) return "custom";
  if (session.agentId === "custom") {
    return session.providerId || fallbackProviderId || "custom";
  }
  return session.agentId || "custom";
}
