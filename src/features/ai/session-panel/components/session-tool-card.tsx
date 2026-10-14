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
import { useSessionPills } from "../hooks/use-session-pills";
import { animateCard, type CardRect, takeCardOrigin } from "../services/card-motion";
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

const TOOL_ORDER: SessionPanelTab[] = ["changes", "browser", "terminal", "plan"];
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
}

/**
 * A session tool expanded from its pill into a card over the right part of the session, or over
 * all of it in fullscreen. Native content (the browser page, the terminal) mounts only once the
 * card stops moving, since a native view can't follow a CSS animation.
 */
export function SessionToolCard({
  chatId,
  agentBufferId,
  paneId,
  workingDirectory,
}: SessionToolCardProps) {
  const panel = useSessionPanel(chatId);
  const attention = useSessionPanelStore((state) => state.attention[chatId]);
  const actions = useSessionPanelStore.use.actions();
  const pills = useSessionPills(chatId, true);
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

  const collapse = async () => {
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
    void collapse();
  };

  const available = new Set<SessionPanelTab>([tab]);
  for (const pill of pills) available.add(pill.tab);
  for (const marked of Object.keys(attention ?? {})) available.add(marked as SessionPanelTab);
  if (!plan) available.delete("plan");
  const canOpenInTab =
    (tab === "changes" && context.changes.length > 0) || tab === "browser" || tab === "terminal";

  const items = TOOL_ORDER.filter((tool) => available.has(tool)).map((tool) => ({
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
      variant="elevated"
      plane="overlay"
      layout="flush"
      role="region"
      aria-label={`${TOOLS[tab].label}, session tools`}
      data-slot="session-tool-card"
      data-fullscreen={panel.fullscreen || undefined}
      className={cn(
        "absolute z-10030 origin-top-left",
        panel.fullscreen
          ? "inset-1.5"
          : "top-pane-header right-2 bottom-2 w-[calc(var(--spacing-session-tool-card)-0.75rem)]",
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        void collapse();
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
              onClick={() => void collapse()}
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
