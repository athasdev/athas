import { AlertCircle, CircleDot, History, LoaderCircle, Plus, Sparkles, X } from "lucide-react";
import type { HarnessTrustState, HarnessTrustStateKind } from "@/features/ai/types/chat-ui";
import { cn } from "@/utils/cn";

interface HarnessRailSession {
  bufferId: string;
  sessionKey: string;
  title: string;
  isActive: boolean;
  isDefault: boolean;
  state: HarnessTrustStateKind;
}

interface HarnessRailActiveSession {
  status: HarnessTrustState;
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

function getSessionDotTone(state: HarnessTrustStateKind): string {
  switch (state) {
    case "running":
      return "bg-blue-400";
    case "attention":
      return "bg-yellow-400";
    case "error":
      return "bg-red-400";
    default:
      return "bg-text-lighter/35";
  }
}

function getStatusTone(state: HarnessTrustStateKind): string {
  switch (state) {
    case "running":
      return "border-blue-500/20 bg-blue-500/10 text-blue-200";
    case "attention":
      return "border-yellow-500/20 bg-yellow-500/10 text-yellow-200";
    case "error":
      return "border-red-500/20 bg-red-500/10 text-red-200";
    default:
      return "border-border/70 bg-secondary-bg/50 text-text-lighter";
  }
}

function getStatusIcon(state: HarnessTrustStateKind) {
  switch (state) {
    case "running":
      return LoaderCircle;
    case "attention":
    case "error":
      return AlertCircle;
    default:
      return CircleDot;
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
  const StatusIcon = getStatusIcon(activeSession.status.kind);

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
                {session.isDefault ? (
                  <span className="shrink-0 rounded-full border border-border/80 bg-primary-bg/75 px-1.5 py-0.5 font-medium text-[10px] text-text-lighter uppercase tracking-wide">
                    Main
                  </span>
                ) : null}
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    getSessionDotTone(session.state),
                    session.state === "running" && "animate-pulse",
                  )}
                  aria-hidden="true"
                />
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

      {activeSession.status.showRailStatus ? (
        <section className="rounded-xl border border-border/80 bg-primary-bg/55 p-2.5">
          <div
            className={cn(
              "rounded-xl border px-3 py-2.5 text-xs",
              getStatusTone(activeSession.status.kind),
            )}
          >
            <div className="flex items-start gap-2">
              <StatusIcon
                size={13}
                className={cn(
                  "mt-0.5 shrink-0",
                  activeSession.status.kind === "running" && "animate-spin",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{activeSession.status.stateLabel}</div>
                {activeSession.status.detail ? (
                  <div className="mt-1 text-[11px] text-current/80">
                    {activeSession.status.detail}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </aside>
  );
}
