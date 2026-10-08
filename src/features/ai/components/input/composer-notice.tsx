import { openExternalUrl } from "@/utils/external-url";
import { useState } from "react";
import { getServiceUrls } from "@/config/services";
import { ProviderApiKeyCommand } from "@/features/ai/components/provider-api-key-command";
import { useOnlineStatus } from "@/features/ai/hooks/use-online-status";
import { resolveComposerNotice } from "@/features/ai/lib/composer-notice";
import { getHostedUsageState } from "@/features/ai/lib/hosted-usage";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type {
  ComposerNoticeAction,
  ComposerNoticeActionId,
  ComposerNoticeIcon,
} from "@/features/ai/types/composer-notice.types";
import { getProviderById } from "@/features/ai/types/providers.types";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useSubscriptionRefresh } from "@/features/window/hooks/use-subscription-refresh";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";
import {
  CloudSlashIcon,
  CloudWarningIcon,
  CreditCardIcon,
  InfoIcon,
  KeyIcon,
  SignInIcon,
  WarningIcon,
  XIcon,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";

const noticeIcons: Record<ComposerNoticeIcon, typeof InfoIcon> = {
  "sign-in": SignInIcon,
  "cloud-warning": CloudWarningIcon,
  offline: CloudSlashIcon,
  key: KeyIcon,
  credit: CreditCardIcon,
  warning: WarningIcon,
  info: InfoIcon,
};

interface ComposerNoticeProps {
  /** Whether the built-in agent drives this chat; other agents handle their own accounts. */
  builtInAgent: boolean;
  providerId: string;
  /** The built-in agent's provider has no key or account, so nothing can be sent. */
  providerBlocked: boolean;
  lastTurnFailedOffline?: boolean;
  onRetryLastTurn?: () => void;
}

/**
 * The composer's one notice slot. It shows the most important thing standing between the user
 * and a working chat (account, billing, connection, then usage) with at most two actions.
 */
export function ComposerNotice({
  builtInAgent,
  providerId,
  providerBlocked,
  lastTurnFailedOffline = false,
  onRetryLastTurn,
}: ComposerNoticeProps) {
  const hosted = builtInAgent && providerId === "athas";
  useSubscriptionRefresh();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const hasSubscription = useAuthStore((state) => state.subscription !== null);
  const authError = useAuthStore((state) => state.error);
  const sessionCheck = useAuthStore((state) => state.sessionCheck);
  const credits = useAuthStore((state) => state.subscription?.intelligence?.credits ?? null);
  const checkApiKey = useAIChatStore((state) => state.actions.checkApiKey);
  const signIn = useDesktopSignIn();
  const online = useOnlineStatus();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [actionPending, setActionPending] = useState(false);
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);

  const notice = resolveComposerNotice({
    hosted,
    providerBlocked: builtInAgent && providerBlocked,
    providerName: getProviderById(providerId)?.name ?? providerId,
    auth: { isAuthenticated, isLoading, hasSubscription, error: authError, sessionCheck },
    signIn: { active: signIn.isSigningIn, error: signIn.error },
    actionPending,
    usage: hosted ? getHostedUsageState(credits) : null,
    online,
    lastTurnOffline: lastTurnFailedOffline,
    dismissed,
  });

  const runAction = async (id: ComposerNoticeActionId) => {
    switch (id) {
      case "sign-in":
        try {
          await signIn.signIn();
          await checkApiKey(providerId);
        } catch {
          // The sign-in store keeps the reason, and the notice shows it.
        }
        return;
      case "reopen-sign-in":
        await signIn.reopen();
        return;
      case "cancel-sign-in":
        signIn.cancel();
        return;
      case "retry-session":
        await useAuthStore.getState().actions.retrySessionCheck();
        await checkApiKey(providerId);
        return;
      case "retry-account":
        setActionPending(true);
        try {
          if (await useAuthStore.getState().actions.refreshSubscription())
            await checkApiKey(providerId);
        } finally {
          setActionPending(false);
        }
        return;
      case "add-api-key":
        setKeyManagerOpen(true);
        return;
      case "configure-models":
        useUIState.getState().openSettings("ai");
        return;
      case "open-billing":
        await openExternalUrl(getServiceUrls().dashboardBillingUrl).catch((error: unknown) =>
          console.error("Failed to open billing:", error),
        );
        return;
      case "retry-turn":
        onRetryLastTurn?.();
        return;
    }
  };

  const renderAction = (action: ComposerNoticeAction, primary: boolean) => {
    const busy = primary && notice?.busy;
    return (
      <Button
        type="button"
        size="xs"
        variant={primary ? "default" : "ghost"}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void runAction(action.id)}
      >
        {busy ? <Spinner compact label={action.label} /> : null}
        {action.label}
      </Button>
    );
  };

  const Icon = notice ? noticeIcons[notice.icon] : null;

  return (
    <>
      {notice && Icon ? (
        <div className="px-1.5 pt-1.5">
          <Alert
            key={notice.id}
            tone={notice.tone}
            variant="inset"
            role={notice.tone === "error" ? "alert" : "status"}
            aria-live="polite"
            data-notice-id={notice.id}
          >
            <Icon />
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription>{notice.description}</AlertDescription>
            {notice.primary || notice.secondary || notice.dismissible ? (
              <AlertActions>
                {notice.secondary ? renderAction(notice.secondary, false) : null}
                {notice.primary ? renderAction(notice.primary, true) : null}
                {notice.dismissible ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    iconOnly
                    tooltip="Dismiss"
                    onClick={() => setDismissed((current) => new Set(current).add(notice.id))}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </AlertActions>
            ) : null}
          </Alert>
        </div>
      ) : null}
      {builtInAgent && !hosted ? (
        <ProviderApiKeyCommand
          isOpen={keyManagerOpen}
          onClose={() => setKeyManagerOpen(false)}
          initialProviderId={providerId}
        />
      ) : null}
    </>
  );
}
