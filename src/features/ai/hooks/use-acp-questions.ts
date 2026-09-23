import { useCallback, useEffect, useRef, useState } from "react";
import type { AcpElicitationRequest, AcpElicitationResponse } from "../lib/acp-elicitation";
import { AcpStreamHandler } from "../services/acp-stream-handler";

export type AcpQuestion = { requestId: string; request: AcpElicitationRequest };

/**
 * Questions agents ask through ACP `elicitation/create`, answered one at a time. The agent waits on
 * each, so a question nobody can answer anymore (stop, unmount) is cancelled rather than dropped.
 */
export function useAcpQuestions() {
  const [queue, setQueue] = useState<AcpQuestion[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const cancelAll = useCallback(() => {
    for (const question of queueRef.current) {
      void AcpStreamHandler.respondToElicitation(question.requestId, { action: "cancel" }).catch(
        () => undefined,
      );
    }
    setQueue([]);
  }, []);

  useEffect(() => cancelAll, [cancelAll]);

  const enqueue = useCallback((question: AcpQuestion) => {
    setQueue((current) =>
      current.some((item) => item.requestId === question.requestId)
        ? current
        : [...current, question],
    );
  }, []);

  const answer = useCallback(async (requestId: string, response: AcpElicitationResponse) => {
    try {
      await AcpStreamHandler.respondToElicitation(requestId, response);
    } finally {
      setQueue((current) => current.filter((item) => item.requestId !== requestId));
    }
  }, []);

  /** Forget questions after the agent run ended; the agent already resolved them as cancelled. */
  const clear = useCallback(() => setQueue([]), []);

  return {
    current: queue[0],
    queuedCount: Math.max(0, queue.length - 1),
    enqueue,
    answer,
    cancelAll,
    clear,
  };
}
