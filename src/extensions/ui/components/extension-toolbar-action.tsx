import type { RegisteredToolbarAction } from "../types/ui-extension";
import { DynamicIcon } from "./dynamic-icon";
import { Button } from "@/ui/button";
import Tooltip from "@/ui/tooltip";

interface ExtensionToolbarActionProps {
  action: RegisteredToolbarAction;
}

export function ExtensionToolbarAction({ action }: ExtensionToolbarActionProps) {
  if (action.isVisible && !action.isVisible()) {
    return null;
  }

  return (
    <Tooltip content={action.title} side="bottom">
      <Button
        onClick={action.onClick}
        variant="ghost"
        size="icon-xs"
        className="rounded text-text-lighter"
        aria-label={action.title}
      >
        <DynamicIcon name={action.icon} />
      </Button>
    </Tooltip>
  );
}
