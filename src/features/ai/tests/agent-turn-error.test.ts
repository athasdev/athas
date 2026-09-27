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
    expect(failure.title).toBe("Payment required");
    expect(failure.blockCode).toBe("402");
    expect(failure.message).toContain("included Athas usage");
    expect(failure.error).toEqual({
      code: "allowance_exhausted",
      status: 402,
      title: "Payment required",
      message: failure.message,
      details: failure.details,
      providerId: "athas",
      retryable: false,
    });
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
