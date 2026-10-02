import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getOllamaToolSupport, isOllamaNoToolsError } from "../lib/ollama-tool-support";
import { fetchOllamaModelCapabilities } from "../services/providers/ollama-provider";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: mocks.fetch }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Ollama tool support", () => {
  it("reads tool support from the capabilities Ollama reports", () => {
    expect(getOllamaToolSupport(["completion", "tools"])).toBe("supported");
    expect(getOllamaToolSupport(["completion", "vision"])).toBe("unsupported");
    expect(getOllamaToolSupport(undefined)).toBe("unknown");
  });

  it("asks the configured Ollama host for the model's capabilities", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ capabilities: ["completion", "tools"] })),
    );
    await expect(
      fetchOllamaModelCapabilities("192.168.1.20:8080/", "qwen3-coder"),
    ).resolves.toEqual(["completion", "tools"]);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://192.168.1.20:8080/api/show",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "qwen3-coder" }) }),
    );
  });

  it("treats an older or unreachable server as unknown", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ details: {} })));
    await expect(fetchOllamaModelCapabilities("http://localhost:11434", "llama3")).resolves.toBe(
      null,
    );
    mocks.fetch.mockRejectedValueOnce(new Error("connection refused"));
    await expect(fetchOllamaModelCapabilities("http://localhost:11434", "llama3")).resolves.toBe(
      null,
    );
  });

  it("recognizes Ollama's rejection of tools", () => {
    expect(isOllamaNoToolsError(new Error("gemma3:latest does not support tools"))).toBe(true);
    expect(
      isOllamaNoToolsError({
        message: "Bad Request",
        responseBody: '{"error":{"message":"model does not support tools"}}',
      }),
    ).toBe(true);
    expect(isOllamaNoToolsError(new Error("connection refused"))).toBe(false);
  });
});
