import { DEFAULT_HARNESS_SESSION_KEY } from "@/features/ai/lib/chat-scope";
import { getPreferredHarnessEntryBackend } from "@/features/ai/lib/harness-entry-backend";
import type { HarnessRuntimeBackend } from "@/features/ai/lib/harness-runtime-backend";

interface AiChatToggleBufferLike {
  id: string;
  isAgent?: boolean;
}

export function toggleHarnessFromAiChatToggle(
  activeBuffer: AiChatToggleBufferLike | null,
  openAgentBuffer: (
    sessionId?: string,
    options?: {
      backend?: HarnessRuntimeBackend;
    },
  ) => void,
  closeBuffer: (bufferId: string) => void,
  forceValue?: boolean,
  preferredBackend = getPreferredHarnessEntryBackend(),
) {
  const shouldOpen = forceValue ?? !activeBuffer?.isAgent;

  if (!shouldOpen && activeBuffer?.isAgent) {
    closeBuffer(activeBuffer.id);
    return;
  }

  if (!shouldOpen) {
    return;
  }

  openAgentBuffer(DEFAULT_HARNESS_SESSION_KEY, { backend: preferredBackend });
}
