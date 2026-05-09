import { describe, expect, it } from "vite-plus/test";
import { resolveProviderIconKind } from "../components/icons/provider-icons";

describe("resolveProviderIconKind", () => {
  it("recognizes legacy and registry ACP provider ids", () => {
    expect(resolveProviderIconKind("codex-cli")).toBe("openai");
    expect(resolveProviderIconKind("codex-acp")).toBe("openai");
    expect(resolveProviderIconKind("claude-code")).toBe("anthropic");
    expect(resolveProviderIconKind("claude-acp")).toBe("anthropic");
    expect(resolveProviderIconKind("gemini-cli")).toBe("gemini");
    expect(resolveProviderIconKind("gemini")).toBe("gemini");
    expect(resolveProviderIconKind("kimi-cli")).toBe("moonshot");
    expect(resolveProviderIconKind("kimi")).toBe("moonshot");
    expect(resolveProviderIconKind("qwen-code")).toBe("qwen");
    expect(resolveProviderIconKind("mistral-vibe")).toBe("mistral");
  });

  it("falls back to the custom terminal glyph for unknown agent ids", () => {
    expect(resolveProviderIconKind("local-agent")).toBe("custom");
  });
});
