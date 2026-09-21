import { Alert, AlertDescription } from "@/ui/alert";
import { useState } from "react";
import { ProviderApiKeyCommand } from "../provider-api-key-command";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Button } from "@/ui/button";

export function ProviderConnectionAction({ providerId }: { providerId: string }) {
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountError = useAuthStore((state) => state.error);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const refreshSubscription = useAuthStore((state) => state.actions.refreshSubscription);
  const checkApiKey = useAIChatStore((state) => state.actions.checkApiKey);
  const { signIn, isSigningIn, error: signInError, cancel, reopen } = useDesktopSignIn();
  const hosted = providerId === "athas";

  const connect = async () => {
    if (!hosted) {
      setKeyManagerOpen(true);
      return;
    }
    setError(null);
    setIsRefreshing(true);
    try {
      if (isAuthenticated) {
        const connected = await refreshSubscription();
        if (!connected)
          throw new Error(useAuthStore.getState().error || "Could not connect to Athas.");
      } else await signIn();
      await checkApiKey(providerId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not connect to Athas.");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex max-w-sm flex-col items-end gap-2">
      <Button
        type="button"
        variant="accent"
        disabled={isSigningIn || isRefreshing}
        onClick={() => void connect()}
      >
        {isSigningIn
          ? "Waiting for browser…"
          : isRefreshing
            ? "Connecting…"
            : hosted
              ? isAuthenticated
                ? "Retry connection"
                : "Sign in to Athas"
              : "Add API key"}
      </Button>
      {hosted && isSigningIn ? (
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void reopen()}>
            Open sign-in page
          </Button>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : null}
      {error || (hosted && (accountError || signInError)) ? (
        <Alert tone="warning">
          <AlertDescription>{error || signInError || accountError}</AlertDescription>
        </Alert>
      ) : null}
      {!hosted ? (
        <ProviderApiKeyCommand
          isOpen={keyManagerOpen}
          onClose={() => setKeyManagerOpen(false)}
          initialProviderId={providerId}
        />
      ) : null}
    </div>
  );
}
