import { useMemo } from "react";
import { useAgentSessionContext } from "@/features/ai/hooks/use-agent-session-context";
import { getLatestSessionPlan } from "../services/session-plan";
import { getSessionPills } from "../services/session-pills";
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
  const agentCommandFailed = useSessionPanelStore((state) =>
    Boolean(state.attention[chatId]?.activity),
  );
  const { context, messages } = useAgentSessionContext(chatId);
  const plan = messages ? getLatestSessionPlan(messages) : null;
  const runningCommand =
    context.commands.find((command) => command.phase === "running")?.command ?? null;
  const planDone = plan?.done ?? 0;
  const planTotal = plan?.entries.length ?? 0;

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
        agentCommandFailed,
        runningCommand,
        plan: planTotal > 0 ? { done: planDone, total: planTotal } : null,
      }),
    [
      panel.open,
      whileOpen,
      context.changes.length,
      context.additions,
      context.deletions,
      liveServer,
      terminalFailed,
      agentCommandFailed,
      runningCommand,
      planDone,
      planTotal,
    ],
  );
}
