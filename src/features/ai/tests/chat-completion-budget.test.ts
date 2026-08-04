import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_CHAT_COMPLETION_TOKENS,
  resolveChatCompletionTokenLimit,
} from "@/features/ai/lib/chat-completion-budget";

describe("resolveChatCompletionTokenLimit", () => {
  it("allows enough output for reasoning and a visible answer", () => {
    expect(resolveChatCompletionTokenLimit(128_000)).toBe(DEFAULT_CHAT_COMPLETION_TOKENS);
  });

  it("respects a smaller model completion limit", () => {
    expect(resolveChatCompletionTokenLimit(2048)).toBe(2048);
  });

  it("uses the default when model metadata is absent or invalid", () => {
    expect(resolveChatCompletionTokenLimit(undefined)).toBe(DEFAULT_CHAT_COMPLETION_TOKENS);
    expect(resolveChatCompletionTokenLimit(Number.NaN)).toBe(DEFAULT_CHAT_COMPLETION_TOKENS);
    expect(resolveChatCompletionTokenLimit(0)).toBe(DEFAULT_CHAT_COMPLETION_TOKENS);
  });
});
