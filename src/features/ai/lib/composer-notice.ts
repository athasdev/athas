import { formatResetDate, formatUsdCents } from "@/features/ai/lib/hosted-usage";
import type {
  ComposerNotice,
  ComposerNoticeInput,
} from "@/features/ai/types/composer-notice.types";
import type { SessionCheckState } from "@/features/window/stores/auth.store";

const SESSION_CHECK_TITLES: Record<SessionCheckState["reason"], string> = {
  local_server_down: "Local Athas server is not running",
  unreachable: "Can't reach Athas",
  timeout: "Athas is not responding",
  server_error: "Athas is having trouble",
};

function authNotice(input: ComposerNoticeInput): ComposerNotice | null {
  const { auth, signIn } = input;
  if (signIn.active) {
    return {
      id: "auth:signing-in",
      category: "auth",
      tone: "info",
      icon: "sign-in",
      title: "Finish signing in from your browser",
      description: "Athas opened a sign-in page. This chat unlocks once you're done.",
      primary: { id: "reopen-sign-in", label: "Open page again" },
      secondary: { id: "cancel-sign-in", label: "Cancel" },
      dismissible: false,
    };
  }
  if (auth.sessionCheck) {
    return {
      id: `auth:session-check:${auth.sessionCheck.reason}`,
      category: "auth",
      tone: "warning",
      icon: "cloud-warning",
      title: SESSION_CHECK_TITLES[auth.sessionCheck.reason],
      description: `${auth.sessionCheck.message} Your session is kept; retrying automatically.`,
      primary: { id: "retry-session", label: auth.isLoading ? "Checking…" : "Retry now" },
      dismissible: false,
      busy: auth.isLoading,
    };
  }
  // The saved session is still being read; say nothing rather than flash "Sign in".
  if (auth.isLoading) return null;
  if (signIn.error) {
    return {
      id: "auth:sign-in-failed",
      category: "auth",
      tone: "error",
      icon: "sign-in",
      title: "Sign-in did not finish",
      description: signIn.error,
      primary: { id: "sign-in", label: "Try again" },
      dismissible: false,
    };
  }
  if (!auth.isAuthenticated) {
    return {
      id: "auth:signed-out",
      category: "auth",
      tone: "info",
      icon: "sign-in",
      title: "Sign in to use Athas models",
      description: "Or switch to a model from a provider you have connected.",
      primary: { id: "sign-in", label: "Sign in" },
      secondary: { id: "configure-models", label: "Models" },
      dismissible: false,
    };
  }
  if (!auth.hasSubscription) {
    return {
      id: "auth:plan-unavailable",
      category: "auth",
      tone: "warning",
      icon: "warning",
      title: "Could not load your Athas plan",
      description: auth.error ?? "Athas did not return your plan.",
      primary: { id: "retry-account", label: input.actionPending ? "Retrying…" : "Retry" },
      dismissible: false,
      busy: input.actionPending,
    };
  }
  return null;
}

function resetSuffix(periodEnd: Date | null) {
  return periodEnd ? ` Included credit resets ${formatResetDate(periodEnd)}.` : "";
}

function billingNotice(input: ComposerNoticeInput): ComposerNotice | null {
  const { usage } = input;
  if (!usage || usage.level !== "exhausted") return null;
  const hasBalance = usage.walletBalanceCents !== null;
  return {
    id: "billing:exhausted",
    category: "billing",
    tone: "error",
    icon: "credit",
    title: "Out of Athas credit",
    description: hasBalance
      ? `Add credit to keep using Athas models, or switch models.${resetSuffix(usage.periodEnd)}`
      : usage.periodEnd
        ? `Switch models until your included credit resets ${formatResetDate(usage.periodEnd)}.`
        : "Switch models until your included credit resets.",
    primary: { id: "open-billing", label: hasBalance ? "Add credit" : "Manage billing" },
    secondary: { id: "configure-models", label: "Models" },
    dismissible: false,
  };
}

function connectionNotice(input: ComposerNoticeInput): ComposerNotice | null {
  if (!input.online) {
    return {
      id: "connection:offline",
      category: "connection",
      tone: "warning",
      icon: "offline",
      title: "You're offline",
      description: "Messages you send wait in the queue until the connection is back.",
      dismissible: false,
    };
  }
  if (input.lastTurnOffline) {
    return {
      id: "connection:back-online",
      category: "connection",
      tone: "info",
      icon: "info",
      title: "Back online",
      description: "The last prompt did not go through.",
      primary: { id: "retry-turn", label: "Send again" },
      dismissible: true,
    };
  }
  return null;
}

function usageNotice(input: ComposerNoticeInput): ComposerNotice | null {
  const { usage } = input;
  if (!usage) return null;
  const balance =
    usage.walletBalanceCents === null ? null : formatUsdCents(usage.walletBalanceCents);
  if (usage.level === "low") {
    return {
      id: "usage:low",
      category: "usage",
      tone: "warning",
      icon: "credit",
      title: `${usage.usedPercent}% of included credit used`,
      description: `${formatUsdCents(usage.remainingCents)} of ${formatUsdCents(usage.allowanceCents)} left.${
        balance ? ` Then usage continues from your ${balance} balance.` : ""
      }${resetSuffix(usage.periodEnd)}`,
      primary: { id: "open-billing", label: "Manage billing" },
      dismissible: true,
    };
  }
  if (usage.level === "included_exhausted") {
    return {
      id: "usage:balance",
      category: "usage",
      tone: "info",
      icon: "credit",
      title: "Now using your balance",
      description: `Included credit is used up. ${balance ?? "$0.00"} left at list price +10%.${resetSuffix(usage.periodEnd)}`,
      primary: { id: "open-billing", label: "Add credit" },
      dismissible: true,
    };
  }
  return null;
}

/**
 * The one notice the composer shows, chosen by priority: account access first, then billing
 * that stops the chat, then the connection, then usage warnings. A dismissed notice gives
 * way to the next one.
 */
export function resolveComposerNotice(input: ComposerNoticeInput): ComposerNotice | null {
  const hostedAccount = input.hosted && input.auth.isAuthenticated;
  const candidates: Array<() => ComposerNotice | null> = [
    () => (input.hosted ? authNotice(input) : null),
    () =>
      !input.hosted && input.providerBlocked
        ? {
            id: "provider:missing-key",
            category: "provider",
            tone: "info",
            icon: "key",
            title: `Add an API key for ${input.providerName}`,
            description: "The key stays on this machine. Or switch to another model.",
            primary: { id: "add-api-key", label: "Add API key" },
            secondary: { id: "configure-models", label: "Models" },
            dismissible: false,
          }
        : null,
    () => (hostedAccount ? billingNotice(input) : null),
    () => connectionNotice(input),
    () => (hostedAccount ? usageNotice(input) : null),
  ];
  for (const candidate of candidates) {
    const notice = candidate();
    if (notice && !input.dismissed.has(notice.id)) return notice;
  }
  return null;
}
