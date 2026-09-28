import { describe, expect, it } from "vite-plus/test";
import { resolveComposerNotice } from "@/features/ai/lib/composer-notice";
import { getHostedUsageState } from "@/features/ai/lib/hosted-usage";
import type { ComposerNoticeInput } from "@/features/ai/types/composer-notice.types";

function input(overrides: Partial<ComposerNoticeInput> = {}): ComposerNoticeInput {
  return {
    hosted: true,
    providerBlocked: false,
    providerName: "Athas",
    auth: {
      isAuthenticated: true,
      isLoading: false,
      hasSubscription: true,
      error: null,
      sessionCheck: null,
    },
    signIn: { active: false, error: null },
    actionPending: false,
    usage: null,
    online: true,
    lastTurnOffline: false,
    dismissed: new Set(),
    ...overrides,
  };
}

const signedOut = {
  isAuthenticated: false,
  isLoading: false,
  hasSubscription: false,
  error: null,
  sessionCheck: null,
};

function usage(usedCents: number, walletBalanceCents: number | null = null) {
  return getHostedUsageState({
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-10-01T00:00:00.000Z",
    allowanceCents: 1_000,
    usedCents,
    pendingCents: 0,
    remainingCents: 1_000 - usedCents,
    requestsCount: 1,
    walletBalanceCents,
  });
}

describe("composer notice", () => {
  it("says nothing when the chat can send and nothing needs attention", () => {
    expect(resolveComposerNotice(input())).toBeNull();
  });

  it("offers sign-in for a signed-out hosted chat, with one primary action", () => {
    const notice = resolveComposerNotice(input({ providerBlocked: true, auth: signedOut }));
    expect(notice).toMatchObject({
      category: "auth",
      title: "Sign in to use Athas models",
      primary: { id: "sign-in" },
      dismissible: false,
    });
  });

  it("does not flash sign-in while the saved session is still being read", () => {
    const notice = resolveComposerNotice(
      input({ providerBlocked: true, auth: { ...signedOut, isLoading: true } }),
    );
    expect(notice).toBeNull();
  });

  it("presents an unreachable server as a connection problem with retry, not a sign-out", () => {
    const notice = resolveComposerNotice(
      input({
        providerBlocked: true,
        auth: {
          ...signedOut,
          sessionCheck: {
            reason: "local_server_down",
            message: "Nothing is answering at localhost:3000.",
            host: "localhost:3000",
            attempt: 1,
            nextRetryAt: 2_000,
          },
        },
      }),
    );
    expect(notice).toMatchObject({
      tone: "warning",
      title: "Local Athas server is not running",
      primary: { id: "retry-session", label: "Retry now" },
    });
    expect(notice?.description).toContain("localhost:3000");
    expect(notice?.primary?.id).not.toBe("sign-in");
  });

  it("puts account problems ahead of usage and connection notices", () => {
    const notice = resolveComposerNotice(
      input({ providerBlocked: true, auth: signedOut, online: false, usage: usage(900) }),
    );
    expect(notice?.category).toBe("auth");
  });

  it("stops the chat when credit runs out and cannot be dismissed", () => {
    const notice = resolveComposerNotice(input({ usage: usage(1_000, 500) }));
    expect(notice).toMatchObject({
      category: "usage",
      id: "usage:balance",
    });
    const exhausted = resolveComposerNotice(input({ usage: usage(1_000) }));
    expect(exhausted).toMatchObject({
      category: "billing",
      tone: "error",
      dismissible: false,
      primary: { id: "open-billing", label: "Manage billing" },
    });
  });

  it("shows the next notice once a dismissible one is dismissed", () => {
    const low = input({ usage: usage(850), lastTurnOffline: true });
    expect(resolveComposerNotice(low)?.id).toBe("connection:back-online");
    const afterDismiss = resolveComposerNotice({
      ...low,
      dismissed: new Set(["connection:back-online"]),
    });
    expect(afterDismiss).toMatchObject({ id: "usage:low", dismissible: true });
  });

  it("asks for an API key only for another provider on the built-in agent", () => {
    const notice = resolveComposerNotice(
      input({ hosted: false, providerBlocked: true, providerName: "Anthropic" }),
    );
    expect(notice).toMatchObject({
      title: "Add an API key for Anthropic",
      primary: { id: "add-api-key" },
    });
  });

  it("keeps usage and billing to hosted chats", () => {
    expect(resolveComposerNotice(input({ hosted: false, usage: usage(1_000) }))).toBeNull();
  });
});
