import { useEffect } from "react";

const SELECTION_SCOPE_CLASS = "selection-scope-active";
const ACTIVE_SCOPE_ATTR = "data-selection-scope-active";
const ROOT_SCOPE_ATTR = "data-selection-scope-root";

export function useSelectionScope(root: React.RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const element = root.current;
    if (!enabled || !element) return;

    element.setAttribute(ROOT_SCOPE_ATTR, "true");

    const deactivate = () => {
      element.removeAttribute(ACTIVE_SCOPE_ATTR);
      document.body.classList.remove(SELECTION_SCOPE_CLASS);
    };

    const activate = (event: MouseEvent) => {
      if (event.button !== 0) return;
      element.setAttribute(ACTIVE_SCOPE_ATTR, "true");
      document.body.classList.add(SELECTION_SCOPE_CLASS);
    };

    element.addEventListener("mousedown", activate, { capture: true });
    window.addEventListener("mouseup", deactivate);
    window.addEventListener("blur", deactivate);
    document.addEventListener("visibilitychange", deactivate);
    document.addEventListener("dragend", deactivate);

    return () => {
      element.removeEventListener("mousedown", activate, { capture: true });
      window.removeEventListener("mouseup", deactivate);
      window.removeEventListener("blur", deactivate);
      document.removeEventListener("visibilitychange", deactivate);
      document.removeEventListener("dragend", deactivate);
      element.removeAttribute(ROOT_SCOPE_ATTR);
      deactivate();
    };
  }, [enabled, root]);
}
