import { AlertCircle, CircleDot, CornerDownRight, History, LoaderCircle, X } from "lucide-react";
import { pickContinueRecentRuntimeSession } from "@/features/ai/lib/harness-session-actions";
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

interface HarnessRailRecentRuntimeSession {
  path: string;
  title: string;
  detail: string;
  isCurrent: boolean;
}

interface HarnessSessionRailProps {
  sessions: HarnessRailSession[];
  activeSession: HarnessRailActiveSession;
  recentRuntimeSessions?: HarnessRailRecentRuntimeSession[];
  canReopenClosedSession: boolean;
  onReopenClosedSession: () => void;
  onSelectSession: (sessionKey: string) => void;
  onCloseSession: (bufferId: string) => void;
  onOpenRuntimeSession?: (sessionPath: string) => void;
  onContinueRecentRuntimeSession?: (sessionPath: string) => void;
}

function getSessionDotTone(state: HarnessTrustStateKind): string {
  switch (state) {
    case "running":
      return "text-blue-400";
    case "attention":
      return "text-yellow-400";
    case "error":
      return "text-red-400";
    default:
      return "text-transparent";
  }
}

function getStatusTone(state: HarnessTrustStateKind): string {
  switch (state) {
    case "running":
      return "text-blue-300";
    case "attention":
      return "text-yellow-300";
    case "error":
      return "text-red-300";
    default:
      return "text-text-lighter";
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
  recentRuntimeSessions = [],
  canReopenClosedSession,
  onReopenClosedSession,
  onSelectSession,
  onCloseSession,
  onOpenRuntimeSession,
  onContinueRecentRuntimeSession,
}: HarnessSessionRailProps) {
  const StatusIcon = getStatusIcon(activeSession.status.kind);
  const continueRecentSession = pickContinueRecentRuntimeSession(recentRuntimeSessions);

  return (
    <aside className="flex h-full w-full shrink-0 flex-col gap-4 bg-transparent px-2 py-4">
      <section className="px-2">
        <div className="mb-2 flex items-center justify-between gap-2 font-medium text-[11px] text-text-lighter uppercase tracking-[0.16em] opacity-40">
          <div className="flex items-center gap-2">
            <span>Sessions</span>
          </div>
          <div className="flex items-center gap-2">
            {canReopenClosedSession ? (
              <button
                type="button"
                onClick={onReopenClosedSession}
                className="flex items-center justify-center text-text-lighter transition-colors hover:text-text"
                aria-label="Reopen the most recently closed Harness session"
                title="Reopen the most recently closed Harness session"
              >
                <History size={12} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="space-y-2">
          {sessions.map((session) => (
            <div key={session.bufferId} className="group flex items-center gap-2 py-1.5 text-sm">
              <button
                type="button"
                onClick={() => onSelectSession(session.sessionKey)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  className={cn(
                    "truncate transition-colors",
                    session.isActive
                      ? "font-medium text-text"
                      : "text-text-lighter/60 hover:text-text-lighter",
                  )}
                >
                  {session.title}
                </span>
                {session.isDefault ? (
                  <span className="shrink-0 text-[10px] text-text-lighter/40">Main</span>
                ) : null}
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full bg-current",
                    getSessionDotTone(session.state),
                    session.state === "running" && "animate-pulse",
                  )}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                onClick={() => onCloseSession(session.bufferId)}
                className="flex size-5 shrink-0 items-center justify-center text-text-lighter/0 transition-colors hover:text-text group-hover:text-text-lighter"
                aria-label={`Close ${session.title}`}
                title={`Close ${session.title}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {recentRuntimeSessions.length > 0 && onOpenRuntimeSession ? (
        <section className="mt-6 px-2">
          <div className="mb-2 flex items-center justify-between gap-2 font-medium text-[11px] text-text-lighter uppercase tracking-[0.16em] opacity-40">
            <div className="flex items-center gap-2">
              <span>Recent Pi</span>
            </div>
            {continueRecentSession && onContinueRecentRuntimeSession ? (
              <button
                type="button"
                onClick={() => onContinueRecentRuntimeSession(continueRecentSession.path)}
                className="flex items-center justify-center text-text-lighter transition-colors hover:text-text"
                aria-label="Continue the latest Pi session"
                title="Continue the latest Pi session"
              >
                <CornerDownRight size={12} />
              </button>
            ) : null}
          </div>
          <div className="space-y-1.5">
            {recentRuntimeSessions.map((session) => (
              <button
                key={session.path}
                type="button"
                onClick={() => onOpenRuntimeSession(session.path)}
                className="group flex w-full items-start gap-2 py-1 text-left text-sm transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate transition-colors",
                      session.isCurrent
                        ? "font-medium text-text"
                        : "text-text-lighter/60 group-hover:text-text-lighter",
                    )}
                  >
                    {session.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-text-lighter/40 group-hover:text-text-lighter/60">
                    {session.detail}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {activeSession.status.showRailStatus ? (
        <section className="mt-auto px-2">
          <div className={cn("px-2 text-xs opacity-80", getStatusTone(activeSession.status.kind))}>
            <div className="flex items-start gap-2">
              <StatusIcon
                size={12}
                className={cn(
                  "mt-[3px] shrink-0",
                  activeSession.status.kind === "running" && "animate-spin",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-text">{activeSession.status.stateLabel}</div>
                {activeSession.status.detail ? (
                  <div className="mt-0.5 text-current/70">{activeSession.status.detail}</div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </aside>
  );
}
