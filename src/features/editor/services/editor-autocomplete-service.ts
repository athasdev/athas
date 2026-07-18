import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { CUSTOM_AUTOCOMPLETE_PROVIDER_ID } from "@/features/ai/lib/custom-provider-config";
import { providerFetch } from "@/features/ai/services/providers/provider-fetch";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import { getAuthToken } from "@/features/window/services/auth-api";
import { getApiBase } from "@/utils/api-base";

const API_BASE = getApiBase();
const OPENROUTER_PROVIDER_ID = "openrouter";
const BYOK_HEADER = "X-OpenRouter-Api-Key";

export interface AutocompleteRequest {
  model: string;
  beforeCursor: string;
  afterCursor: string;
  filePath?: string;
  languageId?: string;
}

interface AutocompleteOptions {
  useByok?: boolean;
  provider?: "openrouter" | "custom";
  customBaseUrl?: string;
  onChunk?: (completion: string) => void;
}

export interface AutocompleteModel {
  id: string;
  name: string;
}

export class AutocompleteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AutocompleteError";
    this.status = status;
  }
}

type OpenRouterModelResponse = {
  data?: Array<{
    id?: string;
    name?: string;
  }>;
};

function parseModelListFromUnknown(payload: unknown): AutocompleteModel[] {
  let models: unknown[] = [];

  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { models?: unknown }).models)
  ) {
    models = (payload as { models: unknown[] }).models;
  } else if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as OpenRouterModelResponse).data)
  ) {
    models = (payload as OpenRouterModelResponse).data as unknown[];
  }

  return models
    .map((model) => {
      if (!model || typeof model !== "object") return null;
      const candidate = model as { id?: unknown; name?: unknown };
      const id = typeof candidate.id === "string" ? candidate.id : "";
      const name = typeof candidate.name === "string" ? candidate.name : id;
      if (!id) return null;
      return { id, name };
    })
    .filter((model): model is AutocompleteModel => Boolean(model));
}

