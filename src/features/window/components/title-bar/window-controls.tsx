import {
  CornersInIcon as CornersIn,
  CornersOutIcon as CornersOut,
  MinusIcon as Minus,
  XIcon as X,
} from "@/ui/icons";
import { chromeControl } from "@/features/layout/components/chrome-control-styles";
import { Button } from "@/ui/button";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

interface WindowControlsProps {
  currentWindow: any;
  isMaximized: boolean;
  onMaximizedChange: (isMaximized: boolean) => void;
}

export function WindowControls({
  currentWindow,
  isMaximized,
  onMaximizedChange,
}: WindowControlsProps) {
  const handleMinimize = async () => {
    try {
      await currentWindow?.minimize();
    } catch (error) {
      console.error("Error minimizing window:", error);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await currentWindow?.toggleMaximize();
      const maximized = await currentWindow?.isMaximized();
      onMaximizedChange(maximized);
    } catch (error) {
      console.error("Error toggling maximize:", error);
    }
  };

  const handleClose = async () => {
    try {
      await currentWindow?.close();
    } catch (error) {
      console.error("Error closing window:", error);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Tooltip content="Minimize" side="bottom">
        <Button
          onClick={handleMinimize}
          variant="ghost"
          className={cn("pointer-events-auto", chromeControl())}
          compact
        >
          <Minus weight="bold" />
        </Button>
      </Tooltip>
      <Tooltip content={isMaximized ? "Restore" : "Maximize"} side="bottom">
        <Button
          onClick={handleToggleMaximize}
          variant="ghost"
          className={cn("pointer-events-auto", chromeControl())}
          compact
        >
          {isMaximized ? <CornersIn weight="duotone" /> : <CornersOut weight="duotone" />}
        </Button>
      </Tooltip>
      <Tooltip content="Close" side="bottom">
        <Button
          onClick={handleClose}
          variant="danger"
          className={cn("pointer-events-auto group hover:text-white", chromeControl())}
          compact
        >
          <X weight="bold" />
        </Button>
      </Tooltip>
    </div>
  );
}
