import {
  CornersInIcon as CornersIn,
  CornersOutIcon as CornersOut,
  MinusIcon as Minus,
  XIcon as X,
} from "@/ui/icons";
import { Button } from "@/ui/button";
import Tooltip from "@/ui/tooltip";

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
          chrome="icon"
          className="pointer-events-auto"
          size="icon-xs"
        >
          <Minus weight="bold" />
        </Button>
      </Tooltip>
      <Tooltip content={isMaximized ? "Restore" : "Maximize"} side="bottom">
        <Button
          onClick={handleToggleMaximize}
          variant="ghost"
          chrome="icon"
          className="pointer-events-auto"
          size="icon-xs"
        >
          {isMaximized ? <CornersIn weight="duotone" /> : <CornersOut weight="duotone" />}
        </Button>
      </Tooltip>
      <Tooltip content="Close" side="bottom">
        <Button
          onClick={handleClose}
          variant="danger"
          chrome="icon"
          className="pointer-events-auto group hover:text-white"
          size="icon-xs"
        >
          <X weight="bold" />
        </Button>
      </Tooltip>
    </div>
  );
}
