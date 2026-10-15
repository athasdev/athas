import { useState } from "react";
import { toast } from "sonner";
import { showConfirmDialog } from "@/ui/dialog";
import { cancelCloudRun } from "../services/cloud-session";

/** Stops a cloud run after the user confirms; `stopping` is true while the request runs. */
export function useStopCloudRun(runId: string) {
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    const confirmed = await showConfirmDialog(
      "Stop this run? The agent's work so far is discarded, and the time used is still charged.",
      { title: "Stop cloud run", confirmLabel: "Stop" },
    );
    if (!confirmed) return;
    setStopping(true);
    try {
      await cancelCloudRun(runId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The run could not be stopped.");
    } finally {
      setStopping(false);
    }
  };
  return { stop, stopping };
}
