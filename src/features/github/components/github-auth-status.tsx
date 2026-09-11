import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { EmptyState } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { getGhCliAvailability } from "../services/github-credential-service";
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
  const openSettingsDialog = useUIState((s) => s.openSettingsDialog);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const [canUseGhCli, setCanUseGhCli] = useState(false);

  // The account token wins over `gh` under the automatic order, so an authenticated
  // `gh` install is worth offering directly rather than burying it in settings.
  useEffect(() => {
    let cancelled = false;
    void getGhCliAvailability()
      .then((availability) => {
        if (!cancelled) setCanUseGhCli(availability.hasToken);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const { signIn, isSigningIn } = useDesktopSignIn({
    apiBase: GITHUB_ACCOUNT_API_BASE,
    onSuccess: () => void checkAuth({ force: true }),
  });

  const retry = () => void checkAuth({ force: true });
  const openGitHubConnection = () => void openUrl(GITHUB_CONNECTION_URL);

  const useGhCli = async () => {
    await updateSetting("githubTokenSource", "gh");
    await checkAuth({ force: true });
  };

  // An organization that has not approved the Athas GitHub app stays unreachable with
  // the account token, so offer a per-user credential as a first-class way out: the
  // `gh` token when it is already there, the settings for a pasted token otherwise.
  const ownCredentialAction = canUseGhCli
    ? ({ label: "Use GitHub CLI", onClick: () => void useGhCli(), variant: "ghost" } as const)
    : ({
        label: "Use your own token",
        onClick: () => openSettingsDialog("git", "GitHub Account"),
        variant: "ghost",
      } as const);

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
        secondaryAction={ownCredentialAction}
      />
    );
  }

  if (githubAccountStatus === "notConnected") {
    return (
      <EmptyState
        layout={layout}
        title="GitHub not connected"
        action={{ label: "Connect GitHub", onClick: openGitHubConnection }}
        secondaryAction={ownCredentialAction}
        tertiaryAction={{ label: "Retry", onClick: retry, variant: "ghost" }}
      />
    );
  }

  return (
    <EmptyState
      layout={layout}
      title="GitHub not authenticated"
      action={{ label: "Connect GitHub", onClick: openGitHubConnection }}
      secondaryAction={ownCredentialAction}
      tertiaryAction={{ label: "Retry", onClick: retry, variant: "ghost" }}
    />
  );
}
