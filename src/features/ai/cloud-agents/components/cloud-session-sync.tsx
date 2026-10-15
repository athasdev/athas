import { useEffect, useRef } from "react";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatCloudRun } from "@/features/ai/types/ai-chat.types";
import { useCloudRun } from "../hooks/use-cloud-runs";
import { isActiveCloudAgentRun } from "../services/cloud-agents-api";
import { readCloudRunLog } from "../services/cloud-run-log";
import { buildCloudRunTranscript } from "../services/cloud-run-transcript";
import { selectCloudRunLog, useCloudEnvironmentStore } from "../stores/cloud-environment.store";

const LOG_POLL_MS = 3000;
const NO_RUNS: ChatCloudRun[] = [];

/**
 * Writes one run's log into its reply while the session is open: read and followed while the run
 * works, read once afterwards when the reply has nothing in it yet.
 */
function CloudRunSync({
  chatId,
  messageId,
  runId,
}: {
  chatId: string;
  messageId: string;
  runId: string;
}) {
  const run = useCloudRun(runId);
  const active = run ? isActiveCloudAgentRun(run) : null;
  const log = useCloudEnvironmentStore((state) => selectCloudRunLog(state, runId));
  const isEmpty = useAIChatStore((state) => {
    const message = state.messagesByChat[chatId]?.find((candidate) => candidate.id === messageId);
    return Boolean(message && !message.content && !message.toolCalls?.length);
  });
  const needsLog = active === true || (active === false && (isEmpty || log.loaded));

  useEffect(() => {
    if (!needsLog) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const read = async () => {
      await readCloudRunLog(runId);
      if (!cancelled && active) timer = setTimeout(() => void read(), LOG_POLL_MS);
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, needsLog, runId]);

  useEffect(() => {
    if (active === null || (!log.loaded && active)) return;
    const { actions } = useAIChatStore.getState();
    const message = actions
      .getMessagesForChat(chatId)
      .find((candidate) => candidate.id === messageId);
    if (!message) return;
    if (!log.loaded) {
      if (message.isStreaming)
        actions.queueMessageUpdate(chatId, messageId, {
          isStreaming: false,
          responsePhase: undefined,
        });
      return;
    }
    const transcript = buildCloudRunTranscript(log.lines);
    if (
      message.content === transcript.content &&
      (message.toolCalls?.length ?? 0) === transcript.toolCalls.length &&
      Boolean(message.isStreaming) === active &&
      !active
    )
      return;
    const update = {
      content: transcript.content,
      toolCalls: transcript.toolCalls,
      plan: transcript.plan ?? undefined,
      isStreaming: active,
      responsePhase:
        active && !transcript.content && !transcript.toolCalls.length
          ? ("starting" as const)
          : undefined,
    };
    if (active) actions.queueMessageUpdate(chatId, messageId, update);
    else actions.updateMessage(chatId, messageId, update);
  }, [active, chatId, log.lines, log.loaded, messageId]);

  const streaming = useRef(active);
  streaming.current = active;
  useEffect(
    () => () => {
      if (streaming.current)
        useAIChatStore
          .getState()
          .actions.queueMessageUpdate(chatId, messageId, { isStreaming: false });
    },
    [chatId, messageId],
  );

  return null;
}

/** Keeps an open cloud session's replies in step with its runs. */
export function CloudSessionSync({ chatId }: { chatId: string }) {
  const runs = useAIChatStore(
    (state) =>
      state.chats.find((chat) => chat.id === chatId)?.sessionSettings?.cloud?.runs ?? NO_RUNS,
  );
  return runs.map((entry) =>
    entry.runId ? (
      <CloudRunSync
        key={entry.messageId}
        chatId={chatId}
        messageId={entry.messageId}
        runId={entry.runId}
      />
    ) : null,
  );
}
