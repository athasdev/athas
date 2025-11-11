import { Copy, Download, Edit, Pin, PinOff, RotateCcw, X } from "lucide-react";
import type { RefObject } from "react";
import { useRef } from "react";
import { useEventListener, useOnClickOutside } from "usehooks-ts";
import type { Terminal } from "@/features/terminal/types/terminal";

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
  const menuRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef(document);

  useOnClickOutside(menuRef as RefObject<HTMLElement>, () => {
    onClose();
  });

  useEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    documentRef,
  );

  if (!isOpen || !terminal) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-[180px] border border-border bg-secondary-bg py-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      <button
        className="ui-font flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onPin(terminal.id);
          onClose();
        }}
      >
        {terminal.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        {terminal.isPinned ? "Unpin Terminal" : "Pin Terminal"}
      </button>

      <div className="my-1 border-border border-t" />

      <button
        className="ui-font flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onDuplicate(terminal.id);
          onClose();
        }}
      >
        <Copy size={12} />
        Duplicate Terminal
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onClear(terminal.id);
          onClose();
        }}
      >
        <RotateCcw size={12} />
        Clear Terminal
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onRename(terminal.id);
          onClose();
        }}
      >
        <Edit size={12} />
        Rename Terminal
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onExport(terminal.id);
          onClose();
        }}
      >
        <Download size={12} />
        Export Output
      </button>

      <div className="my-1 border-border border-t" />

      <button
        className="ui-font flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseTab(terminal.id);
          onClose();
        }}
      >
        <span className="flex items-center gap-2">
          <X size={12} />
          Close Terminal
        </span>
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseOthers(terminal.id);
          onClose();
        }}
      >
        Close Other Terminals
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseAll();
          onClose();
        }}
      >
        Close All Terminals
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseToRight(terminal.id);
          onClose();
        }}
      >
        Close Terminals to Right
      </button>
    </div>
  );
};

export default TerminalTabContextMenu;
