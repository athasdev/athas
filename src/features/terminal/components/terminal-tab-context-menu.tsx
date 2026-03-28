import { Copy, Download, Edit, Pin, PinOff, RotateCcw, X } from "lucide-react";
import type { Terminal } from "@/features/terminal/types/terminal";
import type { ContextMenuItem } from "@/ui/context-menu";
import { ContextMenu } from "@/ui/context-menu";
import Keybinding from "@/ui/keybinding";
import { IS_MAC } from "@/utils/platform";

interface TerminalTabContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  terminal: Terminal | null;
  onClose: () => void;
  onPin: (terminalId: string) => void;
  onCloseTab: (terminalId: string) => void;
  onCloseOthers: (terminalId: string) => void;
  onCloseAll: () => void;
  onCloseToRight: (terminalId: string) => void;
  onClear: (terminalId: string) => void;
  onDuplicate: (terminalId: string) => void;
  onRename: (terminalId: string) => void;
  onExport: (terminalId: string) => void;
}

const TerminalTabContextMenu = ({
  isOpen,
  position,
  terminal,
  onClose,
  onPin,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onCloseToRight,
  onClear,
  onDuplicate,
  onRename,
  onExport,
}: TerminalTabContextMenuProps) => {
  const modKey = IS_MAC ? "Cmd" : "Ctrl";

  const items: ContextMenuItem[] = terminal
    ? [
        {
          id: "pin",
          label: terminal.isPinned ? "Unpin Terminal" : "Pin Terminal",
          icon: terminal.isPinned ? <PinOff /> : <Pin />,
          onClick: () => onPin(terminal.id),
        },
        { id: "sep-1", label: "", separator: true, onClick: () => {} },
        {
          id: "duplicate",
          label: "Duplicate Terminal",
          icon: <Copy />,
          onClick: () => onDuplicate(terminal.id),
        },
        {
          id: "clear",
          label: "Clear Terminal",
          icon: <RotateCcw />,
          onClick: () => onClear(terminal.id),
        },
        {
          id: "rename",
          label: "Rename Terminal",
          icon: <Edit />,
          keybinding: <Keybinding keys={["F2"]} />,
          onClick: () => onRename(terminal.id),
        },
        {
          id: "export",
          label: "Export Output",
          icon: <Download />,
          onClick: () => onExport(terminal.id),
        },
        { id: "sep-2", label: "", separator: true, onClick: () => {} },
        {
          id: "close",
          label: "Close Terminal",
          icon: <X />,
          keybinding: <Keybinding keys={[modKey, "W"]} />,
          onClick: () => onCloseTab(terminal.id),
        },
        {
          id: "close-others",
          label: "Close Other Terminals",
          onClick: () => onCloseOthers(terminal.id),
        },
        {
          id: "close-all",
          label: "Close All Terminals",
          onClick: onCloseAll,
        },
        {
          id: "close-right",
          label: "Close Terminals to Right",
          onClick: () => onCloseToRight(terminal.id),
        },
      ]
    : [];

  return <ContextMenu isOpen={isOpen} position={position} items={items} onClose={onClose} />;
};

export default TerminalTabContextMenu;
