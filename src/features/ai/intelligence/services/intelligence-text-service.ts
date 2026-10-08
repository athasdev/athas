import { tauriFetch } from "@/utils/tauri-fetch";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import { getProvider } from "@/features/ai/services/providers/ai-provider-registry";
import type { ProviderModel } from "@/features/ai/services/providers/ai-provider-interface";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AIMessage } from "@/features/ai/types/messages.types";
import { getModelById, getProviderById } from "@/features/ai/types/providers.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useIntelligenceSettingsStore } from "../stores/intelligence-settings.store";
import { getAuthToken } from "@/features/auth/services/auth-api";
import { getApiBase } from "@/utils/api-base";
import { processStreamingResponse } from "@/utils/stream-utils";
import {
  getIntelligenceConnection,
  assertIntelligenceConnectionAllowed,
} from "@/features/ai/intelligence/services/intelligence-connection";
import { shouldUseTauriFetchForProvider } from "@/features/ai/services/providers/ai-provider-registry";
import { toIntelligenceSdkPrompt } from "../lib/intelligence-sdk-prompt";

const API_BASE = getApiBase();
const DEFAULT_INLINE_EDIT_INSTRUCTION = "Improve this code while preserving behavior.";
export const HOSTED_TEXT_FIELD_LIMIT = 12000;
const HOSTED_AUTOCOMPLETE_SUFFIX_LIMIT = 4000;

type IntelligenceTextFeature = NonNullable<InlineEditRequest["feature"]>;

const DEFAULT_TIMEOUT_MS: Record<IntelligenceTextFeature, number> = {
  autocomplete: 10_000,
  "inline-edit": 60_000,
  "commit-message": 45_000,
  "github-draft": 60_000,
  "chat-title": 20_000,
  "terminal-title": 20_000,
  "review-summary": 90_000,
  "review-insight": 90_000,
};

export interface AutocompleteRecentEdit {
  filePath: string;
  snippet: string;
}

/** A summary of another open file, such as a module the current file imports. */
export interface AutocompleteRelatedFile {
  filePath: string;
  snippet: string;
}

export interface AutocompleteDiagnostic {
  line: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
}

export interface InlineEditRequest {
  feature?:
    | "autocomplete"
    | "inline-edit"
    | "commit-message"
    | "github-draft"
    | "chat-title"
    | "terminal-title"
    | "review-summary"
    | "review-insight";
  provider?: string;
  model: string;
  beforeSelection: string;
  selectedText: string;
  afterSelection?: string;
  instruction?: string;
  filePath?: string;
  languageId?: string;
  recentEdits?: AutocompleteRecentEdit[];
  diagnostics?: AutocompleteDiagnostic[];
  relatedFiles?: AutocompleteRelatedFile[];
}

export class InlineEditError extends Error {
  status: number;
  /** True when the error came from the Athas AI server rather than a local provider. */
  hosted: boolean;

  constructor(message: string, status: number, options?: { hosted?: boolean }) {
    super(message);
    this.name = "InlineEditError";
    this.status = status;
    this.hosted = options?.hosted ?? false;
  }
}

export function getDefaultIntelligenceTimeoutMs(feature: IntelligenceTextFeature = "inline-edit") {
  return DEFAULT_TIMEOUT_MS[feature];
}

export interface RequestInlineEditOptions {
  useHosted?: boolean;
  useByok?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function requestInlineEdit(
  request: InlineEditRequest,
  options?: RequestInlineEditOptions,
): Promise<{ editedText: string }> {
  options?.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(
    options?.timeoutMs ?? getDefaultIntelligenceTimeoutMs(request.feature),
  );
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    return await sendInlineEditRequest(request, { ...options, signal });
  } catch (error) {
    if (timeout.aborted && !options?.signal?.aborted) {
      throw new InlineEditError("The model took too long to respond. Try again.", 408);
    }
    throw error;
  }
}

