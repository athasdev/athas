import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  applyWorkspaceEdit,
  fileUriFromPath,
  isWorkspaceEdit,
} from "@/features/editor/lsp/workspace-edit";
import { toast } from "sonner";

function getActiveLspClient() {
  return LspClient.getInstance();
}

function getActiveJavaFilePath(): string | null {
  const state = useBufferStore.getState();
  const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
  if (activeBuffer?.type === "editor" && activeBuffer.path.endsWith(".java")) {
    return activeBuffer.path;
  }

  return (
    getActiveLspClient()
      .getActiveServerEntries()
      .find((entry) => entry.languageId === "java" && entry.filePath)?.filePath ?? null
  );
}

export async function organizeJavaImports(): Promise<void> {
  const filePath = getActiveJavaFilePath();
  if (!filePath) {
    toast.info("Open a Java file to organize imports.");
    return;
  }

  try {
    const result = await getActiveLspClient().executeCommand(
      filePath,
      "java.edit.organizeImports",
      [fileUriFromPath(filePath)],
    );
    if (isWorkspaceEdit(result)) {
      await applyWorkspaceEdit(result);
    }
    toast.success("Java imports organized.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to organize Java imports.");
  }
}

export async function refreshJavaProject(): Promise<void> {
  const filePath = getActiveJavaFilePath();
  if (!filePath) {
    toast.info("Open a Java file to refresh its project.");
    return;
  }

  try {
    await getActiveLspClient().executeCommand(filePath, "java.project.import");
    toast.success("Java project refreshed.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to refresh the Java project.");
  }
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
