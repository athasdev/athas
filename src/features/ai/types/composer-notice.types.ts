import type { HostedUsageState } from "@/features/ai/services/hosted-usage";
import type { SessionCheckState } from "@/features/auth/stores/auth.store";

/**
 * What a composer notice is about, in the order the slot prefers them: only the first
 * category that has something to say is shown.
 */
export type ComposerNoticeCategory = "auth" | "provider" | "billing" | "connection" | "usage";

export type ComposerNoticeTone = "info" | "warning" | "error";

export type ComposerNoticeIcon =
  | "sign-in"
  | "cloud-warning"
  | "offline"
  | "key"
  | "credit"
  | "warning"
  | "info";

export type ComposerNoticeActionId =
  | "sign-in"
  | "reopen-sign-in"
  | "cancel-sign-in"
  | "retry-session"
  | "retry-account"
  | "add-api-key"
  | "configure-models"
  | "open-billing"
  | "retry-turn";

export interface ComposerNoticeAction {
  id: ComposerNoticeActionId;
  label: string;
}

export interface ComposerNotice {
  /** Stable for one situation, so a dismissal hides that situation and nothing newer. */
  id: string;
  category: ComposerNoticeCategory;
  tone: ComposerNoticeTone;
  icon: ComposerNoticeIcon;
  title: string;
  /** One line. */
  description: string;
  primary?: ComposerNoticeAction;
  secondary?: ComposerNoticeAction;
  dismissible: boolean;
  /** The primary action is already running. */
  busy?: boolean;
}

export interface ComposerNoticeInput {
  /** The built-in agent talks to Athas hosted models. */
  hosted: boolean;
  /** The built-in agent's provider has no key or account, so nothing can be sent. */
  providerBlocked: boolean;
  providerName: string;
  auth: {
    isAuthenticated: boolean;
    isLoading: boolean;
    hasSubscription: boolean;
    error: string | null;
    sessionCheck: SessionCheckState | null;
  };
  signIn: { active: boolean; error: string | null };
  /** A plan or connection request started from the notice is running. */
  actionPending: boolean;
  usage: HostedUsageState | null;
  online: boolean;
  /** The last turn failed because the connection dropped, and can be sent again. */
  lastTurnOffline: boolean;
  dismissed: ReadonlySet<string>;
}
