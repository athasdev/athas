import type { Window as TauriWindow } from "@tauri-apps/api/window";
import {
  CornersInIcon as CornersIn,
  CornersOutIcon as CornersOut,
  MinusIcon as Minus,
  XIcon as X,
} from "@/ui/icons";
import { requestWindowClose } from "@/features/window/utils/request-window-close";
import { Button } from "@/ui/button";
import { ChromeGroup } from "@/ui/chrome";

interface WindowControlsProps {
  currentWindow: TauriWindow | null;
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
      if (typeof maximized === "boolean") {
        onMaximizedChange(maximized);
      }
    } catch (error) {
      console.error("Error toggling maximize:", error);
    }
  };

  const handleClose = () => {
    requestWindowClose();
  };

  return (
    <ChromeGroup gap="tight">
      <Button
        onClick={handleMinimize}
        variant="ghost"
        className="pointer-events-auto"
        size="icon-xs"
        tooltip="Minimize"
        tooltipSide="bottom"
        aria-label="Minimize"
      >
        <Minus weight="bold" />
      </Button>
      <Button
        onClick={handleToggleMaximize}
        variant="ghost"
        className="pointer-events-auto"
        size="icon-xs"
        tooltip={isMaximized ? "Restore" : "Maximize"}
        tooltipSide="bottom"
        aria-label={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? <CornersIn weight="duotone" /> : <CornersOut weight="duotone" />}
      </Button>
      <Button
        onClick={handleClose}
        variant="danger"
        className="pointer-events-auto group hover:text-white"
        size="icon-xs"
        tooltip="Close"
        tooltipSide="bottom"
        aria-label="Close"
      >
        <X weight="bold" />
      </Button>
    </ChromeGroup>
  );
}
