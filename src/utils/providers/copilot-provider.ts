import { AIProvider, type ProviderHeaders, type StreamRequest } from "./provider-interface";

const DEFAULT_BASE_URL = "https://api.githubcopilot.com";

export class CopilotProvider extends AIProvider {
  private enterpriseUri: string | null = null;

  setEnterpriseUri(uri: string | null) {
    this.enterpriseUri = uri;
  }

  getBaseUrl(): string {
    return this.enterpriseUri || DEFAULT_BASE_URL;
  }

  buildHeaders(token?: string): ProviderHeaders {
    const headers: ProviderHeaders = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Editor-Version": "Athas/1.0.0",
      "Editor-Plugin-Version": "copilot-athas/1.0.0",
      "User-Agent": "Athas/1.0.0",
      "Copilot-Integration-Id": "vscode-chat",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  buildPayload(request: StreamRequest): Record<string, unknown> {
    return {
      model: request.modelId,
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: true,
    };
  }

  buildUrl(): string {
    return `${this.getBaseUrl()}/chat/completions`;
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }
}
