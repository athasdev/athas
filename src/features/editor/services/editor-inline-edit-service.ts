import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import { getProvider } from "@/features/ai/services/providers/ai-provider-registry";
import type { ProviderModel } from "@/features/ai/services/providers/ai-provider-interface";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AIMessage } from "@/features/ai/types/messages.types";
import { getModelById, getProviderById } from "@/features/ai/types/providers.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { getAuthToken } from "@/features/window/services/auth-api";
import { getApiBase } from "@/utils/api-base";
import { processStreamingResponse } from "@/utils/stream-utils";

const API_BASE = getApiBase();
const HOSTED_INLINE_EDIT_PROVIDER_ID = "openrouter";
const DEFAULT_INLINE_EDIT_INSTRUCTION = "Improve this code while preserving behavior.";

export interface InlineEditRequest {
  provider?: string;
  model: string;
  beforeSelection: string;
  selectedText: string;
  afterSelection?: string;
  instruction?: string;
  filePath?: string;
  languageId?: string;
}

export class InlineEditError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "InlineEditError";
    this.status = status;
  }
}

export async function requestInlineEdit(
  request: InlineEditRequest,
  options?: { useHosted?: boolean; useByok?: boolean },
): Promise<{ editedText: string }> {
  const normalizedRequest = {
    ...request,
    provider: request.provider?.trim() || HOSTED_INLINE_EDIT_PROVIDER_ID,
    model: request.model.trim(),
    beforeSelection: request.beforeSelection,
    selectedText: request.selectedText,
    afterSelection: request.afterSelection || "",
    instruction: request.instruction?.trim() || DEFAULT_INLINE_EDIT_INSTRUCTION,
  };

  if (!normalizedRequest.model) {
    throw new InlineEditError("No inline edit model selected.", 400);
  }

  const useHosted = options?.useHosted ?? (!request.provider && !options?.useByok);

  if (!useHosted) {
    return requestProviderInlineEdit(normalizedRequest);
  }

  const token = await getAuthToken();
  if (!token) {
    throw new InlineEditError("Not authenticated", 401);
  }

  const response = await tauriFetch(`${API_BASE}/api/ai/inline-edit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(normalizedRequest),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    let message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? ((body as { error: string }).error ?? "")
        : `Inline edit request failed (${response.status})`;

    throw new InlineEditError(message, response.status);
  }

  const editedText =
    body &&
    typeof body === "object" &&
    "editedText" in body &&
    typeof (body as { editedText?: unknown }).editedText === "string"
      ? ((body as { editedText: string }).editedText ?? "")
      : "";

  return { editedText };
}

function resolveInlineEditModel(providerId: string, modelId: string): ProviderModel | undefined {
  const staticModel = getModelById(providerId, modelId);
  if (staticModel) return staticModel;

  const dynamicModel = useAIChatStore.getState().dynamicModels[providerId]?.find((model) => {
    return model.id === modelId;
  });
  if (dynamicModel) {
    return {
      ...dynamicModel,
      maxTokens: dynamicModel.maxTokens || 4096,
    };
  }

  if (providerId === "openrouter" || providerId === "custom") {
    return {
      id: modelId,
      name: modelId,
      maxTokens: 4096,
    };
  }

  return undefined;
}

async function requestProviderInlineEdit(
  request: Required<
    Pick<InlineEditRequest, "provider" | "model" | "beforeSelection" | "selectedText">
  > &
    Omit<InlineEditRequest, "provider" | "model" | "beforeSelection" | "selectedText">,
): Promise<{ editedText: string }> {
  const providerConfig = getProviderById(request.provider);
  const provider = getProvider(request.provider);
  const model = resolveInlineEditModel(request.provider, request.model);

  if (!providerConfig || !provider) {
    throw new InlineEditError(`Provider not found: ${request.provider}`, 400);
  }

  if (!model) {
    throw new InlineEditError(`Model not found: ${request.provider}/${request.model}`, 400);
  }

  if (request.provider === "custom" && !useSettingsStore.getState().settings.aiCustomBaseUrl) {
    throw new InlineEditError(
      "Custom provider base URL is required. Add one in Settings > AI.",
      400,
    );
  }

  const apiKey = providerConfig.requiresApiKey
    ? await getProviderApiToken(request.provider)
    : await getProviderApiToken(request.provider).catch(() => null);
  if (providerConfig.requiresApiKey && !apiKey) {
    throw new InlineEditError(`${providerConfig.name} API key is required for inline edit.`, 402);
  }

  const messages = buildInlineEditMessages(request);
  const streamRequest = {
    modelId: request.model,
    messages,
    maxTokens: Math.min(model.maxTokens || 4096, 4096),
    temperature: 0.2,
    apiKey: apiKey || undefined,
  };

  const headers = provider.buildHeaders(apiKey || undefined);
  const payload = provider.buildPayload(streamRequest);
  const url = provider.buildUrl ? provider.buildUrl(streamRequest) : provider.apiUrl;
  const needsTauriFetch =
    request.provider === "gemini" ||
    request.provider === "ollama" ||
    request.provider === "anthropic";
  const fetchFn = needsTauriFetch ? tauriFetch : fetch;

  const response = await fetchFn(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new InlineEditError(
      errorText || `${providerConfig.name} inline edit request failed (${response.status})`,
      response.status,
    );
  }

  let editedText = "";
  let streamError: string | null = null;
  await processStreamingResponse(
    response,
    (chunk) => {
      editedText += chunk;
    },
    () => {},
    (error) => {
      streamError = error;
    },
  );

  if (streamError) {
    throw new InlineEditError(streamError, 500);
  }

  return { editedText: cleanInlineEditOutput(editedText) };
}

function buildInlineEditMessages(request: InlineEditRequest): AIMessage[] {
  const fileContext = [
    request.filePath ? `File: ${request.filePath}` : null,
    request.languageId ? `Language: ${request.languageId}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      role: "system",
      content:
        "You are Athas inline edit. Return only the replacement text for the selected text. Do not include markdown fences, explanations, or surrounding unchanged context.",
    },
    {
      role: "user",
      content: [
        fileContext,
        `Instruction:\n${request.instruction || DEFAULT_INLINE_EDIT_INSTRUCTION}`,
        `Before selection:\n${request.beforeSelection}`,
        `Selected text:\n${request.selectedText}`,
        `After selection:\n${request.afterSelection || ""}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

function cleanInlineEditOutput(value: string): string {
  const trimmed = value.trim();
  const fenceMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}
