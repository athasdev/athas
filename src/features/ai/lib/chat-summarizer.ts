import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useAIChatStore } from "@/features/ai/store/store";
import type { Message } from "@/features/ai/types/ai-chat";
import { getModelById, getProviderById } from "@/features/ai/types/providers";
import { useSettingsStore } from "@/features/settings/store";
import { getProviderApiToken } from "@/utils/ai-chat";
import { getProvider } from "@/utils/providers";
import { processStreamingResponse } from "@/utils/stream-utils";

const SUMMARIZER_SYSTEM_PROMPT =
  "You are summarizing coding-chat history for future continuation. Be concise, accurate, and preserve concrete file paths, commands, decisions, and unresolved issues.";

const COMPACTION_PROMPT = `Summarize the conversation below into a compact continuation checkpoint.

Use this exact structure:

## Goal
[Short statement of the active goal]

## Constraints
- [Constraint or "(none)"]

## Progress
- [Completed or relevant progress]

## Current State
- [What is true right now]

## Next Steps
1. [Ordered next action]

## Critical Context
- [Important files, errors, commands, or facts]

Keep it short but specific.`;

const BRANCH_SUMMARY_PROMPT = `Summarize the branch-only work below so another session can continue with the important outcomes.

Use this exact structure:

## Goal
[What this branch tried to do]

## What Happened
- [Important work completed]

## Decisions
- [Key decision and why]

## Next Step
1. [Most important next action]

## Critical Context
- [Files, commands, errors, or caveats]

Keep it short but specific.`;

const getMessageLabel = (message: Message): string => {
  if (message.kind === "compaction-summary") {
    return "Compaction Summary";
  }

  if (message.kind === "branch-summary") {
    return "Branch Summary";
  }

  switch (message.role) {
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    default:
      return "User";
  }
};

const serializeMessages = (messages: Message[]): string =>
  messages
    .map((message) => {
      const parts = [`${getMessageLabel(message)}: ${message.content}`];
      if (message.toolCalls?.length) {
        for (const toolCall of message.toolCalls) {
          parts.push(`Tool ${toolCall.name}: ${JSON.stringify(toolCall.input ?? {})}`);
          if (toolCall.output) {
            parts.push(`Tool Output: ${JSON.stringify(toolCall.output)}`);
          }
          if (toolCall.error) {
            parts.push(`Tool Error: ${toolCall.error}`);
          }
        }
      }
      return parts.join("\n");
    })
    .join("\n\n");

interface ConfiguredSummaryModel {
  providerId: string;
  modelId: string;
  modelMaxTokens: number;
}

export const getConfiguredSummaryModel = (): ConfiguredSummaryModel => {
  const settings = useSettingsStore.getState().settings;
  const providerId = settings.aiProviderId;
  const modelId = settings.aiModelId;
  const staticModel = getModelById(providerId, modelId);
  const dynamicModel = useAIChatStore
    .getState()
    .dynamicModels[providerId]?.find((model) => model.id === modelId);
  const resolvedModelMaxTokens =
    dynamicModel?.maxTokens ||
    staticModel?.maxTokens ||
    getProviderById(providerId)?.models[0]?.maxTokens;

  if (!resolvedModelMaxTokens) {
    throw new Error(`No summarizer model configured for ${providerId}/${modelId}`);
  }

  return {
    providerId,
    modelId,
    modelMaxTokens: resolvedModelMaxTokens,
  };
};

const requestSummary = async (prompt: string): Promise<string> => {
  const { providerId, modelId } = getConfiguredSummaryModel();
  const providerConfig = getProviderById(providerId);
  const providerImpl = getProvider(providerId);

  if (!providerConfig || !providerImpl) {
    throw new Error(`Provider implementation not found: ${providerId}`);
  }

  const apiKey = await getProviderApiToken(providerId);
  if (!apiKey && providerConfig.requiresApiKey) {
    throw new Error(`${providerConfig.name} API key not found`);
  }

  const request = {
    modelId,
    messages: [
      { role: "system" as const, content: SUMMARIZER_SYSTEM_PROMPT },
      { role: "user" as const, content: prompt },
    ],
    maxTokens: 2048,
    temperature: 0.2,
    apiKey: apiKey || undefined,
  };

  const headers = providerImpl.buildHeaders(apiKey || undefined);
  const payload = providerImpl.buildPayload(request);
  const url = providerImpl.buildUrl ? providerImpl.buildUrl(request) : providerConfig.apiUrl;
  const fetchFn = providerId === "gemini" || providerId === "ollama" ? tauriFetch : fetch;
  const response = await fetchFn(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  let summary = "";
  let streamError: string | null = null;

  await processStreamingResponse(
    response,
    (chunk) => {
      summary += chunk;
    },
    () => undefined,
    (error) => {
      streamError = error;
    },
  );

  if (streamError) {
    throw new Error(streamError);
  }

  return summary.trim();
};

export const generateCompactionSummary = async (messages: Message[]): Promise<string> =>
  requestSummary(
    `${COMPACTION_PROMPT}\n\n<conversation>\n${serializeMessages(messages)}\n</conversation>`,
  );

export const generateBranchSummary = async (messages: Message[]): Promise<string> =>
  requestSummary(`${BRANCH_SUMMARY_PROMPT}\n\n<branch>\n${serializeMessages(messages)}\n</branch>`);
