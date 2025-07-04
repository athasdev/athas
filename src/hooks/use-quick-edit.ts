import { useState, useCallback } from "react";

export interface QuickEditState {
  isOpen: boolean;
  selectedText: string;
  cursorPosition: { x: number; y: number };
  selectionRange: { start: number; end: number };
}

export function useQuickEdit() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [cursorPosition, setCursorPosition] = useState({ x: 100, y: 100 });
  const [selectionRange, setSelectionRange] = useState({ start: 0, end: 0 });

  // Call this to open quick edit for a given selection
  const openQuickEdit = useCallback(
    ({
      text,
      cursorPosition,
      selectionRange,
    }: {
      text: string;
      cursorPosition: { x: number; y: number };
      selectionRange: { start: number; end: number };
    }) => {
      setSelectedText(text);
      setCursorPosition(cursorPosition);
      setSelectionRange(selectionRange);
      setIsOpen(true);
    },
    [],
  );

  const closeQuickEdit = useCallback(() => setIsOpen(false), []);

  return {
    isOpen,
    selectedText,
    cursorPosition,
    selectionRange,
    openQuickEdit,
    closeQuickEdit,
  };
}
