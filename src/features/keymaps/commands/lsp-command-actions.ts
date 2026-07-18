import { LspClient } from "@/features/editor/lsp/lsp-client";
import { toast } from "sonner";

function getActiveLspClient() {
  return LspClient.getInstance();
}

export async function restartAllLanguageServers(): Promise<void> {
  const lspClient = getActiveLspClient();
  if (lspClient.getActiveServerEntries().length === 0) {
    toast.info("No active language servers.");
    return;
  }

  try {
    await lspClient.restartAllTrackedServers();
    toast.success("Language servers restarted.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to restart language servers.");
  }
}

export async function stopAllLanguageServers(): Promise<void> {
  const lspClient = getActiveLspClient();
  if (lspClient.getActiveServerEntries().length === 0) {
    toast.info("No active language servers.");
    return;
  }

  try {
    await lspClient.stopAll();
    toast.success("Language servers stopped.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to stop language servers.");
  }
}
