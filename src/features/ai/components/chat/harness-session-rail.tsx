import { Activity, CircleDot, History, ListTodo, Plus, Sparkles, X } from "lucide-react";
import { getAcpPlanEntryCounts } from "@/features/ai/lib/chat-acp-activity";
import type { AcpPlanEntry } from "@/features/ai/types/acp";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";
import { cn } from "@/utils/cn";

interface HarnessRailSession {
  bufferId: string;
  sessionKey: string;
  title: string;
  isActive: boolean;
  isRunning: boolean;
}

interface HarnessRailActiveSession {
  isRunning: boolean;
  pendingPermissionCount: number;
  planEntries: AcpPlanEntry[];
  latestEvent: ChatAcpEvent | null;
}

interface HarnessSessionRailProps {
  sessions: HarnessRailSession[];
  activeSession: HarnessRailActiveSession;
  onCreateSession: () => void;
  canReopenClosedSession: boolean;
  onReopenClosedSession: () => void;
  onSelectSession: (sessionKey: string) => void;
  onCloseSession: (bufferId: string) => void;
}

function getEventTone(state: ChatAcpEvent["state"]): string {
  switch (state) {
    case "running":
      return "text-blue-400";
    case "success":
      return "text-green-400";
    case "error":
      return "text-red-400";
    default:
      return "text-text-lighter";
  }
}

export function HarnessSessionRail({
  sessions,
  activeSession,
  onCreateSession,
  canReopenClosedSession,
  onReopenClosedSession,
  onSelectSession,
  onCloseSession,
}: HarnessSessionRailProps) {
  const planCounts = getAcpPlanEntryCounts({
    planEntries: activeSession.planEntries,
    events: [],
    permissions: [],
  });
  const hasPlan = activeSession.planEntries.length > 0;
  const planSummary = hasPlan
    ? `${planCounts.completed}/${planCounts.total} done${
        planCounts.inProgress > 0 ? ` · ${planCounts.inProgress} active` : ""
      }`
    : "No active plan";
  const permissionSummary =
    activeSession.pendingPermissionCount > 0
      ? `${activeSession.pendingPermissionCount} pending`
      : "Clear";

  return (
    <aside className="flex h-full w-full shrink-0 flex-col gap-2.5 p-3">
      <section className="rounded-xl border border-border/80 bg-primary-bg/55 p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-text-lighter uppercase tracking-wide">
          <div className="flex items-center gap-2">
            <Sparkles size={12} />
            <span>Sessions</span>
          </div>
          <div className="flex items-center gap-1">
            {canReopenClosedSession ? (
              <button
                type="button"
                onClick={onReopenClosedSession}
                className="flex size-6 items-center justify-center rounded-full border border-border bg-secondary-bg/80 text-text-lighter transition-colors hover:bg-hover hover:text-text"
                aria-label="Reopen the most recently closed Harness session"
                title="Reopen the most recently closed Harness session"
              >
                <History size={12} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onCreateSession}
              className="flex size-6 items-center justify-center rounded-full border border-border bg-secondary-bg/80 text-text-lighter transition-colors hover:bg-hover hover:text-text"
              aria-label="Create new Harness session"
              title="Create new Harness session"
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {sessions.map((session) => (
            <div
              key={session.bufferId}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-2.5 py-2 text-xs transition-colors",
                session.isActive
                  ? "border-border bg-secondary-bg/90"
                  : "border-border/70 bg-secondary-bg/55",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectSession(session.sessionKey)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <CircleDot
                  size={10}
                  className={cn(
                    "shrink-0",
                    session.isActive ? "text-text" : "text-text-lighter/70",
                  )}
                />
                <span
                  className={cn(
                    "truncate",
                    session.isActive ? "font-medium text-text" : "text-text-lighter",
                  )}
                >
                  {session.title}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide",
                    session.isRunning
                      ? "bg-secondary-bg/90 text-text"
                      : "bg-secondary-bg text-text-lighter",
                  )}
                >
                  {session.isRunning ? "Running" : "Idle"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onCloseSession(session.bufferId)}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-text-lighter transition-colors hover:bg-hover hover:text-text"
                aria-label={`Close ${session.title}`}
                title={`Close ${session.title}`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border/80 bg-primary-bg/55 p-2.5">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-text-lighter uppercase tracking-wide">
          <Activity size={12} />
          <span>Live status</span>
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-secondary-bg/50 px-3 py-2">
            <span className="text-text-lighter">Session</span>
            <span
              className={cn(
                "font-medium",
                activeSession.isRunning ? "text-text" : "text-text-lighter",
              )}
            >
              {activeSession.isRunning ? "Running" : "Idle"}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-secondary-bg/50 px-3 py-2">
            <span className="text-text-lighter">Permissions</span>
            <span
              className={cn(
                "font-medium",
                activeSession.pendingPermissionCount > 0 ? "text-yellow-400" : "text-text-lighter",
              )}
            >
              {permissionSummary}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-secondary-bg/50 px-2.5 py-2">
            <span className="inline-flex items-center gap-1.5 text-text-lighter">
              <ListTodo size={11} />
              Plan
            </span>
            <span className={cn("font-medium", hasPlan ? "text-text" : "text-text-lighter")}>
              {planSummary}
            </span>
          </div>
          {activeSession.latestEvent ? (
            <div className="rounded-lg border border-border/70 bg-secondary-bg/50 px-3 py-2">
              <div className="mb-1 text-[10px] text-text-lighter uppercase tracking-wide">
                Latest
              </div>
              <div className="flex items-start gap-2 text-xs">
                <CircleDot
                  size={10}
                  className={cn("mt-0.5 shrink-0", getEventTone(activeSession.latestEvent.state))}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-text">
                    {activeSession.latestEvent.label}
                  </div>
                  {activeSession.latestEvent.detail ? (
                    <div className="mt-0.5 line-clamp-2 text-text-lighter">
                      {activeSession.latestEvent.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </aside>
  );
}
