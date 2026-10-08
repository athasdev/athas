import { describe, expect, it } from "vite-plus/test";
import { createAiFailurePayload } from "../services/ai-signals";

describe("AI telemetry signals", () => {
  it("keeps identifiers and codes but drops anything that looks like content", () => {
    expect(
      createAiFailurePayload({
        kind: "builtin",
        providerId: "athas",
        modelId: "openai/gpt-5-mini",
        code: "allowance_exhausted",
        status: 402,
        phase: "provider",
        stepCount: 140,
        retried: true,
      }),
    ).toEqual({
      kind: "builtin",
      provider_id: "athas",
      model_id: "openai/gpt-5-mini",
      code: "allowance_exhausted",
      status: 402,
      phase: "provider",
      step_count: 99,
      retried: true,
      cancelled: false,
    });

    const leaky = createAiFailurePayload({
      kind: "acp",
      providerId: "claude code",
      modelId: "please fix /Users/me/secret.ts",
      code: "Error: could not read file",
      phase: "stream",
    });
    expect(leaky).toMatchObject({ provider_id: null, model_id: null, code: null, status: null });
  });

  it("never reports a custom endpoint's model name", () => {
    expect(
      createAiFailurePayload({
        kind: "builtin",
        providerId: "custom",
        modelId: "my-private-model",
        phase: "provider",
      }).model_id,
    ).toBeNull();
  });
});
