import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { canFloatSessionPills } from "../services/session-pills";
import { useSessionPanel } from "../stores/session-panel.store";
import { SessionPillsPlacementContext, SessionSignalPills } from "./session-signal-pills";
import { SessionToolCard } from "./session-tool-card";

interface AgentSessionLayoutProps {
  chatId: string;
  agentBufferId: string;
  paneId: string | undefined;
  workingDirectory: string | undefined;
  children: ReactNode;
}

function useCanFloatPills() {
  const ref = useRef<HTMLDivElement>(null);
  const [canFloat, setCanFloat] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const remPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setCanFloat(canFloatSessionPills(element.clientWidth, remPx));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  return [ref, canFloat] as const;
}

/**
 * An agent session with its tools: pills on its right edge while they are collapsed, and the
 * card a pill grows into, which keeps the conversation readable beside it.
 */
export function AgentSessionLayout({
  chatId,
  agentBufferId,
  paneId,
  workingDirectory,
  children,
}: AgentSessionLayoutProps) {
  const panel = useSessionPanel(chatId);
  const [containerRef, canFloat] = useCanFloatPills();
  const placement = canFloat ? "floating" : "header";

  return (
    <div ref={containerRef} className="relative size-full min-h-0 overflow-hidden">
      <div
        className={cn(
          "flex size-full min-h-0 min-w-0 flex-col overflow-hidden transition-[padding] duration-normal ease-smooth motion-reduce:transition-none",
          panel.open && !panel.fullscreen && "pr-session-tool-card",
        )}
      >
        <SessionPillsPlacementContext.Provider value={placement}>
          {children}
        </SessionPillsPlacementContext.Provider>
      </div>
      {placement === "floating" ? (
        <SessionSignalPills chatId={chatId} placement="floating" />
      ) : null}
      {panel.open ? (
        <SessionToolCard
          key={chatId}
          chatId={chatId}
          agentBufferId={agentBufferId}
          paneId={paneId}
          workingDirectory={workingDirectory}
        />
      ) : null}
    </div>
  );
}