export async function requestAutocomplete(
  request: AutocompleteRequest,
  options?: AutocompleteOptions,
): Promise<{ completion: string }> {
  if (options?.provider === "custom") {
    return requestCustomAutocomplete(request, options.customBaseUrl, options.onChunk);
  }

  const token = await getAuthToken();
  if (!token) {
    throw new AutocompleteError("Not authenticated", 401);
  }

  let byokKey: string | null = null;
  if (options?.useByok) {
    byokKey = await getProviderApiToken(OPENROUTER_PROVIDER_ID);
    if (!byokKey) {
      throw new AutocompleteError("OpenRouter API key is required for free autocomplete.", 402);
    }
  }

  const response = await tauriFetch(`${API_BASE}/api/ai/autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(byokKey ? { [BYOK_HEADER]: byokKey } : {}),
    },
    body: JSON.stringify(request),
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.error || `Autocomplete request failed (${response.status})`;
    throw new AutocompleteError(message, response.status);
  }

  return {
    completion: typeof body?.completion === "string" ? body.completion : "",
  };
}

function normalizeCustomBaseUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim().replace(/\/+$/, "") || "";
  if (!trimmed) {
    throw new AutocompleteError("Custom autocomplete base URL is required.", 400);
  }

  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function extractCustomCompletion(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  const nestedData = (payload as { data?: unknown }).data;
  if (nestedData && typeof nestedData === "object") {
    const nestedCompletion = extractCustomCompletion(nestedData);
    if (nestedCompletion) return nestedCompletion;
  }

  const directCandidate = payload as {
    completion?: unknown;
    text?: unknown;
    insertText?: unknown;
    suggestion?: unknown;
  };
  for (const value of [
    directCandidate.completion,
    directCandidate.text,
    directCandidate.insertText,
    directCandidate.suggestion,
  ]) {
    if (typeof value === "string") return value;
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") return "";
  const message = (firstChoice as { message?: unknown }).message;
  if (message && typeof message === "object") {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content;
  }
  const text = (firstChoice as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function extractCustomStreamChunk(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  const nestedData = (payload as { data?: unknown }).data;
  if (nestedData && typeof nestedData === "object") {
    const nestedChunk = extractCustomStreamChunk(nestedData);
    if (nestedChunk) return nestedChunk;
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (Array.isArray(choices)) {
    const firstChoice = choices[0];
    if (firstChoice && typeof firstChoice === "object") {
      const delta = (firstChoice as { delta?: unknown }).delta;
      if (delta && typeof delta === "object") {
        const content = (delta as { content?: unknown }).content;
        if (typeof content === "string") return content;
      }

      const text = (firstChoice as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }

  return extractCustomCompletion(payload);
}

function cleanCustomCompletion(completion: string): string {
  let cleaned = completion.replace(/\r\n/g, "\n").trimEnd();

  const fencedMatch = cleaned.match(/^```(?:[\w-]+)?\n([\s\S]*?)\n```$/);
  if (fencedMatch?.[1]) {
    cleaned = fencedMatch[1].trimEnd();
  }

  return cleaned;
}

type CustomAutocompleteRequestBody = {
  model: string;
  stream: boolean;
  temperature: number;
  max_tokens: number;
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
};

function buildCustomAutocompleteRequestBody(
  request: AutocompleteRequest,
  stream: boolean,
): CustomAutocompleteRequestBody {
  return {
    model: request.model,
    stream,
    temperature: 0.2,
    max_tokens: 96,
    messages: [
      {
        role: "system",
        content: [
          "You are an inline code autocomplete engine.",
          "Return only the exact text to insert at the cursor.",
          "Do not return markdown fences, explanations, or the whole file.",
          "Do not repeat text that already appears before or after the cursor.",
          "Do not close or recreate outer syntax unless that is the immediate next insertion.",
          "Prefer a short continuation: one token, one attribute, one expression, or a few lines at most.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          request.filePath ? `File: ${request.filePath}` : "File: untitled",
          request.languageId ? `Language: ${request.languageId}` : "Language: unknown",
          "<before_cursor>",
          request.beforeCursor,
          "</before_cursor>",
          "<after_cursor>",
          request.afterCursor,
          "</after_cursor>",
        ].join("\n"),
      },
    ],
  };
}

async function requestCustomAutocomplete(
  request: AutocompleteRequest,
  customBaseUrl: string | undefined,
  onChunk?: (completion: string) => void,
): Promise<{ completion: string }> {
  if (!request.model.trim()) {
    throw new AutocompleteError("Custom autocomplete model is required.", 400);
  }

  const apiKey = await getProviderApiToken(CUSTOM_AUTOCOMPLETE_PROVIDER_ID);
  const url = normalizeCustomBaseUrl(customBaseUrl);
  const requestBody = buildCustomAutocompleteRequestBody(request, true);

  const response = await tauriFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(requestBody),
  });

  const contentType = response.headers.get("content-type") || "";
  if (response.ok && response.body && contentType.includes("text/event-stream")) {
    const completion = await readCustomStreamingCompletion(response, onChunk);
    return { completion: cleanCustomCompletion(completion) };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
    const message =
      error &&
      typeof error === "object" &&
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : `Custom autocomplete request failed (${response.status})`;
    if (requestBody.stream) {
      return requestCustomAutocompleteNonStreaming(
        request,
        url,
        apiKey,
        buildCustomAutocompleteRequestBody(request, false),
      );
    }

    throw new AutocompleteError(message, response.status);
  }

  const completion = cleanCustomCompletion(extractCustomCompletion(body));
  return { completion };
}

async function readCustomStreamingCompletion(
  response: Response,
  onChunk?: (completion: string) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let completion = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith("event:")) continue;
        if (trimmedLine === "data: [DONE]") return completion;
        if (!trimmedLine.startsWith("data:")) continue;

        const json = trimmedLine.slice("data:".length).trim();
        if (!json) continue;

        try {
          const chunk = extractCustomStreamChunk(JSON.parse(json));
          if (!chunk) continue;
          completion += chunk;
          onChunk?.(cleanCustomCompletion(completion));
        } catch (error) {
          console.warn("Failed to parse autocomplete stream chunk:", error);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return completion;
}

async function requestCustomAutocompleteNonStreaming(
  request: AutocompleteRequest,
  url: string,
  apiKey: string | null,
  requestBody: CustomAutocompleteRequestBody,
): Promise<{ completion: string }> {
  const response = await tauriFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(requestBody),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
    const message =
      error &&
      typeof error === "object" &&
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : `Custom autocomplete request failed (${response.status})`;
    throw new AutocompleteError(message, response.status);
  }

  const completion = cleanCustomCompletion(extractCustomCompletion(body));
  return { completion };
}

export async function fetchAutocompleteModels(): Promise<AutocompleteModel[]> {
  const response = await providerFetch(`${API_BASE}/api/ai/autocomplete/models`, {
    method: "GET",
  });

  if (response.ok) {
    const body = await response.json();
    return parseModelListFromUnknown(body);
  }

  // Fallback: if backend endpoint fails,
  // load public OpenRouter model metadata directly.
  const openRouterResponse = await providerFetch("https://openrouter.ai/api/v1/models", {
    method: "GET",
  });

  if (!openRouterResponse.ok) {
    throw new AutocompleteError(
      `Failed to fetch fallback models (${openRouterResponse.status})`,
      openRouterResponse.status,
    );
  }

  const openRouterBody = await openRouterResponse.json();
  return parseModelListFromUnknown(openRouterBody);
}
