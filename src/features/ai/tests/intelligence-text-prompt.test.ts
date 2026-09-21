import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MockLanguageModelV4 } from "ai/test";
import { requestInlineEdit } from "../intelligence/services/intelligence-text-service";

const mocks = vi.hoisted(() => ({ model: null as unknown as MockLanguageModelV4 }));
vi.mock("../intelligence/services/intelligence-sdk-model", () => ({
  getIntelligenceSdkModel: async () => mocks.model,
}));
vi.mock("../intelligence/services/intelligence-connection", () => ({
  getIntelligenceConnection: async () => ({
    providerId: "openai",
    modelId: "test-model",
    userId: null,
    scope: "personal",
  }),
  assertIntelligenceConnectionAllowed: () => {},
}));
vi.mock("@/features/window/stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ user: null }) },
}));
vi.mock("../intelligence/stores/intelligence-settings.store", () => ({
  useIntelligenceSettingsStore: { getState: () => ({ scope: "personal" }) },
}));

beforeEach(() => {
  mocks.model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "Generated result" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  });
});

describe("Intelligence text SDK instructions", () => {
  it.each([
    ["inline-edit", "Rewrite only the selected code"],
    ["autocomplete", "Complete the code at the cursor"],
    ["commit-message", "Write a Git commit message"],
    ["chat-title", "Write a short concrete title"],
  ] as const)(
    "passes %s instructions through the real SDK validation",
    async (feature, instruction) => {
      const result = await requestInlineEdit(
        {
          feature,
          model: "test-model",
          beforeSelection: "before",
          selectedText: "selection",
          afterSelection: "after",
          instruction: "User request",
          filePath: "index.ts",
        },
        { useHosted: false },
      );
      expect(result.editedText).toBe("Generated result");
      const prompt = mocks.model.doGenerateCalls[0].prompt;
      expect(prompt).toHaveLength(2);
      expect(prompt[0]).toMatchObject({
        role: "system",
        content: expect.stringContaining(instruction),
      });
      expect(prompt[1]).toMatchObject({
        role: "user",
        content: [{ type: "text", text: expect.stringContaining('"instruction":"User request"') }],
      });
    },
  );
});
