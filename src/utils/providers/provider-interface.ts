import type { AIMessage } from "@/features/ai/types/messages";

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
  responseFormat?: "text" | "json_object";
}

export interface ProviderModel {
  id: string;
  name: string;
  maxTokens?: number;
}

export abstract class AIProvider {
  constructor(protected config: ProviderConfig) {}

  abstract buildHeaders(apiKey?: string): ProviderHeaders;
  abstract buildPayload(request: StreamRequest): any;
  abstract validateApiKey(apiKey: string): Promise<boolean>;

  // Optional: Allows providers to customize the URL (e.g., add API key as query param)
  buildUrl?(request: StreamRequest): string;

  // Optional: Allows providers to fetch available models dynamically
  async getModels?(): Promise<ProviderModel[]> {
    return [];
  }

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
