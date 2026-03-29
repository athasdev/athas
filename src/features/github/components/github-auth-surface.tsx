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
      return "GitHub CLI is not installed on this machine. Install it or provide a personal access token.";
    }

    if (authStatus.hasStoredPat && !authStatus.isAuthenticated) {
      return "The stored personal access token is no longer authenticating successfully. Please reconnect or replace the token.";
    }

    return "Sign in to manage pull requests, issues, and workflow runs directly from your workspace.";
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

        <div className="flex flex-1 flex-col p-4 pt-10">
          <div className="mb-6 flex">
            <div className="flex size-10 items-center justify-center rounded-lg border border-border/60 bg-secondary-bg/40 text-text-lighter shadow-sm">
              <Github className="size-5" />
            </div>
          </div>

          <div className="mb-8 space-y-2">
            <h2 className="ui-font text-base font-medium text-text">Connect GitHub</h2>
            <p className="ui-text-sm leading-relaxed text-text-lighter">
              {helperText}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Button
              onClick={() => void handleCliAction()}
              variant="secondary"
              size="sm"
              className="h-auto w-full justify-start rounded-xl py-2 text-left font-medium whitespace-normal"
            >
              <TerminalSquare className="mr-1.5 size-4 shrink-0 opacity-70" />
              <span>{cliTitle}</span>
            </Button>

            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-border/40" />
              <span className="ui-font text-xs font-medium text-text-lighter/40 uppercase tracking-wider">OR</span>
              <div className="h-px flex-1 bg-border/40" />
            </div>

            <Button
              onClick={() => setIsPatDialogOpen(true)}
              variant="ghost"
              size="sm"
              className="h-auto w-full justify-start rounded-xl py-2 text-left text-text-lighter whitespace-normal hover:text-text"
            >
              <KeyRound className="mr-1.5 size-4 shrink-0 opacity-70" />
              <span>Use a personal access token</span>
            </Button>
          </div>

          {authStatus.hasStoredPat && !authStatus.isAuthenticated ? (
            <div className="mt-8 rounded-xl border border-error/20 bg-error/5 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-error/80" />
                <div className="min-w-0 flex-1">
                  <p className="ui-text-sm font-medium text-error/90">Authentication failed</p>
                  <p className="ui-text-sm mt-1 text-error/80">
                    The stored token was rejected by GitHub.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => void handleRemovePat()}
                disabled={isRemovingToken}
                variant="ghost"
                size="xs"
                className="mt-3 h-auto px-0 text-error/80 hover:bg-transparent hover:text-error"
              >
                Remove stored token
              </Button>
            </div>
          ) : null}
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
