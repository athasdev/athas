import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { ProviderModel } from "./ai-provider-interface";
import { AIProvider, type ProviderHeaders, type StreamRequest } from "./ai-provider-interface";

/**
 * Ollama provider.
 *
 * Supports both local Ollama servers (e.g. `http://localhost:11434`) and
 * Ollama Cloud (`https://ollama.com`). For cloud, an API key is required and
 * is sent as a Bearer token. The OpenAI-compatible endpoints (`/v1/*`) are
 * used for chat completions since they match the streaming format the rest
 * of the app already parses; model discovery uses the native `/api/tags`
 * endpoint since that's what Ollama exposes for listing installed models
 * (and remote models on cloud).
 *
 * Docs:
 * - https://docs.ollama.com/api/introduction
 * - https://docs.ollama.com/cloud
 */

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const OLLAMA_CLOUD_BASE_URL = "https://ollama.com";

const OLLAMA_TIMEOUT_MS = 5000;

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    details?: { parameter_size?: string };
  }>;
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

/**
 * Heuristic: is this URL pointing at Ollama Cloud (which requires auth)?
 *
 * We only treat `ollama.com` hosts as cloud; everything else (localhost,
 * LAN IPs, custom gateways) is considered self-hosted and auth is optional.
 */
export function isOllamaCloudUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "ollama.com" || hostname.endsWith(".ollama.com");
  } catch {
    return false;
  }
}

function buildAuthHeaders(apiKey?: string | null): ProviderHeaders {
  const headers: ProviderHeaders = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function fetchOllamaTags(baseUrl: string, apiKey?: string | null) {
  return withTimeout(
    tauriFetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/tags`, {
      method: "GET",
      headers: buildAuthHeaders(apiKey),
    }),
  );
}

/**
 * Ping `/api/tags` and return whether the server responded OK. Optionally
 * sends an API key for Ollama Cloud. Returns false on any network or auth
 * error so callers can surface a simple "connected / not connected" state.
 */
export async function checkOllamaConnection(
  baseUrl: string,
  apiKey?: string | null,
): Promise<boolean> {
  try {
    const response = await fetchOllamaTags(baseUrl, apiKey);
    return response.ok;
  } catch {
    return false;
  }
}

export class OllamaProvider extends AIProvider {
  private baseUrl: string = DEFAULT_OLLAMA_BASE_URL;
  private apiKey: string | null = null;

  setBaseUrl(url: string): void {
    this.baseUrl = normalizeOllamaBaseUrl(url);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setApiKey(key: string | null): void {
    this.apiKey = key && key.length > 0 ? key : null;
  }

  getApiKey(): string | null {
    return this.apiKey;
  }

  /**
   * Accepts the API key either from the stream request (preferred — that's
   * the key fetched from secure storage) or falls back to the one stashed
   * on the instance (used by non-streaming calls like `getModels`).
   */
  buildHeaders(apiKey?: string): ProviderHeaders {
    return buildAuthHeaders(apiKey ?? this.apiKey);
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

  async validateApiKey(apiKey: string): Promise<boolean> {
    // If the current base URL is local, any key is effectively valid — but
    // users only enter a key for cloud, so validate against cloud.
    const target = isOllamaCloudUrl(this.baseUrl) ? this.baseUrl : OLLAMA_CLOUD_BASE_URL;
    return checkOllamaConnection(target, apiKey);
  }

  buildUrl(): string {
    return `${this.baseUrl}/v1/chat/completions`;
  }

  async getModels(): Promise<ProviderModel[]> {
    try {
      const response = await fetchOllamaTags(this.baseUrl, this.apiKey);
      if (!response.ok) return [];

      const data = (await response.json()) as OllamaTagsResponse;
      const models: ProviderModel[] = [];
      for (const model of data.models || []) {
        const id = model.name || model.model;
        if (!id) continue;
        const paramSize = model.details?.parameter_size;
        models.push({
          id,
          name: paramSize ? `${id} (${paramSize})` : id,
          maxTokens: 4096,
        });
      }
      return models;
    } catch {
      return [];
    }
  }
}
