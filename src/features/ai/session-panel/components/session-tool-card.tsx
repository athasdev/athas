import { lazy, type ReactNode, Suspense, useLayoutEffect, useRef, useState } from "react";
import { useAgentSessionContext } from "@/features/ai/hooks/use-agent-session-context";
import { openAgentSessionReview } from "@/features/ai/lib/agent-session-context";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import {
  ArrowsInIcon,
  ArrowsOutIcon,
  GitDiffIcon,
  GlobeIcon,
  ListChecksIcon,
  SquareArrowUpIcon,
  TerminalIcon,
  XIcon,
} from "@/ui/icons";
import { SidebarTabBar, SidebarTabPanels } from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import { animateCard, type CardRect, takeCardOrigin } from "../services/card-motion";
import { getSessionToolTabs } from "../services/session-boxes";
import { getLatestSessionPlan } from "../services/session-plan";
import {
  getSessionTerminalId,
  useSessionPanel,
  useSessionPanelStore,
} from "../stores/session-panel.store";
import type { SessionPanelTab } from "../types/session-panel.types";
import { SessionChangesView } from "./session-changes-view";
import { SessionPlanView } from "./session-plan-view";

const SessionBrowserView = lazy(() =>
  import("./session-browser-view").then((module) => ({ default: module.SessionBrowserView })),
);
const SessionTerminalView = lazy(() =>
  import("./session-terminal-view").then((module) => ({ default: module.SessionTerminalView })),
);

const TOOLS: Record<SessionPanelTab, { label: string; icon: ReactNode }> = {
  changes: { label: "Changes", icon: <GitDiffIcon /> },
  browser: { label: "Browser", icon: <GlobeIcon /> },
  terminal: { label: "Terminal", icon: <TerminalIcon /> },
  plan: { label: "Plan", icon: <ListChecksIcon /> },
};

interface SessionToolCardProps {
  chatId: string;
  agentBufferId: string;
  paneId: string | undefined;
  workingDirectory: string | undefined;
  /** `split`: beside the conversation; `cover`: over it, in fullscreen or a narrow session. */
  placement: "split" | "cover";
  /** What the card's right edge meets: the rail of folded boxes, or the session's edge. */
  beside: "rail" | "edge";
}

/**
 * The tool a session box or the header opened, as a larger card beside the conversation, or over
 * it in fullscreen. Native content (the browser page, the terminal) mounts only once the card
 * stops moving, since a native view can't follow a CSS animation.
 */
