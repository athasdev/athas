import { describe, expect, it } from "vite-plus/test";
import { extractProviderSetupCommand, parseErrorBlockData } from "../lib/error-block-data";

describe("error block parsing", () => {
  it("keeps multiline details intact", () => {
    const parsed = parseErrorBlockData(`title: Provider Setup Required
code: PROVIDER_SETUP_REQUIRED
message: Provider needs setup
details: First line
second line
third line`);

    expect(parsed).toEqual({
      title: "Provider Setup Required",
      code: "PROVIDER_SETUP_REQUIRED",
      message: "Provider needs setup",
      details: "First line\nsecond line\nthird line",
    });
  });

  it("extracts setup commands without including prose", () => {
    expect(
      extractProviderSetupCommand(
        "[error] No API key found. Set Z_AI_API_KEY, or run `glm-acp-agent --setup` to store one.",
      ),
    ).toBe("glm-acp-agent --setup");
  });
});
