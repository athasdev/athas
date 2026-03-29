import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertCircle, Github, KeyRound, TerminalSquare } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import type { GitHubAuthStatus } from "../types/github";
import { useGitHubStore } from "../stores/github-store";

interface GitHubAuthSurfaceProps {
  authStatus: GitHubAuthStatus;
  repoPath?: string | null;
  onRetry: () => void;
}

const GITHUB_CLI_INSTALL_URL = "https://cli.github.com/manual/installation";

const GitHubAuthSurface = memo(({ authStatus, repoPath, onRetry }: GitHubAuthSurfaceProps) => {
  const openTerminalBuffer = useBufferStore.use.actions().openTerminalBuffer;
  const { storePatFallback, removePatFallback } = useGitHubStore().actions;
  const [isPatDialogOpen, setIsPatDialogOpen] = useState(false);
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isSavingToken, setIsSavingToken] = useState(false);
  const [isRemovingToken, setIsRemovingToken] = useState(false);

  const cliTitle = authStatus.cliAvailable ? "Connect with GitHub CLI" : "Install GitHub CLI";
  const helperText = useMemo(() => {
    if (!authStatus.cliAvailable) {
      return "GitHub CLI is not installed on this machine. Install it or use a personal access token fallback.";
    }

    if (authStatus.hasStoredPat && !authStatus.isAuthenticated) {
      return "Athas found a stored personal access token, but it is no longer authenticating successfully. Reconnect GitHub CLI or replace the token fallback.";
    }

    return "Athas prefers your local GitHub CLI session. You can also use a personal access token fallback when CLI auth is unavailable.";
  }, [authStatus.cliAvailable, authStatus.hasStoredPat, authStatus.isAuthenticated]);

  const handleCliAction = useCallback(async () => {
    if (!authStatus.cliAvailable) {
      await openUrl(GITHUB_CLI_INSTALL_URL);
      return;
    }

    openTerminalBuffer({
      name: "GitHub Login",
      command: "gh auth login",
      workingDirectory: repoPath ?? undefined,
    });
  }, [authStatus.cliAvailable, openTerminalBuffer, repoPath]);

  const handlePatSave = useCallback(async () => {
    setIsSavingToken(true);
    setTokenError(null);

    try {
      await storePatFallback(token);
      setIsPatDialogOpen(false);
      setToken("");
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingToken(false);
    }
  }, [storePatFallback, token]);

  const handleRemovePat = useCallback(async () => {
    setIsRemovingToken(true);
    setTokenError(null);

    try {
      await removePatFallback();
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRemovingToken(false);
    }
  }, [removePatFallback]);

  return (
    <>
      <div className="flex h-full flex-col gap-3 p-2">
        <div className="flex items-center justify-between px-0.5 py-0.5">
          <span className="ui-text-sm font-medium text-text">GitHub</span>
          <Button
            onClick={onRetry}
            variant="ghost"
            size="xs"
            className="h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
          >
            Retry
          </Button>
        </div>

        <div className="flex flex-1 flex-col justify-center rounded-2xl border border-border/60 bg-secondary-bg/60 p-4">
          <div className="mx-auto mb-3 grid size-10 place-content-center rounded-full bg-primary-bg/80 text-text-lighter">
            <Github className="size-5" />
          </div>

          <div className="space-y-2 text-center">
            <p className="ui-text-sm font-medium text-text">Connect GitHub</p>
            <p className="ui-text-sm text-text-lighter">{helperText}</p>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <Button
              onClick={() => void handleCliAction()}
              variant="outline"
              size="sm"
              className="justify-center rounded-xl"
            >
              <TerminalSquare />
              {cliTitle}
            </Button>

            <Button
              onClick={() => setIsPatDialogOpen(true)}
              variant="ghost"
              size="sm"
              className="justify-center rounded-xl"
            >
              <KeyRound />
              Use Personal Access Token
            </Button>
          </div>

          {authStatus.hasStoredPat && !authStatus.isAuthenticated ? (
            <div className="mt-4 rounded-xl border border-border/60 bg-primary-bg/70 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-text-lighter" />
                <div className="min-w-0 flex-1">
                  <p className="ui-text-sm text-text">Stored PAT fallback needs attention</p>
                  <p className="ui-text-sm mt-1 text-text-lighter">
                    The saved token is still present, but GitHub rejected it for the current repo
                    session.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => void handleRemovePat()}
                disabled={isRemovingToken}
                variant="ghost"
                size="xs"
                className="mt-3 h-auto px-0 text-text-lighter hover:bg-transparent hover:text-text"
              >
                Remove stored token
              </Button>
            </div>
          ) : null}

          <p className="ui-text-sm mt-4 text-center text-text-lighter">
            GitHub CLI stays the preferred auth source whenever both are available.
          </p>
        </div>
      </div>

      {isPatDialogOpen ? (
        <Dialog
          title="Personal Access Token"
          icon={KeyRound}
          onClose={() => {
            if (isSavingToken) return;
            setIsPatDialogOpen(false);
          }}
          size="md"
        >
          <div className="space-y-3">
            <p className="ui-text-sm text-text-lighter">
              Add a GitHub personal access token as a fallback for PRs, issues, and workflow runs.
              GitHub CLI remains the preferred path when it is available.
            </p>

            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="github_pat_..."
              autoFocus
            />

            {tokenError ? (
              <div className="rounded-xl border border-error/30 bg-error/5 px-3 py-2">
                <p className="ui-text-sm text-error/90">{tokenError}</p>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={() => setIsPatDialogOpen(false)}
                variant="ghost"
                size="sm"
                disabled={isSavingToken}
              >
                Cancel
              </Button>
              <Button onClick={() => void handlePatSave()} size="sm" disabled={isSavingToken}>
                Save Token
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
});

GitHubAuthSurface.displayName = "GitHubAuthSurface";

export default GitHubAuthSurface;
