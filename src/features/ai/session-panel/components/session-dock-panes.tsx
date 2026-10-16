import { lazy, Suspense, useEffect } from "react";
import { useAgentSessionContext } from "@/features/ai/hooks/use-agent-session-context";
import { openAgentSessionReview } from "@/features/ai/lib/agent-session-context";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { DockPaneProps } from "@/features/layout/services/dock-pane-registry";
import { useDockLayoutStore } from "@/features/layout/stores/dock-layout.store";
import { findPaneGroupByBufferId } from "@/features/panes/services/pane-tree";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { ListChecksIcon, SquareArrowUpIcon } from "@/ui/icons";
import { getLatestSessionPlan } from "../services/session-plan";
import {
  getSessionDockOwner,
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

/** An open tool has nothing new to mark: what the user sees clears its mark. */
function useClearAttention(chatId: string, tab: SessionPanelTab) {
  const marked = useSessionPanelStore((state) => Boolean(state.attention[chatId]?.[tab]));
  useEffect(() => {
    if (marked) useSessionPanelStore.getState().actions.clearAttention(chatId, tab);
  }, [chatId, marked, tab]);
}

function OpenInTabButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      iconOnly
      tooltip={label}
      aria-label={label}
      onClick={onClick}
    >
      <SquareArrowUpIcon />
    </Button>
  );
}

export function SessionChangesPane({ owner }: DockPaneProps) {
  return <SessionChangesView chatId={owner.id} />;
}

export function SessionChangesDetail({ owner }: DockPaneProps) {
  const { context } = useAgentSessionContext(owner.id);
  return context.changes.length > 0 ? context.changes.length : null;
}

export function SessionChangesActions({ owner }: DockPaneProps) {
  const { context } = useAgentSessionContext(owner.id);
  if (context.changes.length === 0) return null;
  return (
    <OpenInTabButton
      label="Open changes in a tab"
      onClick={() => openAgentSessionReview(context.changes)}
    />
  );
}

function useSessionWorkspacePath(chatId: string) {
  return useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === chatId)?.workspacePath ?? undefined,
  );
}

export function SessionTerminalPane({ owner, focusRequested }: DockPaneProps) {
  const chatId = owner.id;
  const panel = useSessionPanel(chatId);
  const workingDirectory = useSessionWorkspacePath(chatId);
  useClearAttention(chatId, "terminal");
  return (
    <Suspense fallback={null}>
      <SessionTerminalView
        key={panel.terminalGeneration}
        terminalId={getSessionTerminalId(chatId, panel.terminalGeneration)}
        workingDirectory={workingDirectory}
        takeFocus={focusRequested}
      />
    </Suspense>
  );
}

export function SessionTerminalActions({ owner }: DockPaneProps) {
  const chatId = owner.id;
  const panel = useSessionPanel(chatId);
  const workingDirectory = useSessionWorkspacePath(chatId);
  return (
    <OpenInTabButton
      label="Move terminal to a tab"
      onClick={() => {
        useBufferStore.getState().actions.openTerminalBuffer({
          sessionId: getSessionTerminalId(chatId, panel.terminalGeneration),
          workingDirectory,
          name: "Agent Terminal",
        });
        useSessionPanelStore.getState().actions.detachTerminal(chatId);
        useDockLayoutStore.getState().actions.close(getSessionDockOwner(chatId), "terminal");
      }}
    />
  );
}

export function SessionBrowserPane({ owner }: DockPaneProps) {
  const chatId = owner.id;
  const agentBufferId = useBufferStore(
    (state) =>
      state.buffers.find((buffer) => buffer.type === "agent" && buffer.sessionId === chatId)?.id,
  );
  const paneId = usePaneStore((state) =>
    agentBufferId ? findPaneGroupByBufferId(state.root, agentBufferId)?.id : undefined,
  );
  useClearAttention(chatId, "browser");
  return (
    <Suspense fallback={null}>
      <SessionBrowserView chatId={chatId} paneId={paneId} agentBufferId={agentBufferId} />
    </Suspense>
  );
}

export function SessionBrowserActions({ owner }: DockPaneProps) {
  const panel = useSessionPanel(owner.id);
  return (
    <OpenInTabButton
      label="Open page in a tab"
      onClick={() => {
        useBufferStore.getState().actions.openBrowserBuffer(panel.browserUrl || undefined);
        useDockLayoutStore.getState().actions.close(getSessionDockOwner(owner.id), "browser");
      }}
    />
  );
}

function useSessionPlan(chatId: string) {
  const { messages } = useAgentSessionContext(chatId);
  return messages ? getLatestSessionPlan(messages) : null;
}

export function SessionPlanPane({ owner }: DockPaneProps) {
  const plan = useSessionPlan(owner.id);
  if (!plan) {
    return (
      <EmptyState
        layout="sidebar"
        icon={<ListChecksIcon />}
        message="The plan the agent keeps for its turn shows up here."
      />
    );
  }
  return <SessionPlanView plan={plan} />;
}

export function SessionPlanDetail({ owner }: DockPaneProps) {
  const plan = useSessionPlan(owner.id);
  return plan ? `${plan.done}/${plan.entries.length}` : null;
}
