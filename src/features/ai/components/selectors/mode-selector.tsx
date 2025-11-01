import { memo } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import type { ChatMode, OutputStyle } from "@/features/ai/store/types";
import Dropdown from "@/ui/dropdown";
import { cn } from "@/utils/cn";

interface ModeSelectorProps {
  className?: string;
}

const modeOptions = [
  { value: "chat" as ChatMode, label: "Chat" },
  { value: "plan" as ChatMode, label: "Plan" },
];

const outputStyleOptions = [
  { value: "default" as OutputStyle, label: "Default" },
  { value: "explanatory" as OutputStyle, label: "Explanatory" },
  { value: "learning" as OutputStyle, label: "Learning" },
];

export const ModeSelector = memo(function ModeSelector({ className }: ModeSelectorProps) {
  const mode = useAIChatStore((state) => state.mode);
  const outputStyle = useAIChatStore((state) => state.outputStyle);
  const setMode = useAIChatStore((state) => state.setMode);
  const setOutputStyle = useAIChatStore((state) => state.setOutputStyle);

  const handleModeChange = (newMode: string) => {
    setMode(newMode as ChatMode);
  };

  const handleOutputStyleChange = (newStyle: string) => {
    setOutputStyle(newStyle as OutputStyle);
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Dropdown
        value={mode}
        options={modeOptions}
        onChange={handleModeChange}
        size="xs"
        openDirection="up"
        className="min-w-16"
      />
      <Dropdown
        value={outputStyle}
        options={outputStyleOptions}
        onChange={handleOutputStyleChange}
        size="xs"
        openDirection="up"
        className="min-w-24"
      />
    </div>
  );
});
