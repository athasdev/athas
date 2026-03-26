import {
  Activity,
  BookCopy,
  Boxes,
  CircleDot,
  History,
  ListTodo,
  Plus,
  Slash,
  Sparkles,
  X,
} from "lucide-react";
import { getAcpPlanEntryCounts } from "@/features/ai/lib/chat-acp-activity";
import type { AcpPlanEntry } from "@/features/ai/types/acp";
import { AGENT_OPTIONS } from "@/features/ai/types/ai-chat";
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
  title: string;
  currentAgentId?: string;
  providerLabel: string;
  activeModeLabel: string;
  selectedBufferCount: number;
  selectedFileCount: number;
  queueCount: number;
  steeringQueueCount: number;
  followUpQueueCount: number;
  pendingPermissionCount: number;
  hasSlashCommands: boolean;
  acpEvents: ChatAcpEvent[];
  planEntries: AcpPlanEntry[];
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

function getAgentLabel(agentId?: string): string {
  const agent = AGENT_OPTIONS.find((entry) => entry.id === agentId);
  if (!agent) return "Custom API";
  return agent.name;
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
  const recentEvents = activeSession.acpEvents.slice(-6).reverse();
  const planCounts = getAcpPlanEntryCounts({
    planEntries: activeSession.planEntries,
    events: [],
    permissions: [],
  });

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col gap-3 border-border/70 border-l bg-secondary-bg/55 p-3">
      <section className="rounded-2xl border border-border bg-primary-bg/85 p-3">
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
                  ? "border-blue-500/30 bg-blue-500/10"
                  : "border-border/70 bg-secondary-bg/70",
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
                    session.isActive ? "text-blue-300" : "text-text-lighter/70",
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
                      ? "bg-blue-500/15 text-blue-300"
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

      {activeSession.planEntries.length > 0 ? (
        <section className="rounded-2xl border border-border bg-primary-bg/85 p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] text-text-lighter uppercase tracking-wide">
            <ListTodo size={12} />
            <span>Plan</span>
          </div>
          <div className="mb-2 text-text-lighter text-xs">
            {planCounts.completed}/{planCounts.total} done
            {planCounts.inProgress > 0 ? ` · ${planCounts.inProgress} active` : ""}
          </div>
          <div className="space-y-1.5">
            {activeSession.planEntries.slice(0, 4).map((entry, index) => (
              <div
                key={`${entry.content}-${index}`}
                className="rounded-xl border border-border/70 bg-secondary-bg/70 px-2.5 py-2 text-xs"
              >
                <div className="truncate font-medium text-text">{entry.content}</div>
                <div className="mt-0.5 text-[10px] text-text-lighter uppercase tracking-wide">
                  {entry.status.replace("_", " ")}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-primary-bg/85 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-text-lighter uppercase tracking-wide">
          <Boxes size={12} />
          <span>Runtime</span>
        </div>
        <div className="space-y-2 text-xs">
          <div>
            <div className="text-text-lighter">Agent</div>
            <div className="font-medium text-text">
              {getAgentLabel(activeSession.currentAgentId)}
            </div>
          </div>
          <div>
            <div className="text-text-lighter">Transport</div>
            <div className="font-medium text-text">{activeSession.providerLabel}</div>
          </div>
          <div>
            <div className="text-text-lighter">Mode</div>
            <div className="font-medium text-text">{activeSession.activeModeLabel}</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-primary-bg/85 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-text-lighter uppercase tracking-wide">
          <BookCopy size={12} />
          <span>Context</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-border/70 bg-secondary-bg/70 px-2.5 py-2">
            <div className="text-text-lighter">Buffers</div>
            <div className="mt-1 font-medium text-text">{activeSession.selectedBufferCount}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-secondary-bg/70 px-2.5 py-2">
            <div className="text-text-lighter">Files</div>
            <div className="mt-1 font-medium text-text">{activeSession.selectedFileCount}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-secondary-bg/70 px-2.5 py-2">
            <div className="text-text-lighter">Queued</div>
            <div className="mt-1 font-medium text-text">{activeSession.queueCount}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-secondary-bg/70 px-2.5 py-2">
            <div className="text-text-lighter">Steering</div>
            <div className="mt-1 font-medium text-text">{activeSession.steeringQueueCount}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-secondary-bg/70 px-2.5 py-2">
            <div className="text-text-lighter">Follow-up</div>
            <div className="mt-1 font-medium text-text">{activeSession.followUpQueueCount}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-secondary-bg/70 px-2.5 py-2">
            <div className="text-text-lighter">Permissions</div>
            <div className="mt-1 font-medium text-text">{activeSession.pendingPermissionCount}</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-primary-bg/85 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-text-lighter uppercase tracking-wide">
          <Slash size={12} />
          <span>Controls</span>
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary-bg/70 px-2.5 py-2">
            <span className="text-text-lighter">Slash commands</span>
            <span
              className={cn(
                "font-medium",
                activeSession.hasSlashCommands ? "text-text" : "text-text-lighter",
              )}
            >
              {activeSession.hasSlashCommands ? "Ready" : "Idle"}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary-bg/70 px-2.5 py-2">
            <span className="text-text-lighter">Awaiting approval</span>
            <span
              className={cn(
                "font-medium",
                activeSession.pendingPermissionCount > 0 ? "text-yellow-400" : "text-text",
              )}
            >
              {activeSession.pendingPermissionCount > 0 ? "Yes" : "No"}
            </span>
          </div>
        </div>
      </section>

      <section className="min-h-0 flex-1 rounded-2xl border border-border bg-primary-bg/85 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-text-lighter uppercase tracking-wide">
          <Activity size={12} />
          <span>Recent activity</span>
        </div>
        {recentEvents.length === 0 ? (
          <div className="flex h-full min-h-24 items-center justify-center rounded-xl border border-border/70 border-dashed bg-secondary-bg/40 px-4 text-center text-text-lighter text-xs">
            Harness activity will appear here as the session runs.
          </div>
        ) : (
          <div className="space-y-2">
            {recentEvents.map((event) => (
              <div
                key={event.id}
                className="rounded-xl border border-border/70 bg-secondary-bg/70 px-2.5 py-2 text-xs"
              >
                <div className="flex items-start gap-2">
                  <CircleDot
                    size={10}
                    className={cn("mt-0.5 shrink-0", getEventTone(event.state))}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-text">{event.label}</div>
                    {event.detail ? (
                      <div className="mt-0.5 line-clamp-2 text-text-lighter">{event.detail}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
