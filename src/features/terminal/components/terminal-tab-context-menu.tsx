import {
  ArrowCounterClockwiseIcon,
  ColumnsIcon,
  CopyIcon,
  DownloadIcon,
  PenIcon,
  PinIcon,
  PinSlashIcon,
  RowsIcon,
  TerminalWindowIcon,
} from "@/ui/icons";
import type { Terminal } from "@/features/terminal/types/terminal.types";
import { ContextMenuPopup, type ContextMenuGroupData } from "@/ui/context-menu";

interface TerminalTabContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  terminal: Terminal | null;
  isSplit: boolean;
  onClose: () => void;
  onSplitRight: (terminalId: string) => void;
  onSplitDown: (terminalId: string) => void;
  onUnsplit: (terminalId: string) => void;
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
  isSplit,
  onClose,
  onSplitRight,
  onSplitDown,
  onUnsplit,
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
              icon: terminal.isPinned ? <PinSlashIcon /> : <PinIcon />,
              onClick: () => onPin(terminal.id),
            },
          ],
        },
        {
          id: "split",
          items: [
            {
              id: "split-right",
              label: "Split Right",
              icon: <ColumnsIcon />,
              onClick: () => onSplitRight(terminal.id),
            },
            {
              id: "split-down",
              label: "Split Down",
              icon: <RowsIcon />,
              onClick: () => onSplitDown(terminal.id),
            },
            ...(isSplit
              ? [
                  {
                    id: "unsplit",
                    label: "Unsplit",
                    icon: <TerminalWindowIcon />,
                    onClick: () => onUnsplit(terminal.id),
                  },
                ]
              : []),
          ],
        },
        {
          id: "terminal",
          items: [
            {
              id: "duplicate",
              label: "Duplicate Terminal",
              icon: <CopyIcon />,
              onClick: () => onDuplicate(terminal.id),
            },
            {
              id: "clear",
              label: "Clear Terminal",
              icon: <ArrowCounterClockwiseIcon />,
              onClick: () => onClear(terminal.id),
            },
            {
              id: "rename",
              label: "Rename Terminal",
              icon: <PenIcon />,
              onClick: () => onRename(terminal.id),
            },
            {
              id: "export",
              label: "Export Output",
              icon: <DownloadIcon optical="md" />,
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
