import type { AIMessage } from "@/types/ai-chat";

export interface ProviderConfig {
  id: string;
  name: string;
  apiUrl: string;
  requiresApiKey: boolean;
  maxTokens: number;
}

export interface ProviderHeaders {
  [key: string]: string;
}

export interface StreamRequest {
  modelId: string;
  messages: AIMessage[];
  maxTokens: number;
  temperature: number;
  apiKey?: string;
}

export abstract class AIProvider {
  constructor(protected config: ProviderConfig) {}

  abstract buildHeaders(apiKey?: string): ProviderHeaders;
  abstract buildPayload(request: StreamRequest): any;
  abstract validateApiKey(apiKey: string): Promise<boolean>;

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get apiUrl(): string {
    return this.config.apiUrl;
  }

  get requiresApiKey(): boolean {
    return this.config.requiresApiKey;
  }

  // Default request URL (can be overridden by providers like Gemini)
  getRequestUrl(_modelId: string, _apiKey?: string): string {
    return this.config.apiUrl;
  }

  // Whether provider returns SSE streaming responses. Defaults to true.
  supportsSSE(): boolean {
    return true;
  }

  // For non-SSE providers, extract text content from JSON
  // Default returns empty string (unused by SSE providers)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseResponseJson(_json: any): string {
    return "";
  }
}
