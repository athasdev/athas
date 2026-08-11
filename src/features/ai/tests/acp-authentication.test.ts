import { describe, expect, it } from "vite-plus/test";
import {
  getAcpAuthenticationCommand,
  getAcpStartupErrorDetails,
  isAcpAuthenticationError,
  isAcpConfigurationError,
} from "@/features/ai/lib/acp-authentication";

describe("ACP authentication errors", () => {
  it("recognizes protocol and agent-authored authentication failures", () => {
    expect(isAcpAuthenticationError("Authentication required before sending prompt")).toBe(true);
    expect(
      isAcpAuthenticationError("gemini-cli requires authentication before it can answer prompts."),
    ).toBe(true);
    expect(isAcpAuthenticationError("The agent is not authenticated")).toBe(true);
  });

  it("does not classify unrelated agent failures as authentication errors", () => {
    expect(isAcpAuthenticationError("The agent process exited unexpectedly")).toBe(false);
  });

  it("separates authenticated account configuration failures", () => {
    expect(
      isAcpConfigurationError(
        "Authentication failed: This account requires setting the GOOGLE_CLOUD_PROJECT env var.",
      ),
    ).toBe(true);
    expect(isAcpConfigurationError("Authentication required")).toBe(false);
  });

  it("uses the detected agent binary for the setup terminal", () => {
    expect(
      getAcpAuthenticationCommand("gemini-cli", [
        { id: "gemini-cli", binaryName: "/managed/bin/gemini" },
      ]),
    ).toBe("/managed/bin/gemini");
    expect(getAcpAuthenticationCommand("qwen-code", [])).toBe("qwen");
  });

  it("opens Claude Agent's Anthropic Console login through its managed wrapper", () => {
    expect(
      getAcpAuthenticationCommand("claude-acp", [
        {
          id: "claude-acp",
          binaryName: "claude-agent-acp",
          binaryPath: "/managed/bin/claude-agent-acp",
        },
      ]),
    ).toBe("/managed/bin/claude-agent-acp --cli auth login --console");
  });

  it("extracts the actionable ACP stderr from startup errors", () => {
    expect(
      getAcpStartupErrorDetails(
        "ACP startup failed. Agent stderr: Authentication failed: GOOGLE_CLOUD_PROJECT is required",
      ),
    ).toBe("Authentication failed: GOOGLE_CLOUD_PROJECT is required");
  });
});
