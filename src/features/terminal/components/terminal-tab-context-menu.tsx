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
      className="fixed z-[10040] min-w-[190px] select-none rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      style={{ left: position.x, top: position.y }}
    >
      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onPin(terminal.id);
          onClose();
        }}
      >
        {terminal.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        {terminal.isPinned ? "Unpin Terminal" : "Pin Terminal"}
      </button>

      <div className="my-0.5 border-border/70 border-t" />

      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onDuplicate(terminal.id);
          onClose();
        }}
      >
        <Copy size={12} />
        Duplicate Terminal
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onClear(terminal.id);
          onClose();
        }}
      >
        <RotateCcw size={12} />
        Clear Terminal
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onRename(terminal.id);
          onClose();
        }}
      >
        <Edit size={12} />
        Rename Terminal
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onExport(terminal.id);
          onClose();
        }}
      >
        <Download size={12} />
        Export Output
      </button>

      <div className="my-0.5 border-border/70 border-t" />

      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseTab(terminal.id);
          onClose();
        }}
      >
        <X size={12} />
        Close Terminal
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseOthers(terminal.id);
          onClose();
        }}
      >
        Close Other Terminals
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
        onClick={() => {
          onCloseAll();
          onClose();
        }}
      >
        Close All Terminals
      </button>

      <button
        className="ui-font flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text text-xs hover:bg-hover"
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
