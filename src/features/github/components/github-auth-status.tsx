import { WarningCircleIcon as AlertCircle } from "@/ui/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Spinner } from "@/ui/spinner";
import { GITHUB_ACCOUNT_API_BASE, GITHUB_CONNECTION_URL } from "../services/github-token-service";
import { useGitHubStore } from "../stores/github.store";

function GitHubAuthState({
  title,
  description,
  error,
  children,
  tone = "neutral",
}: {
  title: string;
  description: string;
  error?: string | null;
  children?: ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <Empty
      density="compact"
      tone={tone}
      className="rounded-none p-4"
      role={tone === "error" ? "alert" : undefined}
    >
      <EmptyHeader>
        <EmptyMedia>
          <AlertCircle />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
        {error ? <EmptyDescription>{error}</EmptyDescription> : null}
      </EmptyHeader>
      {children ? <EmptyContent className="flex-row">{children}</EmptyContent> : null}
    </Empty>
  );
}

export function GitHubAuthStatusMessage() {
  const githubAccountStatus = useGitHubStore((s) => s.githubAccountStatus);
  const authError = useGitHubStore((s) => s.authError);
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
      <Empty density="compact" className="rounded-none p-4">
        <EmptyDescription>
          <Spinner label="Checking GitHub account" showLabel compact />
        </EmptyDescription>
      </Empty>
    );
  }

  if (authError && githubAccountStatus === "unknown") {
    return (
      <GitHubAuthState
        title="GitHub is temporarily unavailable"
        description={authError}
        tone="error"
      >
        <Button
          onClick={retry}
          variant="ghost"
          className="h-auto px-0 text-primary hover:bg-transparent hover:text-primary/80"
          aria-label="Retry GitHub authentication check"
          size="xs"
        >
          Retry
        </Button>
      </GitHubAuthState>
    );
  }

  if (!isAthasAuthenticated || githubAccountStatus === "notSignedIn") {
    return (
      <GitHubAuthState
        title="GitHub account required"
        description="Sign in to Athas to use your connected GitHub account."
        error={authError}
      >
        <Button
          onClick={() => void signIn().catch(() => undefined)}
          variant="ghost"
          size="xs"
          disabled={isSigningIn}
          className="h-auto px-0 text-primary hover:bg-transparent hover:text-primary/80"
          aria-label="Sign in to Athas"
        >
          {isSigningIn ? "Signing in..." : "Sign in"}
        </Button>
      </GitHubAuthState>
    );
  }

  if (githubAccountStatus === "notConnected") {
    return (
      <GitHubAuthState
        title="GitHub not connected"
        description="Connect your account to use PRs, Issues, Actions, and Releases."
        error={authError}
      >
        <Button
          onClick={openGitHubConnection}
          variant="ghost"
          className="h-auto px-0 text-primary hover:bg-transparent hover:text-primary/80"
          aria-label="Connect GitHub"
          size="xs"
        >
          Connect GitHub
        </Button>
        <Button
          onClick={retry}
          variant="ghost"
          className="h-auto px-0 text-primary hover:bg-transparent hover:text-primary/80"
          aria-label="Retry authentication check"
          size="xs"
        >
          Retry
        </Button>
      </GitHubAuthState>
    );
  }

  return (
    <GitHubAuthState
      title="GitHub not authenticated"
      description="Connect GitHub, then retry this view."
      error={authError}
    >
      <Button
        onClick={openGitHubConnection}
        variant="ghost"
        className="h-auto px-0 text-primary hover:bg-transparent hover:text-primary/80"
        aria-label="Connect GitHub"
        size="xs"
      >
        Connect GitHub
      </Button>
      <Button
        onClick={retry}
        variant="ghost"
        className="h-auto px-0 text-primary hover:bg-transparent hover:text-primary/80"
        aria-label="Retry authentication check"
        size="xs"
      >
        Retry
      </Button>
    </GitHubAuthState>
  );
}
