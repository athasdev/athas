import { describe, expect, it } from "vite-plus/test";
import { describeAgentTurnFailure } from "../lib/agent-turn-error";
import { formatApiError } from "../lib/api-error";
import { toIntelligenceAgentError } from "../intelligence/lib/intelligence-agent-error";

const describeFailure = (error: string, overrides: { isAcp?: boolean; offline?: boolean } = {}) =>
  describeAgentTurnFailure({
    error,
    providerId: "athas",
    isAcp: overrides.isAcp ?? false,
    offline: overrides.offline ?? false,
  });

describe("agent turn failures", () => {
  it("explains an exhausted allowance and keeps it structured", () => {
    const failure = describeFailure(
      'athas API error: 402|||{"error":{"code":"allowance_exhausted","message":"Used up"}}',
    );
    expect(failure.title).toBe("Included credit used up");
    expect(failure.blockCode).toBe("402");
    expect(failure.message).toContain("Add pay-as-you-go credit");
    expect(failure.error).toEqual({
      code: "allowance_exhausted",
      status: 402,
      title: "Included credit used up",
      message: failure.message,
      details: failure.details,
      providerId: "athas",
      retryable: false,
    });
  });

  it("explains each hosted billing refusal and keeps the server's billing page", () => {
    const body = (code: string, extra: Record<string, unknown> = {}) =>
      `athas API error: 402|||${JSON.stringify({ error: "Server text", code, billingUrl: "/dashboard/settings/billing", ...extra })}`;
    const short = describeFailure(body("allowance_exhausted", { walletBalanceCents: 12.5 }));
    expect(short.message).toContain("balance ($0.13) doesn't cover this request");
    expect(short.error.billingUrl).toBe("/dashboard/settings/billing");
    expect(describeFailure(body("insufficient_balance")).title).toBe("Not enough credit");
    expect(describeFailure(body("spending_limit_reached"))).toMatchObject({
      title: "Spending limit reached",
      error: { code: "spending_limit_reached", status: 402, retryable: false },
    });
  });

  it("asks for a new chat when a request is too large, whatever its status", () => {
    const tooLarge = describeFailure(
      'athas API error: 413|||{"error":"Too large","code":"request_too_large"}',
    );
    expect(tooLarge).toMatchObject({ title: "Conversation too large", blockCode: "413" });
    expect(tooLarge.message).toContain("Start a new chat");
    expect(tooLarge.error.retryable).toBe(false);
    expect(
      describeFailure('athas API error: 402|||{"error":"Too large","code":"request_too_large"}')
        .title,
    ).toBe("Conversation too large");
  });

  it("prefers the server's explanation for other failures", () => {
    const failure = describeFailure(
      'athas API error: 429|||{"code":"http_429","error":"Slow down"}',
    );
    expect(failure.message).toBe("Slow down");
    expect(failure.error).toMatchObject({ status: 429, code: "http_429", retryable: true });
  });

  it("reports an offline failure as retryable without a toast", () => {
    const failure = describeFailure("Failed to connect to athas API: error sending request", {
      offline: true,
    });
    expect(failure).toMatchObject({
      title: "Offline",
      blockCode: "OFFLINE",
      suppressToast: true,
      error: { code: "offline", retryable: true },
    });
  });

  it("recognizes a network failure while the system still reports a connection", () => {
    const failure = describeFailure("Failed to connect to athas API: error sending request");
    expect(failure.title).toBe("Connection Failed");
    expect(failure.error).toMatchObject({ code: "network", retryable: true });
  });

  it("keeps reconnectable ACP failures out of toasts", () => {
    const failure = describeAgentTurnFailure({
      error: "Agent process exited",
      canReconnect: true,
      providerId: "claude-code",
      isAcp: true,
      offline: false,
    });
    expect(failure).toMatchObject({ blockCode: "RECONNECT", suppressToast: true });
  });

  it("keeps the status a hosted stream error chunk carries in param", () => {
    // What the SDK hands over for an Athas SSE `error` event: only the OpenAI-style fields.
    const chunk = (code: string, param: Record<string, unknown> = {}) =>
      describeFailure(
        formatApiError(
          "athas",
          toIntelligenceAgentError({ message: "Upstream failed", type: code, code, param }),
        ),
      ).error;

    expect(chunk("provider_rejected", { statusCode: 400 })).toMatchObject({
      code: "provider_rejected",
      status: 400,
    });
    expect(chunk("provider_unavailable", { statusCode: 503 })).toMatchObject({
      status: 503,
      retryable: true,
    });
    expect(chunk("connection_interrupted")).toMatchObject({
      code: "connection_interrupted",
      retryable: true,
    });
  });
});
