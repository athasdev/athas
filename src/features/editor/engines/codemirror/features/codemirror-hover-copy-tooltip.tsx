import { useEffect, useState } from "react";
import { AnchoredTooltip } from "@/ui/tooltip";
import type { CodeMirrorHost } from "../host";

const COPY_BUTTON_SELECTOR = ".hover-copy-button";
/** How long the pointer or focus rests on a copy button before its tooltip shows. */
const COPY_TOOLTIP_DELAY_MS = 150;

/** The "Copy" tooltip for copy buttons inside the editor's hover cards. */
export function CodeMirrorHoverCopyTooltip({ host }: { host: CodeMirrorHost }) {
  const { container } = host;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    const clearTimer = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    };
    const getCopyButton = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>(COPY_BUTTON_SELECTOR) : null;
    const show = (event: Event) => {
      const copyButton = getCopyButton(event.target);
      if (!copyButton || !container.contains(copyButton)) return;
      if (event.type === "mouseover") event.stopPropagation();
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        if (!container.contains(copyButton)) return;
        setAnchor(copyButton);
      }, COPY_TOOLTIP_DELAY_MS);
    };
    const hide = (event: Event) => {
      const copyButton = getCopyButton(event.target);
      if (!copyButton) return;
      const relatedTarget = event instanceof MouseEvent ? event.relatedTarget : null;
      if (relatedTarget instanceof Node && copyButton.contains(relatedTarget)) return;
      clearTimer();
      setAnchor((current) => (current === copyButton ? null : current));
    };
    // A hover card that closes takes its button with it; drop the tooltip too.
    const observer = new MutationObserver(() => {
      setAnchor((current) => (current && !container.contains(current) ? null : current));
    });
    observer.observe(container, { childList: true, subtree: true });
    container.addEventListener("mouseover", show, true);
    container.addEventListener("mouseout", hide, true);
    container.addEventListener("focusin", show, true);
    container.addEventListener("focusout", hide, true);
    return () => {
      clearTimer();
      observer.disconnect();
      container.removeEventListener("mouseover", show, true);
      container.removeEventListener("mouseout", hide, true);
      container.removeEventListener("focusin", show, true);
      container.removeEventListener("focusout", hide, true);
      setAnchor(null);
    };
  }, [container]);

  return <AnchoredTooltip anchor={anchor} content="Copy" />;
}
