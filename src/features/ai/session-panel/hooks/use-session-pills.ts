import { useEffect, useMemo, useState } from "react";
import { useAgentSessionContext } from "@/features/ai/hooks/use-agent-session-context";
import { getLatestSessionPlan } from "../services/session-plan";
import { getSessionPills, SHORT_COMMAND_MS } from "../services/session-pills";
import { useSessionPanel, useSessionPanelStore } from "../stores/session-panel.store";

/**
 * The signals a session shows as pills while its tool card is collapsed. `whileOpen` reads them
 * while the card is expanded too, for the card's switcher.
 */
export function useSessionPills(chatId: string, whileOpen = false) {
  const panel = useSessionPanel(chatId);
  const liveServer = useSessionPanelStore((state) => state.liveServers[chatId] ?? null);
  const terminalFailed = useSessionPanelStore((state) =>
    Boolean(state.attention[chatId]?.terminal),
  );
  const { context, messages } = useAgentSessionContext(chatId);
  const plan = messages ? getLatestSessionPlan(messages) : null;
  const running = context.commands.find(
    (command) => command.phase === "running" || command.phase === "background",
  );
  const runningCommand = running?.command ?? null;
  const startedAt = running?.timestamp ?? 0;
  const planDone = plan?.done ?? 0;
  const planTotal = plan?.entries.length ?? 0;
  const [now, setNow] = useState(() => Date.now());

  // A short command turns live once it has kept running for a while, so look again then.
  useEffect(() => {
    if (!runningCommand) return;
    const remaining = startedAt + SHORT_COMMAND_MS - Date.now();
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, remaining) + 50);
    return () => clearTimeout(timer);
  }, [runningCommand, startedAt]);

  return useMemo(
    () =>
      getSessionPills({
        panelOpen: panel.open && !whileOpen,
        changes: {
          files: context.changes.length,
          additions: context.additions,
          deletions: context.deletions,
        },
        liveServer,
        terminalFailed,
        runningCommand: runningCommand ? { command: runningCommand, startedAt } : null,
        plan: planTotal > 0 ? { done: planDone, total: planTotal } : null,
        now,
      }),
    [
      panel.open,
      whileOpen,
      context.changes.length,
      context.additions,
      context.deletions,
      liveServer,
      terminalFailed,
      runningCommand,
      startedAt,
      planDone,
      planTotal,
      now,
    ],
  );
}
