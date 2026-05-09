import { describe, expect, it } from "vite-plus/test";
import { classifyAcpProviderError } from "../lib/acp-provider-errors";

describe("classifyAcpProviderError", () => {
  it("classifies provider setup errors surfaced after launch", () => {
    const result = classifyAcpProviderError(
      "[error] No API key found. Set the Z_AI_API_KEY environment variable, or run `glm-acp-agent --setup` to store one.",
    );

    expect(result).toMatchObject({
      code: "PROVIDER_SETUP_REQUIRED",
      title: "Provider Setup Required",
      activityLabel: "Provider setup required",
    });
  });

  it("classifies ACP protocol authentication errors separately", () => {
    const result = classifyAcpProviderError("Authentication required", "Method not implemented");

    expect(result).toMatchObject({
      code: "AUTH_REQUIRED",
      title: "Authentication Required",
      activityLabel: "Agent authentication required",
    });
    expect(result?.detail).toContain("does not implement");
  });

  it("ignores ordinary provider runtime errors", () => {
    expect(classifyAcpProviderError("Agent returned EMPTY_RESPONSE")).toBeNull();
  });
});