export function SessionToolCard({
  chatId,
  agentBufferId,
  paneId,
  workingDirectory,
  placement,
  beside,
}: SessionToolCardProps) {
  const panel = useSessionPanel(chatId);
  const attention = useSessionPanelStore((state) => state.attention[chatId]);
  const actions = useSessionPanelStore.use.actions();
  const { context, messages } = useAgentSessionContext(chatId);
  const plan = messages ? getLatestSessionPlan(messages) : null;
  const tab: SessionPanelTab = panel.tab === "plan" && !plan ? "changes" : panel.tab;
  const cardRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<CardRect | null>(null);
  const resizeFromRef = useRef<CardRect | null>(null);
  const closingRef = useRef(false);
  const [settled, setSettled] = useState(false);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    originRef.current = takeCardOrigin(chatId);
    let cancelled = false;
    void animateCard(card, originRef.current, "in").then(() => {
      if (!cancelled) setSettled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const from = resizeFromRef.current;
    if (!card || !from) return;
    resizeFromRef.current = null;
    let cancelled = false;
    void animateCard(card, from, "in").then(() => {
      if (!cancelled) setSettled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [panel.fullscreen]);

  const close = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setSettled(false);
    if (cardRef.current) await animateCard(cardRef.current, originRef.current, "out");
    actions.close(chatId);
  };

  const toggleFullscreen = () => {
    const card = cardRef.current;
    if (card) resizeFromRef.current = card.getBoundingClientRect();
    setSettled(false);
    actions.toggleFullscreen(chatId);
  };

  const openInTab = () => {
    const buffers = useBufferStore.getState().actions;
    if (tab === "changes") {
      openAgentSessionReview(context.changes);
    } else if (tab === "browser") {
      buffers.openBrowserBuffer(panel.browserUrl || undefined);
    } else if (tab === "terminal") {
      setSettled(false);
      buffers.openTerminalBuffer({
        sessionId: getSessionTerminalId(chatId, panel.terminalGeneration),
        workingDirectory,
        name: "Agent Terminal",
      });
      actions.detachTerminal(chatId);
    }
    void close();
  };

  const canOpenInTab =
    (tab === "changes" && context.changes.length > 0) || tab === "browser" || tab === "terminal";

  const items = getSessionToolTabs(plan !== null).map((tool) => ({
    id: tool,
    ...TOOLS[tool],
    badge:
      tool === "changes"
        ? context.changes.length || undefined
        : tool === "plan" && plan
          ? `${plan.done}/${plan.entries.length}`
          : undefined,
    attention:
      tool === "browser" && attention?.browser
        ? { tone: "info" as const, label: "new activity" }
        : tool === "terminal" && attention?.terminal
          ? { tone: "error" as const, label: "a command failed" }
          : undefined,
  }));

  const content: Record<SessionPanelTab, ReactNode> = {
    changes: <SessionChangesView chatId={chatId} />,
    browser: (
      <Suspense fallback={null}>
        <SessionBrowserView chatId={chatId} paneId={paneId} agentBufferId={agentBufferId} />
      </Suspense>
    ),
    terminal: (
      <Suspense fallback={null}>
        <SessionTerminalView
          chatId={chatId}
          terminalId={getSessionTerminalId(chatId, panel.terminalGeneration)}
          workingDirectory={workingDirectory}
        />
      </Suspense>
    ),
    plan: plan ? <SessionPlanView plan={plan} /> : null,
  };

  return (
    <Card
      ref={cardRef}
      variant={placement === "cover" ? "elevated" : "default"}
      plane={placement === "cover" ? "overlay" : "surface"}
      layout="flush"
      role="region"
      aria-label={`${TOOLS[tab].label}, session tools`}
      data-slot="session-tool-card"
      data-placement={placement}
      data-fullscreen={panel.fullscreen || undefined}
      className={cn(
        "origin-top-left",
        placement === "split"
          ? "mt-0.5 mr-2 mb-2 w-[calc(var(--spacing-session-tool-card)-0.5rem)] shrink-0"
          : [
              "absolute top-0.5 bottom-2 left-2 z-30",
              beside === "rail" ? "right-(--spacing-session-rail)" : "right-2",
            ],
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        void close();
      }}
    >
      <SidebarTabBar<SessionPanelTab>
        label="Session tools"
        value={tab}
        onChange={(next) => {
          actions.selectTab(chatId, next);
          actions.requestFocus(chatId, next);
        }}
        items={items}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              iconOnly
              active={panel.fullscreen}
              aria-pressed={panel.fullscreen}
              tooltip={panel.fullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={toggleFullscreen}
            >
              {panel.fullscreen ? <ArrowsInIcon /> : <ArrowsOutIcon />}
            </Button>
            {canOpenInTab ? (
              <Button
                type="button"
                variant="ghost"
                iconOnly
                tooltip="Open in new tab"
                onClick={openInTab}
              >
                <SquareArrowUpIcon />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              iconOnly
              tooltip="Close"
              shortcut="escape"
              onClick={() => void close()}
            >
              <XIcon />
            </Button>
          </>
        }
      >
        {settled ? (
          <SidebarTabPanels<SessionPanelTab>
            className="flex flex-col transition-opacity duration-fast ease-smooth starting:opacity-0 motion-reduce:transition-none"
            items={items.map((item) => ({ id: item.id, content: content[item.id] }))}
          />
        ) : (
          <div className="min-h-0 flex-1" />
        )}
      </SidebarTabBar>
    </Card>
  );
}
