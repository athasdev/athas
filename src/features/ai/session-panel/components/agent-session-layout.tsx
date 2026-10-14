import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getSessionAsideLayout } from "../services/session-boxes";
import { useSessionPanel, useSessionPanelStore } from "../stores/session-panel.store";
import { SessionAsideLayoutContext } from "./session-aside";

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, remPx: 16 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const remPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = element.clientWidth;
      setSize((current) =>
        current.width === width && current.remPx === remPx ? current : { width, remPx },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

/**
 * An agent session, measured so its boxes and open tool fit beside the conversation: a column of
 * boxes when there is room, a rail of their icons when there is not or a tool needs the room.
 */
export function AgentSessionLayout({ chatId, children }: { chatId: string; children: ReactNode }) {
  const panel = useSessionPanel(chatId);
  const boxesHidden = useSessionPanelStore((state) => state.boxesHidden);
  const [ref, { width, remPx }] = useWidth();
  const layout = getSessionAsideLayout({
    width,
    remPx,
    toolOpen: panel.open,
    fullscreen: panel.fullscreen,
    boxesHidden,
  });
  const { boxes, tool } = layout;
  const value = useMemo(() => ({ boxes, tool }), [boxes, tool]);

  return (
    <div
      ref={ref}
      data-agent-session-chat={chatId}
      data-session-boxes={boxes}
      data-session-tool={tool}
      className="relative size-full min-h-0 overflow-hidden"
    >
      <SessionAsideLayoutContext.Provider value={value}>
        {children}
      </SessionAsideLayoutContext.Provider>
    </div>
  );
}
