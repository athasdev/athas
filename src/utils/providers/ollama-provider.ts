import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { ProviderModel } from "./provider-interface";
import { AIProvider, type ProviderHeaders, type StreamRequest } from "./provider-interface";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const OLLAMA_TIMEOUT_MS = 3000;

type OllamaTagsResponse = {
  models?: Array<{ name?: string }>;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs = OLLAMA_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function normalizeOllamaBaseUrl(url: string): string {
  return url.replace(/\/+$/, "") || DEFAULT_OLLAMA_BASE_URL;
}

async function fetchOllamaTags(baseUrl: string) {
  return withTimeout(
    tauriFetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/tags`, {
      method: "GET",
    }),
  );
}

export async function checkOllamaConnection(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetchOllamaTags(baseUrl);
    return response.ok;
  } catch {
    return false;
  }
}

export class OllamaProvider extends AIProvider {
  private baseUrl: string = DEFAULT_OLLAMA_BASE_URL;

  setBaseUrl(url: string) {
    this.baseUrl = normalizeOllamaBaseUrl(url);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  buildHeaders(): ProviderHeaders {
    return {
      "Content-Type": "application/json",
    };
  }

  buildPayload(request: StreamRequest) {
    return {
      model: request.modelId,
      messages: request.messages,
      stream: true,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    };
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }

  buildUrl(): string {
    return `${this.baseUrl}/v1/chat/completions`;
  }

  async getModels(): Promise<ProviderModel[]> {
    try {
      const response = await fetchOllamaTags(this.baseUrl);
      if (!response.ok) return [];

      const data = (await response.json()) as OllamaTagsResponse;
      return (data.models || [])
        .filter(
          (model): model is { name: string } => typeof model.name === "string" && !!model.name,
        )
        .map((model) => ({
          id: model.name,
          name: model.name,
          maxTokens: 4096,
        }));
    } catch {
      return [];
    }
  }
}
