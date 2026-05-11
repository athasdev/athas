import { WarningCircle as AlertCircle } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/ui/button";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { LoadingIndicator } from "@/ui/loading";
import { GITHUB_ACCOUNT_API_BASE, GITHUB_CONNECTION_URL } from "../services/github-token-service";
import { useGitHubStore } from "../stores/github-store";

export function GitHubAuthStatusMessage() {
  const githubAccountStatus = useGitHubStore((s) => s.githubAccountStatus);
  const isCheckingAuth = useGitHubStore((s) => s.isCheckingAuth);
  const checkAuth = useGitHubStore((s) => s.actions.checkAuth);
  const isAthasAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isAthasAuthLoading = useAuthStore((s) => s.isLoading);
  const { signIn, isSigningIn } = useDesktopSignIn({
    apiBase: GITHUB_ACCOUNT_API_BASE,
    onSuccess: () => void checkAuth({ force: true }),
  });

  const retry = () => void checkAuth({ force: true });
  const openGitHubConnection = () => void openUrl(GITHUB_CONNECTION_URL);

  if (
    isAthasAuthLoading ||
    isCheckingAuth ||
    (isAthasAuthenticated && githubAccountStatus === "unknown")
  ) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <LoadingIndicator label="Checking GitHub account" showLabel compact />
      </div>
    );
  }

  if (!isAthasAuthenticated || githubAccountStatus === "notSignedIn") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="mb-2 text-text-lighter" />
        <p className="ui-text-sm text-text">GitHub account required</p>
        <p className="ui-text-sm mt-1 text-text-lighter">
          Sign in to Athas to use your connected GitHub account.
        </p>
        <Button
          onClick={() => void signIn().catch(() => undefined)}
          variant="ghost"
          compact
          disabled={isSigningIn}
          className="mt-2 h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
          aria-label="Sign in to Athas"
        >
          {isSigningIn ? "Signing in..." : "Sign in"}
        </Button>
      </div>
    );
  }

  if (githubAccountStatus === "notConnected") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="mb-2 text-text-lighter" />
        <p className="ui-text-sm text-text">GitHub not connected</p>
        <p className="ui-text-sm mt-1 text-text-lighter">
          Connect your account to use PRs, Issues, Actions, and Releases.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button
            onClick={openGitHubConnection}
            variant="ghost"
            className="h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
            aria-label="Connect GitHub"
            compact
          >
            Connect GitHub
          </Button>
          <span className="text-border">|</span>
          <Button
            onClick={retry}
            variant="ghost"
            className="h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
            aria-label="Retry authentication check"
            compact
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
      <AlertCircle className="mb-2 text-text-lighter" />
      <p className="ui-text-sm text-text">GitHub not authenticated</p>
      <p className="ui-text-sm mt-1 text-text-lighter">Connect GitHub, then retry this view.</p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          onClick={openGitHubConnection}
          variant="ghost"
          className="h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
          aria-label="Connect GitHub"
          compact
        >
          Connect GitHub
        </Button>
        <span className="text-border">|</span>
        <Button
          onClick={retry}
          variant="ghost"
          className="h-auto px-0 text-accent hover:bg-transparent hover:text-accent/80"
          aria-label="Retry authentication check"
          compact
        >
          Retry
        </Button>
      </div>
    </div>
  );
}
