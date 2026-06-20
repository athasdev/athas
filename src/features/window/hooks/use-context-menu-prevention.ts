import { useEffect } from "react";

const ALLOWED_CONTEXT_MENU_SELECTOR =
  ".monaco-editor, .monaco-editor-shell, .monaco-menu-container";

function hasClosest(target: EventTarget | null): target is EventTarget & {
  closest: (selector: string) => unknown;
} {
  return (
    typeof target === "object" &&
    target !== null &&
    "closest" in target &&
    typeof target.closest === "function"
  );
}

function isContextMenuAllowedTarget(target: EventTarget | null): boolean {
  return hasClosest(target) && target.closest(ALLOWED_CONTEXT_MENU_SELECTOR) !== null;
}

export function useContextMenuPrevention() {
  useEffect(() => {
    if (import.meta.env.MODE === "production") {
      const handleContextMenu = (event: MouseEvent) => {
        if (isContextMenuAllowedTarget(event.target)) return;
        event.preventDefault();
      };

      document.addEventListener("contextmenu", handleContextMenu);

      return () => {
        document.removeEventListener("contextmenu", handleContextMenu);
      };
    }
  }, []);
}

export const __test__ = {
  isContextMenuAllowedTarget,
};
