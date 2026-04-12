import { useLspStore } from "@/features/editor/lsp/lsp-store";
import { toast } from "@/ui/toast";

interface LspStartupNotifierDeps {
  setError: (message: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
}

interface MissingServerParams {
  filePath: string;
  languageId?: string;
}

interface StartFailureParams {
  filePath: string;
  languageId?: string;
  error: unknown;
}

const getFileLabel = (filePath: string) => {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || filePath;
};

const getLanguageLabel = (languageId?: string) => {
  if (!languageId) return "language";
  return languageId;
};

export function stringifyStartupError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export function buildMissingServerMessage({ filePath, languageId }: MissingServerParams) {
  return `Could not start ${getLanguageLabel(languageId)} language server for ${getFileLabel(filePath)} because no server binary is configured or installed.`;
}

export function buildStartFailureMessage({ filePath, languageId, error }: StartFailureParams) {
  return `Failed to start ${getLanguageLabel(languageId)} language server for ${getFileLabel(filePath)}: ${stringifyStartupError(error)}`;
}

export function buildWorkspacePathMessage(filePath: string) {
  return `Could not start language server for ${getFileLabel(filePath)} because no workspace path could be determined.`;
}

export function buildMissingServerStatusMessage({ filePath, languageId }: MissingServerParams) {
  return `${getLanguageLabel(languageId)} language server unavailable for ${getFileLabel(filePath)}`;
}

export function buildStartFailureStatusMessage({ filePath, languageId }: StartFailureParams) {
  return `Failed to start ${getLanguageLabel(languageId)} language server for ${getFileLabel(filePath)}`;
}

export function buildWorkspacePathStatusMessage(filePath: string) {
  return `Language server unavailable for ${getFileLabel(filePath)}`;
}

export function createLspStartupNotifier({
  setError,
  showError,
  showWarning,
}: LspStartupNotifierDeps) {
  const reportedIssueKeys = new Set<string>();

  const notifyOnce = (issueKey: string, notify: () => void) => {
    if (reportedIssueKeys.has(issueKey)) return;
    reportedIssueKeys.add(issueKey);
    notify();
  };

  return {
    reportMissingServer(params: MissingServerParams) {
      const message = buildMissingServerMessage(params);
      const statusMessage = buildMissingServerStatusMessage(params);
      const issueKey = `missing-server:${params.filePath}`;
      setError(statusMessage);
      notifyOnce(issueKey, () => showError(message));
      return message;
    },

    reportStartFailure(params: StartFailureParams) {
      const message = buildStartFailureMessage(params);
      const statusMessage = buildStartFailureStatusMessage(params);
      const issueKey = `start-failure:${params.filePath}`;
      setError(statusMessage);
      notifyOnce(issueKey, () => showError(message));
      return message;
    },

    reportMissingWorkspace(filePath: string) {
      const message = buildWorkspacePathMessage(filePath);
      const statusMessage = buildWorkspacePathStatusMessage(filePath);
      const issueKey = `missing-workspace:${filePath}`;
      setError(statusMessage);
      notifyOnce(issueKey, () => showWarning(message));
      return message;
    },

    clearForFile(filePath: string) {
      reportedIssueKeys.delete(`missing-server:${filePath}`);
      reportedIssueKeys.delete(`start-failure:${filePath}`);
      reportedIssueKeys.delete(`missing-workspace:${filePath}`);
    },
  };
}

export const lspStartupNotifier = createLspStartupNotifier({
  setError: (message) => useLspStore.getState().actions.setLspError(message),
  showError: (message) => {
    toast.error(message);
  },
  showWarning: (message) => {
    toast.warning(message);
  },
});
