import { describe, expect, it } from "bun:test";
import { __test__, DEFAULT_OLLAMA_BASE_URL, getOllamaProbeErrorMessage } from "./ollama";

describe("ollama helpers", () => {
  it("normalizes empty and trailing-slash URLs", () => {
    expect(__test__.normalizeOllamaBaseUrl("")).toBe(DEFAULT_OLLAMA_BASE_URL);
    expect(__test__.normalizeOllamaBaseUrl(" http://localhost:11434/// ")).toBe(
      DEFAULT_OLLAMA_BASE_URL,
    );
    expect(__test__.normalizeOllamaBaseUrl("https://ollama.example.com/base/")).toBe(
      "https://ollama.example.com/base",
    );
  });

  it("parses a valid probe response", () => {
    expect(
      __test__.parseOllamaProbeResponse({
        normalizedUrl: "http://localhost:11434",
        models: [{ id: "llama3.2", name: "llama3.2", maxTokens: 8192 }],
      }),
    ).toEqual({
      normalizedUrl: "http://localhost:11434",
      models: [{ id: "llama3.2", name: "llama3.2", maxTokens: 8192 }],
    });
  });

  it("filters malformed models out of the probe response", () => {
    expect(
      __test__.parseOllamaProbeResponse({
        normalizedUrl: "http://localhost:11434",
        models: [{ id: "ok", name: "ok" }, { id: 42 }, null],
      }),
    ).toEqual({
      normalizedUrl: "http://localhost:11434",
      models: [{ id: "ok", name: "ok", maxTokens: 4096 }],
    });
  });

  it("maps low-level probe failures to UI-friendly messages", () => {
    expect(getOllamaProbeErrorMessage(new Error("Invalid Ollama URL"))).toBe(
      "Enter a valid http:// or https:// Ollama URL.",
    );
    expect(getOllamaProbeErrorMessage("Ollama endpoint returned HTTP 404")).toBe(
      "Ollama endpoint returned HTTP 404",
    );
    expect(getOllamaProbeErrorMessage(new Error("socket hang up"))).toBe(
      "Could not connect to Ollama at this URL",
    );
  });
});
