import services from "@/config/services.json";
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { ProviderApiKeyCommand } from "../provider-api-key-command";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import { getApiBase } from "@/utils/api-base";

export function ApiErrorActions({
  code,
  providerId,
  onRetry,
}: {
  code: string;
  providerId: string;
  onRetry?: () => void | Promise<void>;
}) {
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { signIn, isSigningIn, reopen, cancel } = useDesktopSignIn();
  const hosted = providerId === "athas";
  const authentication = code === "401";
  const payment = code === "402";
  const configure = authentication || code === "403" || payment;
  const run = async (action: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete the action.");
    } finally {
      setBusy(false);
    }
  };
  const openSettings = () => useUIState.getState().openSettings("ai");
  const recover = () => {
    if (hosted && payment)
      return openUrl(new URL(new URL(services.dashboardBillingUrl).pathname, getApiBase()).href);
    if (hosted && authentication) return signIn();
    if (configure && !hosted) {
      setKeyManagerOpen(true);
      return;
    }
    if (hosted && code === "403") return openSettings();
    if (onRetry) return onRetry();
    openSettings();
  };
  const label =
    hosted && payment
      ? "Manage billing"
      : hosted && authentication
        ? "Sign in to Athas"
        : configure && !hosted
          ? "Configure provider"
          : hosted && code === "403"
            ? "Configure models"
            : onRetry
              ? "Try again"
              : "Configure models";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="default" disabled={busy || isSigningIn} onClick={() => void run(recover)}>
        {isSigningIn ? "Waiting for browser…" : busy ? "Working…" : label}
      </Button>
      {isSigningIn ? (
        <>
          <Button variant="ghost" onClick={() => void run(reopen)}>
            Open sign-in page
          </Button>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </>
      ) : label !== "Configure models" ? (
        <Button variant="ghost" onClick={openSettings}>
          Model settings
        </Button>
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