async function sendInlineEditRequest(
  request: InlineEditRequest,
  options: RequestInlineEditOptions & { signal: AbortSignal },
): Promise<{ editedText: string }> {
  const selected = await getIntelligenceConnection(request.feature ?? "inline-edit");
  const connection = request.provider
    ? { ...selected, providerId: request.provider, modelId: request.model }
    : selected;
  assertIntelligenceConnectionAllowed(connection.providerId, request.feature ?? "inline-edit");
  const useHosted = options.useHosted ?? connection.providerId === "athas";
  const normalizedRequest = {
    ...request,
    provider: connection.providerId,
    model: connection.modelId.trim(),
    beforeSelection: request.beforeSelection,
    selectedText: request.selectedText,
    afterSelection: request.afterSelection || "",
    instruction: request.instruction?.trim() || DEFAULT_INLINE_EDIT_INSTRUCTION,
  };

  if (!useHosted && !normalizedRequest.model) {
    throw new InlineEditError("Choose a model for this AI feature.", 400);
  }

  if (!useHosted) {
    const result = await requestProviderInlineEdit(normalizedRequest, options.signal);
    if (
      (useAuthStore.getState().user?.id ?? null) !== connection.userId ||
      useIntelligenceSettingsStore.getState().scope !== connection.scope
    ) {
      throw new InlineEditError("The active account or team changed. Try again.", 409);
    }
    return result;
  }

  const token = await getAuthToken();
  if (
    (useAuthStore.getState().user?.id ?? null) !== connection.userId ||
    useIntelligenceSettingsStore.getState().scope !== connection.scope
  ) {
    throw new InlineEditError("The active account or team changed. Try again.", 409);
  }
  if (!token) {
    throw new InlineEditError("Sign in to use Athas AI.", 401, { hosted: true });
  }

  const autocomplete = request.feature === "autocomplete";
  if (normalizedRequest.selectedText.length > HOSTED_TEXT_FIELD_LIMIT) {
    throw new InlineEditError(
      `The selection is too large for Athas AI. Select at most ${HOSTED_TEXT_FIELD_LIMIT.toLocaleString("en-US")} characters.`,
      413,
    );
  }
  const beforeSelection = normalizedRequest.beforeSelection.slice(-HOSTED_TEXT_FIELD_LIMIT);
  const afterSelection = normalizedRequest.afterSelection.slice(
    0,
    autocomplete ? HOSTED_AUTOCOMPLETE_SUFFIX_LIMIT : HOSTED_TEXT_FIELD_LIMIT,
  );
  options.signal.throwIfAborted();
  const response = await tauriFetch(
    `${API_BASE}/api/ai/${autocomplete ? "autocomplete" : "inline-edit"}`,
    {
      signal: options.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Athas-Intelligence-Scope": connection.scope,
      },
      body: JSON.stringify(
        autocomplete
          ? {
              model: normalizedRequest.model || undefined,
              beforeCursor: beforeSelection,
              afterCursor: afterSelection,
              filePath: normalizedRequest.filePath,
              languageId: normalizedRequest.languageId,
              ...(request.recentEdits?.length ? { recentEdits: request.recentEdits } : {}),
              ...(request.diagnostics?.length ? { diagnostics: request.diagnostics } : {}),
              ...(request.relatedFiles?.length ? { relatedFiles: request.relatedFiles } : {}),
            }
          : { ...normalizedRequest, beforeSelection, afterSelection },
      ),
    },
  );

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? ((body as { error: string }).error ?? "")
        : `Inline edit request failed (${response.status})`;

    throw new InlineEditError(message, response.status, { hosted: true });
  }

  options.signal.throwIfAborted();
  const field = autocomplete ? "completion" : "editedText";
  const editedText =
    body &&
    typeof body === "object" &&
    field in body &&
    typeof (body as Record<string, unknown>)[field] === "string"
      ? (body as Record<string, string>)[field]
      : "";

  if (
    (useAuthStore.getState().user?.id ?? null) !== connection.userId ||
    useIntelligenceSettingsStore.getState().scope !== connection.scope
  ) {
    throw new InlineEditError("The active account or team changed. Try again.", 409);
  }
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

  if (providerId === "openrouter" || providerId === "custom" || providerId === "vercel") {
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
  signal?: AbortSignal,
): Promise<{ editedText: string }> {
  if (
    [
      "anthropic",
      "openai",
      "openrouter",
      "vercel",
      "gemini",
      "grok",
      "mistral",
      "deepseek",
      "qwen",
      "ollama",
      "custom",
    ].includes(request.provider)
  ) {
    const [{ generateText }, { getIntelligenceSdkModel }] = await Promise.all([
      import("ai"),
      import("./intelligence-sdk-model"),
    ]);
    const model = await getIntelligenceSdkModel(request.provider, request.model, request.feature);
    signal?.throwIfAborted();
    const maxOutputTokens =
      request.feature === "autocomplete"
        ? 256
        : ["chat-title", "terminal-title"].includes(request.feature ?? "")
          ? 128
          : 4096;
    const result = await generateText({
      model,
      ...toIntelligenceSdkPrompt(buildInlineEditMessages(request)),
      maxOutputTokens,
      maxRetries: 0,
      abortSignal: signal,
      ...(request.provider === "openai" ? { reasoning: "minimal" as const } : {}),
    });
    signal?.throwIfAborted();
    if (result.finishReason === "length" && request.feature !== "autocomplete")
      throw new InlineEditError("The result exceeded its limit. Try a smaller selection.", 502);
    return { editedText: cleanInlineEditOutput(result.text) };
  }
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
    maxTokens: Math.min(model.maxTokens || 4096, request.feature === "autocomplete" ? 256 : 4096),
    temperature: 0.2,
    apiKey: apiKey || undefined,
  };

  const [headers, payload, url] = await Promise.all([
    provider.buildHeaders(apiKey || undefined),
    provider.buildPayload(streamRequest),
    provider.buildUrl ? provider.buildUrl(streamRequest) : Promise.resolve(provider.apiUrl),
  ]);
  const needsTauriFetch = shouldUseTauriFetchForProvider(request.provider);
  const fetchFn = needsTauriFetch ? tauriFetch : fetch;

  signal?.throwIfAborted();
  const response = await fetchFn(url, {
    signal,
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

  signal?.throwIfAborted();
  if (streamError) {
    throw new InlineEditError(streamError, 500);
  }

  return { editedText: cleanInlineEditOutput(editedText) };
}

function buildInlineEditMessages(request: InlineEditRequest): AIMessage[] {
  const instructions = {
    autocomplete:
      "Complete the code at the cursor between before and after. Return only the new text to insert, preserving indentation. The completion may span several lines when the next logical step does, such as finishing a function body. Use recentEdits, diagnostics and relatedFiles (summaries of other open files, such as modules this file imports), when present, as hints for what the user is doing and which APIs exist. Do not repeat surrounding code, use markdown fences, or explain. Return nothing when a completion is not useful.",
    "inline-edit":
      "Rewrite only the selected code. Return replacement code without markdown fences or explanations. Preserve the surrounding code.",
    "commit-message":
      "Write a Git commit message from the supplied staged diff. Follow the requested format and repository style. Return only the message.",
    "github-draft":
      "Write the requested GitHub draft using the supplied context and output format. Do not claim unperformed tests or actions.",
    "chat-title":
      "Write a short concrete title for the conversation. Return only the title, not an answer to the conversation.",
    "terminal-title": "Write a short concrete title for the terminal task. Return only the title.",
    "review-summary":
      "Explain the supplied code-review changes, grounded in the patch. Follow the requested JSON format without markdown fences.",
    "review-insight":
      "Review the supplied code changes for the requested insight. Ground claims in the patch and follow the requested JSON format.",
  };
  return [
    { role: "system", content: instructions[request.feature ?? "inline-edit"] },
    {
      role: "user",
      content: JSON.stringify({
        file: request.filePath,
        language: request.languageId,
        instruction: request.instruction || DEFAULT_INLINE_EDIT_INSTRUCTION,
        before: request.beforeSelection,
        selection: request.selectedText,
        after: request.afterSelection || "",
        ...(request.recentEdits?.length ? { recentEdits: request.recentEdits } : {}),
        ...(request.diagnostics?.length ? { diagnostics: request.diagnostics } : {}),
        ...(request.relatedFiles?.length ? { relatedFiles: request.relatedFiles } : {}),
      }),
    },
  ];
}

function cleanInlineEditOutput(value: string): string {
  const trimmed = value.trim();
  const fenceMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : value;
}
