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
        "inline-flex h-8 items-center rounded-full border border-border bg-secondary-bg/80 p-1",
        className,
      )}
    >
      {MODES.map((m) => {
        const Icon = m.icon;
        const isActive = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            aria-pressed={isActive}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-medium text-[11px] transition-all duration-200",
              isActive
                ? "border-border bg-primary-bg text-text"
                : "border-transparent text-text-lighter hover:border-border/70 hover:bg-hover/70 hover:text-text",
            )}
            title={m.description}
          >
            <Icon size={12} />
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
});
