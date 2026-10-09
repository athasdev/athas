import { describe, expect, it } from "vite-plus/test";
import { describeAgentTurnFailure, formatErrorBlock } from "../lib/agent-turn-error";

function failureFor(
  error: string,
  options: { providerId?: string; isAcp?: boolean; canReconnect?: boolean } = {},
) {
  return describeAgentTurnFailure({
    error,
    providerId: options.providerId ?? "openai",
    isAcp: options.isAcp ?? false,
    canReconnect: options.canReconnect,
    offline: false,
  });
}

describe("agent turn failures by HTTP status", () => {
  it.each([
    [
      429,
      "Rate Limit Exceeded",
      "The API is temporarily rate-limited. Please wait a moment and try again.",
    ],
    [403, "Access Denied", "You don't have permission to access this resource."],
    [408, "Request Timed Out", "The provider took too long to answer. Try again."],
    [500, "Server Error", "The API server encountered an error. Please try again later."],
  ])("explains a %i response", (status, title, message) => {
    const failure = failureFor(`openai API error: ${status}|||not json`);
    expect(failure).toMatchObject({ title, message, blockCode: String(status) });
    expect(failure.error).toMatchObject({ status, providerId: "openai" });
    expect(failure.details).toBe("not json");
    expect(failure.suppressToast).toBe(false);
  });

  it("tells BYOK users to check their key and Athas users to sign in", () => {
    expect(failureFor("openai API error: 401|||{}").message).toBe(
      "The provider rejected your API key. Check its configuration to continue.",
    );
    expect(
      failureFor('athas API error: 401|||{"error":{"message":"jwt expired"}}', {
        providerId: "athas",
      }),
    ).toMatchObject({
      title: "Authentication Error",
      message: "Your Athas session has expired. Sign in to continue.",
    });
  });

  it("keeps a generic payment message for providers other than Athas", () => {
    expect(failureFor('openai API error: 402|||{"error":"quota"}')).toMatchObject({
      title: "Payment required",
      message: "quota",
    });
    expect(failureFor("openai API error: 402|||").message).toBe(
      "Check your balance and spending limits to continue, or choose another model.",
    );
  });

  it("mentions the remaining balance when included credit runs out", () => {
    const failure = failureFor(
      'athas API error: 402|||{"error":{"code":"allowance_exhausted","walletBalanceCents":250}}',
      { providerId: "athas" },
    );
    expect(failure.title).toBe("Included credit used up");
    expect(failure.message).toContain("pay-as-you-go balance ($2.50)");
  });

  it("uses the server's message for bad requests and timeouts by code", () => {
    expect(
      failureFor('openai API error: 400|||{"error":{"message":"Unknown parameter: foo"}}'),
    ).toMatchObject({ title: "Bad Request", message: "Unknown parameter: foo" });
    expect(failureFor("Request failed: timeout").title).toBe("Request Timed Out");
  });

  it("recognizes connection failures without a status", () => {
    expect(failureFor("Failed to connect to openai API: error sending request")).toMatchObject({
      title: "Connection Failed",
      blockCode: "NETWORK",
      message: "Could not reach the provider. Check your connection and try again.",
      error: { code: "network" },
    });
  });
});

describe("ACP agent failures", () => {
  it("asks for the agent's account configuration", () => {
    const failure = failureFor("Gemini requires setting the GOOGLE_CLOUD_PROJECT variable", {
      providerId: "gemini",
      isAcp: true,
    });
    expect(failure).toMatchObject({
      title: "Agent Configuration Required",
      blockCode: "CONFIG_REQUIRED",
      error: { code: "config_required", actions: ["restart_agent", "open_agent_terminal"] },
    });
  });

  it("asks for external authentication and explains adapters without the flow", () => {
    expect(
      failureFor("Authentication required|||Method not implemented", { isAcp: true }),
    ).toMatchObject({
      title: "Authentication Required",
      blockCode: "AUTH_REQUIRED",
      details:
        "This ACP adapter does not implement the protocol authenticate flow. Complete login in the underlying CLI/adapter, then try again.",
    });
    expect(failureFor("Not authenticated", { isAcp: true }).details).toBe(
      "Complete authentication in the underlying CLI/adapter, then try again.",
    );
    expect(failureFor("Not authenticated|||run login", { isAcp: true }).details).toBe("run login");
  });

  it("keeps an empty ACP response out of toasts", () => {
    expect(failureFor("The agent did not return any response", { isAcp: true }).suppressToast).toBe(
      true,
    );
    expect(failureFor("Agent exited", { isAcp: true, canReconnect: true })).toMatchObject({
      title: "Connection Lost",
      blockCode: "RECONNECT",
      suppressToast: true,
    });
  });
});

describe("error blocks", () => {
  it("writes the provider line only when there is one", () => {
    expect(
      formatErrorBlock({ title: "T", code: "C", message: "M", details: "D" }).split("\n"),
    ).toEqual([
      "[ERROR_BLOCK]",
      "title: T",
      "code: C",
      "message: M",
      "details: D",
      "[/ERROR_BLOCK]",
    ]);
    expect(
      formatErrorBlock({ title: "T", code: "C", provider: "openai", message: "M", details: "D" }),
    ).toContain("provider: openai\n");
  });
});
