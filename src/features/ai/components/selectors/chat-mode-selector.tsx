import { MessageSquare, PenTool } from "lucide-react";
import { memo } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import type { ChatMode } from "@/features/ai/store/types";
import { cn } from "@/utils/cn";

interface ChatModeSelectorProps {
  className?: string;
}

const MODES: { id: ChatMode; label: string; icon: typeof MessageSquare; description: string }[] = [
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    description: "General conversation",
  },
  {
    id: "plan",
    label: "Plan",
    icon: PenTool,
    description: "Structured planning",
  },
];

export const ChatModeSelector = memo(function ChatModeSelector({
  className,
}: ChatModeSelectorProps) {
  const mode = useAIChatStore((state) => state.mode);
  const setMode = useAIChatStore((state) => state.setMode);

  return (
    <div
      className={cn(
        "flex h-7 items-center rounded-md border border-border bg-primary-bg p-0.5",
        className,
      )}
    >
      {MODES.map((m) => {
        const Icon = m.icon;
        const isActive = mode === m.id;
        return (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
              isActive
                ? "bg-accent/15 font-medium text-accent"
                : "text-text-lighter hover:text-text-light",
            )}
            title={m.description}
          >
            <Icon size={11} />
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
});
