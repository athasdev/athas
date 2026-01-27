import { AIProvider, type ProviderHeaders, type StreamRequest } from "./provider-interface";

export class OllamaProvider extends AIProvider {
  buildHeaders(_apiKey?: string): ProviderHeaders {
    // Ollama typically doesn't require headers, but we can add Content-Type
    return {
      "Content-Type": "application/json",
    };
  }

  buildPayload(request: StreamRequest): any {
    return {
      model: request.modelId,
      messages: request.messages,
      stream: true,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    };
  }

  async validateApiKey(_apiKey: string): Promise<boolean> {
    // Ollama doesn't require an API key by default
    return true;
  }

  // Override buildUrl to point to the local Ollama instance
  buildUrl(_request: StreamRequest): string {
    return "http://localhost:11434/v1/chat/completions";
  }

  async getModels(): Promise<any[]> {
    try {
      const response = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(2000), // 2 second timeout
      });
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return data.models.map((model: any) => ({
        id: model.name,
        name: model.name,
        maxTokens: 4096, // Default for now as Ollama doesn't always provide this
      }));
    } catch {
      // Silent fail - Ollama is likely not running
      return [];
    }
  }
}
