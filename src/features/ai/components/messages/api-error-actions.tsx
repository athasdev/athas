import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { ProviderApiKeyCommand } from "../provider-api-key-command";
import { HOSTED_BILLING_CODES, resolveBillingUrl } from "@/features/ai/lib/api-error";
import { openNewAgentChat } from "@/features/ai/lib/open-new-agent-chat";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";

export function ApiErrorActions({
  code,
  serverCode,
  billingUrl,
  providerId,
  onRetry,
}: {
  code: string;
  /** The server's own reason, such as `insufficient_balance`, when it sent one. */
  serverCode?: string;
  billingUrl?: string;
  providerId: string;
  onRetry?: () => void | Promise<void>;
}) {
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { signIn, isSigningIn, reopen, cancel } = useDesktopSignIn();
  const hosted = providerId === "athas";
  const authentication = code === "401";
  const tooLarge = serverCode === "request_too_large" || code === "413";
  const payment = !tooLarge && (code === "402" || HOSTED_BILLING_CODES.has(serverCode ?? ""));
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
    if (tooLarge) {
      openNewAgentChat();
      return;
    }
    if (hosted && payment) return openUrl(resolveBillingUrl(billingUrl));
    if (hosted && authentication) return signIn();
    if (configure && !hosted) {
      setKeyManagerOpen(true);
      return;
    }
    if (hosted && code === "403") return openSettings();
    if (onRetry) return onRetry();
    openSettings();
  };
  const label = tooLarge
    ? "Start new chat"
    : hosted && payment
      ? serverCode === "allowance_exhausted" || serverCode === "insufficient_balance"
        ? "Add credit"
        : "Manage billing"
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
    <div className="flex flex-wrap items-center gap-1.5">
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
