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
}
