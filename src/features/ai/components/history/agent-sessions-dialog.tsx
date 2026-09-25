import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import { selectAcpAgentStatus } from "@/features/ai/lib/acp-session-state";
import { importAgentSession } from "@/features/ai/lib/import-agent-session";
import {
  OPEN_AGENT_SESSIONS_EVENT,
  canDeleteAgentSessions,
} from "@/features/ai/lib/open-agent-sessions";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AcpSessionInfo } from "@/features/ai/types/acp.types";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import Dialog, { showConfirmDialog } from "@/ui/dialog";
import { EmptyState } from "@/ui/empty";
import { FieldError } from "@/ui/field";
import { HistoryIcon, TrashIcon } from "@/ui/icons";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/ui/item";
import { Spinner } from "@/ui/spinner";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function describeSession(session: AcpSessionInfo): string {
  const updatedAt = session.updatedAt ? new Date(session.updatedAt) : null;
  const relative = updatedAt ? getRelativeTime(updatedAt) : "";
  return relative ? `Updated ${relative}` : session.sessionId;
}

function AgentSessionsBrowser({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const workspacePath = useProjectStore((state) => state.rootFolderPath ?? null);
  const canDelete = useAIChatStore((state) =>
    canDeleteAgentSessions(selectAcpAgentStatus(state, agentId, workspacePath)),
  );
  const heldSessionIds = useAIChatStore((state) =>
    state.chats
      .filter((chat) => chat.agentId === agentId && chat.acpSessionId)
      .map((chat) => chat.acpSessionId)
      .join("\n"),
  );
  const [sessions, setSessions] = useState<AcpSessionInfo[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);

  const loadPage = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await AcpStreamHandler.listSessions({
          agentId,
          workspacePath,
          cwd: workspacePath ?? undefined,
          cursor,
        });
        setSessions((previous) => (cursor ? [...previous, ...page.sessions] : page.sessions));
        setNextCursor(page.nextCursor ?? null);
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setLoading(false);
      }
    },
    [agentId, workspacePath],
  );

  useEffect(() => {
    void loadPage(null);
  }, [loadPage]);

  const importSession = async (session: AcpSessionInfo) => {
    setBusySessionId(session.sessionId);
    try {
      await importAgentSession(agentId, session);
      onClose();
    } catch (reason) {
      toast.error("Couldn't import the session", { description: errorMessage(reason) });
    } finally {
      setBusySessionId(null);
    }
  };

  const deleteSession = async (session: AcpSessionInfo) => {
    const confirmed = await showConfirmDialog(
      `Delete “${session.title || session.sessionId}” from the agent? This cannot be undone.`,
      { title: "Delete agent session", confirmLabel: "Delete" },
    );
    if (!confirmed) return;
    setBusySessionId(session.sessionId);
    try {
      await AcpStreamHandler.deleteSession(agentId, session.sessionId);
      setSessions((previous) => previous.filter((item) => item.sessionId !== session.sessionId));
    } catch (reason) {
      toast.error("Couldn't delete the session", { description: errorMessage(reason) });
    } finally {
      setBusySessionId(null);
    }
  };

  const held = new Set(heldSessionIds.split("\n"));

  return (
    <Dialog
      title="Agent sessions"
      icon={HistoryIcon}
      onClose={onClose}
      size="lg"
      scrollable
      contentLayout="form"
      footer={
        nextCursor ? (
          <Button disabled={loading} onClick={() => void loadPage(nextCursor)}>
            Load more
          </Button>
        ) : null
      }
    >
      {error ? <FieldError>{error}</FieldError> : null}
      {sessions.length > 0 ? (
        <ItemGroup>
          {sessions.map((session) => {
            const title = session.title || "Untitled session";
            const isHeld = held.has(session.sessionId);
            const isBusy = busySessionId === session.sessionId;
            return (
              <Item role="listitem" key={session.sessionId}>
                <ItemContent>
                  <ItemTitle title={title}>{title}</ItemTitle>
                  <ItemDescription>{describeSession(session)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  {isBusy ? <Spinner compact /> : null}
                  <Button
                    disabled={busySessionId !== null}
                    onClick={() => void importSession(session)}
                  >
                    {isHeld ? "Open chat" : "Import"}
                  </Button>
                  {canDelete ? (
                    <Button
                      variant="ghost"
                      tone="danger"
                      iconOnly
                      tooltip={`Delete ${title}`}
                      aria-label={`Delete ${title}`}
                      disabled={busySessionId !== null || isHeld}
                      onClick={() => void deleteSession(session)}
                    >
                      <TrashIcon />
                    </Button>
                  ) : null}
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      ) : null}
      {loading ? <Spinner showLabel label="Loading sessions" /> : null}
      {!loading && !error && sessions.length === 0 ? (
        <EmptyState
          title="No agent sessions"
          message="This agent has no sessions for the current workspace."
        />
      ) : null}
    </Dialog>
  );
}

/** Lists the running agent's own sessions for the workspace, to import or delete them. */
export function AgentSessionsDialog() {
  const [agentId, setAgentId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => setAgentId((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN_AGENT_SESSIONS_EVENT, open);
    return () => window.removeEventListener(OPEN_AGENT_SESSIONS_EVENT, open);
  }, []);
  return agentId ? (
    <AgentSessionsBrowser key={agentId} agentId={agentId} onClose={() => setAgentId(null)} />
  ) : null;
}
