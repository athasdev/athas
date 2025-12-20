import { ChevronDown, MessageSquare, PenTool } from "lucide-react";
import { memo, useRef, useState } from "react";
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
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const mode = useAIChatStore((state) => state.mode);
  const setMode = useAIChatStore((state) => state.setMode);

  const currentMode = MODES.find((m) => m.id === mode) || MODES[0];
  const CurrentIcon = currentMode.icon;

  return (
    <div ref={dropdownRef} className={cn("relative", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors",
          "text-text-lighter hover:bg-hover hover:text-text",
        )}
        title={`Mode: ${currentMode.label}`}
      >
        <CurrentIcon size={12} />
        <span>{currentMode.label}</span>
        <ChevronDown size={10} className={cn("transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            className="absolute bottom-full left-0 z-50 mb-1 min-w-28 rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
            role="menu"
          >
            {MODES.map((m) => {
              const Icon = m.icon;
              const isActive = mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setMode(m.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                    isActive ? "bg-selected text-text" : "text-text-light hover:bg-hover",
                  )}
                  role="menuitem"
                >
                  <Icon size={12} />
                  <div>
                    <div className="font-medium">{m.label}</div>
                    <div className="text-[10px] text-text-lighter">{m.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
});
