import { useEffect, useState } from "react";
import { type CloudAgentLogLine, getCloudAgentRunLogs } from "./cloud-agents-api";

const POLL_INTERVAL_MS = 3000;
const PAGE_SIZE = 500;

/** A run's log, read from the start and then followed while the run is active. */
export function useCloudAgentLogs(runId: string, active: boolean) {
  const [lines, setLines] = useState<CloudAgentLogLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cursor = 0;
    let cancelled = false;
    let timer: number | undefined;
    setLines([]);
    setError(null);

    const read = async () => {
      try {
        while (!cancelled) {
          const page = await getCloudAgentRunLogs(runId, cursor);
          if (cancelled) return;
          cursor = page.cursor;
          if (page.lines.length) setLines((current) => [...current, ...page.lines]);
          if (page.lines.length < PAGE_SIZE) break;
        }
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Logs are unavailable.");
      }
      if (!cancelled && active) timer = window.setTimeout(read, POLL_INTERVAL_MS);
    };
    void read();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [runId, active]);

  return { lines, error };
}
