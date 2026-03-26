import { DEFAULT_HARNESS_SESSION_KEY } from "@/features/ai/lib/chat-scope";

interface AiChatToggleBufferLike {
  id: string;
  isAgent?: boolean;
}

export function toggleHarnessFromAiChatToggle(
  activeBuffer: AiChatToggleBufferLike | null,
  openAgentBuffer: (sessionId?: string) => void,
  closeBuffer: (bufferId: string) => void,
  forceValue?: boolean,
) {
  const shouldOpen = forceValue ?? !activeBuffer?.isAgent;

  if (!shouldOpen && activeBuffer?.isAgent) {
    closeBuffer(activeBuffer.id);
    return;
  }

  if (!shouldOpen) {
    return;
  }

  openAgentBuffer(DEFAULT_HARNESS_SESSION_KEY);
}
