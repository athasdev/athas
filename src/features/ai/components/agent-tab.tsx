import { useBufferStore } from "@/features/editor/stores/buffer-store";
import AIChat from "./chat/ai-chat";

export function AgentTab() {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;

  return (
    <div className="h-full w-full">
      <AIChat mode="chat" activeBuffer={activeBuffer} buffers={buffers} />
    </div>
  );
}
