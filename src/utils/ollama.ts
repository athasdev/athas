import { invoke } from "@tauri-apps/api/core";
import type { ProviderModel } from "@/utils/providers/provider-interface";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

interface OllamaProbeResponse {
  normalizedUrl: string;
  models: ProviderModel[];
}

function normalizeOllamaBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return normalized || DEFAULT_OLLAMA_BASE_URL;
}

function parseProviderModel(value: unknown): ProviderModel | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    id?: unknown;
    name?: unknown;
    maxTokens?: unknown;
  };

  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
    return null;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    maxTokens: typeof candidate.maxTokens === "number" ? candidate.maxTokens : 4096,
  };
}

function parseOllamaProbeResponse(value: unknown): OllamaProbeResponse | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    normalizedUrl?: unknown;
    models?: unknown;
  };

  if (typeof candidate.normalizedUrl !== "string" || !Array.isArray(candidate.models)) {
    return null;
  }

  return {
    normalizedUrl: candidate.normalizedUrl,
    models: candidate.models
      .map((model) => parseProviderModel(model))
      .filter((model): model is ProviderModel => Boolean(model)),
  };
}

export async function probeOllamaEndpoint(baseUrl: string): Promise<OllamaProbeResponse> {
  const normalizedUrl = normalizeOllamaBaseUrl(baseUrl);
  const response = await invoke("probe_ollama_endpoint", {
    baseUrl: normalizedUrl,
  });

  const parsed = parseOllamaProbeResponse(response);
  if (!parsed) {
    throw new Error("Invalid Ollama probe response");
  }

  return parsed;
}

export async function listOllamaModels(baseUrl: string): Promise<ProviderModel[]> {
  const response = await probeOllamaEndpoint(baseUrl);
  return response.models;
}

export function getOllamaProbeErrorMessage(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "Could not connect to Ollama at this URL";

  if (message === "Invalid Ollama URL") {
    return "Enter a valid http:// or https:// Ollama URL.";
  }

  if (message.startsWith("Ollama endpoint returned HTTP ")) {
    return message;
  }

  return "Could not connect to Ollama at this URL";
}

export const __test__ = {
  normalizeOllamaBaseUrl,
  parseOllamaProbeResponse,
  parseProviderModel,
};
