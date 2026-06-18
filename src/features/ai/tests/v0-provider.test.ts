import { describe, expect, it } from "vite-plus/test";
import { V0Provider } from "@/features/ai/services/providers/v0-provider";

const provider = new V0Provider({
  id: "v0",
  name: "v0",
  apiUrl: "https://api.v0.dev/v1/chats",
  requiresApiKey: true,
  maxTokens: 50000,
});

describe("V0Provider", () => {
  it("builds v0 Platform API chat payloads", () => {
    const payload = provider.buildPayload({
      modelId: "v0-pro",
      maxTokens: 1000,
      temperature: 0.7,
      messages: [
        { role: "system", content: "You are Athas Agent." },
        { role: "user", content: "Create a dashboard." },
        { role: "assistant", content: "I can do that." },
        { role: "user", content: "Make it compact." },
      ],
    });

    expect(payload.message).toBe(
      ["User:\nCreate a dashboard.", "Assistant:\nI can do that.", "User:\nMake it compact."].join(
        "\n\n",
      ),
    );
    expect(payload.system).toContain("You are Athas Agent.");
    expect(payload.system).toContain("Generate and edit inside the remote v0 sandbox.");
    expect(payload).toMatchObject({
      message: [
        "User:\nCreate a dashboard.",
        "Assistant:\nI can do that.",
        "User:\nMake it compact.",
      ].join("\n\n"),
      responseMode: "experimental_stream",
      chatPrivacy: "private",
      modelConfiguration: { modelId: "v0-pro" },
    });
  });

  it("targets the Platform API chat endpoint with streaming headers", () => {
    expect(provider.buildUrl()).toBe("https://api.v0.dev/v1/chats");
    expect(provider.buildHeaders("v0_test")).toMatchObject({
      Authorization: "Bearer v0_test",
      Accept: "text/event-stream, application/json",
      "Content-Type": "application/json",
    });
  });
});
