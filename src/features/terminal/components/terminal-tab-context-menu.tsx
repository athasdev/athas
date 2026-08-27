import {
  CopyIcon as Copy,
  DownloadIcon as Download,
  PencilSimpleIcon as Edit,
  PushPinIcon as Pin,
  PushPinSlashIcon as PinOff,
  ArrowCounterClockwiseIcon as RotateCcw,
} from "@/ui/icons";
import type { Terminal } from "@/features/terminal/types/terminal.types";
import { ContextMenuPopup, type ContextMenuGroupData } from "@/ui/context-menu";

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
  const groups: ContextMenuGroupData[] = terminal
    ? [
        {
          id: "tab",
          items: [
            {
              id: "pin",
              label: terminal.isPinned ? "Unpin Terminal" : "Pin Terminal",
              icon: terminal.isPinned ? <PinOff /> : <Pin />,
              onClick: () => onPin(terminal.id),
            },
          ],
        },
        {
          id: "terminal",
          items: [
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
              onClick: () => onRename(terminal.id),
            },
            {
              id: "export",
              label: "Export Output",
              icon: <Download weight="fill" />,
              onClick: () => onExport(terminal.id),
            },
          ],
        },
        {
          id: "close",
          items: [
            {
              id: "close",
              label: "Close Terminal",
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
          ],
        },
      ]
    : [];

  return <ContextMenuPopup isOpen={isOpen} point={position} groups={groups} onClose={onClose} />;
};

export default TerminalTabContextMenu;
