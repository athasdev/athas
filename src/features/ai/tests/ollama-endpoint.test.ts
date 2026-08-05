import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_OLLAMA_BASE_URL,
  isOllamaCloudUrl,
  normalizeOllamaBaseUrl,
  resolveOllamaBaseUrl,
} from "@/features/ai/lib/ollama-endpoint";

describe("Ollama endpoints", () => {
  it.each([
    ["192.168.1.24:11434", "http://192.168.1.24:11434"],
    ["ollama.lan:11434/", "http://ollama.lan:11434"],
    ["http://10.0.0.8:11434///", "http://10.0.0.8:11434"],
    ["http://[fd00::24]:11434", "http://[fd00::24]:11434"],
    ["https://gateway.example.test/ollama/", "https://gateway.example.test/ollama"],
  ])("accepts local and LAN endpoint %s", (input, expected) => {
    expect(resolveOllamaBaseUrl(input)).toBe(expected);
  });

  it.each(["", "http://", "ftp://ollama.lan:11434", "http://ollama.lan:11434?token=x"])(
    "rejects endpoint %s",
    (input) => {
      expect(resolveOllamaBaseUrl(input)).toBeNull();
    },
  );

  it("uses localhost only when normalization receives an unusable value", () => {
    expect(normalizeOllamaBaseUrl("  ollama.lan:11434/ ")).toBe("http://ollama.lan:11434");
    expect(normalizeOllamaBaseUrl(" ")).toBe(DEFAULT_OLLAMA_BASE_URL);
  });

  it("only treats Ollama-owned hosts as cloud", () => {
    expect(isOllamaCloudUrl("https://ollama.com")).toBe(true);
    expect(isOllamaCloudUrl("https://api.ollama.com/")).toBe(true);
    expect(isOllamaCloudUrl("http://ollama.lan:11434")).toBe(false);
    expect(isOllamaCloudUrl("http://ollama.com.example.test")).toBe(false);
  });
});
