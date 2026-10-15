import { useCloudEnvironmentStore } from "../stores/cloud-environment.store";
import { getCloudAgentRunLogs } from "./cloud-agents-api";

/** Pages read per call at most, so a runaway log cannot keep one read going forever. */
const MAX_PAGES = 40;
const reading = new Map<string, Promise<void>>();

/**
 * Reads what a run logged since the last read into the log store. Calls for a run already being
 * read share that read.
 */
export function readCloudRunLog(runId: string): Promise<void> {
  const current = reading.get(runId);
  if (current) return current;
  const read = (async () => {
    const { actions } = useCloudEnvironmentStore.getState();
    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const cursor = useCloudEnvironmentStore.getState().logs[runId]?.cursor ?? 0;
        const result = await getCloudAgentRunLogs(runId, cursor);
        const loaded = useCloudEnvironmentStore.getState().logs[runId]?.loaded ?? false;
        if (result.lines.length > 0 || !loaded)
          actions.appendLog(runId, result.lines, result.cursor);
        if (result.lines.length === 0 || result.cursor === cursor) break;
      }
    } catch (error) {
      actions.setLogError(
        runId,
        error instanceof Error ? error.message : "The log is unavailable.",
      );
    }
  })().finally(() => reading.delete(runId));
  reading.set(runId, read);
  return read;
}
