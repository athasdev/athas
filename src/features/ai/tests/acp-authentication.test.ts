import { describe, expect, it } from "vite-plus/test";
import { isAcpAuthenticationError } from "@/features/ai/lib/acp-authentication";

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
});
