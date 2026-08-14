import { openUrl } from "@tauri-apps/plugin-opener";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { EmptyState } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { GITHUB_ACCOUNT_API_BASE, GITHUB_CONNECTION_URL } from "../services/github-token-service";
import { useGitHubStore } from "../stores/github.store";

export function GitHubAuthStatusMessage({
  layout = "default",
}: {
  layout?: "default" | "sidebar";
}) {
  const githubAccountStatus = useGitHubStore.use.githubAccountStatus();
  const authError = useGitHubStore.use.authError();
  const isCheckingAuth = useGitHubStore.use.isCheckingAuth();
  const checkAuth = useGitHubStore.use.actions().checkAuth;
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
      <EmptyState
        layout={layout}
        message={<Spinner label="Checking GitHub account" showLabel compact />}
      />
    );
  }

  if (authError && githubAccountStatus === "unknown") {
    return (
      <EmptyState
        layout={layout}
        title="GitHub is temporarily unavailable"
        tone="error"
        role="alert"
        action={{ label: "Retry", onClick: retry }}
      />
    );
  }

  if (!isAthasAuthenticated || githubAccountStatus === "notSignedIn") {
    return (
      <EmptyState
        layout={layout}
        title="GitHub account required"
        action={{
          label: isSigningIn ? "Signing in..." : "Sign in",
          disabled: isSigningIn,
          onClick: () => void signIn().catch(() => undefined),
        }}
      />
    );
  }

  if (githubAccountStatus === "notConnected") {
    return (
      <EmptyState
        layout={layout}
        title="GitHub not connected"
        action={{ label: "Connect GitHub", onClick: openGitHubConnection }}
        secondaryAction={{ label: "Retry", onClick: retry, variant: "ghost" }}
      />
    );
  }

  return (
    <EmptyState
      layout={layout}
      title="GitHub not authenticated"
      action={{ label: "Connect GitHub", onClick: openGitHubConnection }}
      secondaryAction={{ label: "Retry", onClick: retry, variant: "ghost" }}
    />
  );
}
