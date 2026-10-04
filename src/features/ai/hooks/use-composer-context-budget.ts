import { useEffect, useMemo, useState } from "react";
import { getComposerContextBudget } from "@/features/ai/lib/composer-context-budget";
import { selectChatMode } from "@/features/ai/lib/composer-modes";
import { loadContextProjectRules } from "@/features/ai/lib/project-rules";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { getProviderById } from "@/features/ai/types/providers.types";
import type { EditorSelectionContext } from "@/features/ai/types/ai-context.types";
import type { Message } from "@/features/ai/types/ai-chat.types";
import type { ContextBudget } from "@/features/ai/types/context-budget.types";
import type { PaneContent } from "@/features/panes/types/pane-content.types";

const EMPTY_MESSAGES: Message[] = [];

/** The built-in agent's context budget for the composer's meter; null for other agents. */
export function useComposerContextBudget({
  enabled,
  chatId,
  projectRoot,
  providerId,
  modelId,
  buffers,
  selectedBufferIds,
  selectedFilesPaths,
  editorContexts,
}: {
  enabled: boolean;
  chatId: string | null;
  projectRoot: string | null;
  providerId: string;
  modelId: string;
  buffers: PaneContent[];
  selectedBufferIds: Set<string>;
  selectedFilesPaths: Set<string>;
  editorContexts: EditorSelectionContext[];
}): ContextBudget | null {
  const userRules = useSettingsStore((state) => state.settings.aiUserRules);
  const mode = useAIChatStore((state) => selectChatMode(state, chatId));
  const messages = useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === chatId)?.messages ?? EMPTY_MESSAGES,
  );
  const dynamicModels = useAIChatStore((state) => state.dynamicModels[providerId]);
  const modelContextWindow = (
    dynamicModels?.find((model) => model.id === modelId) ??
    getProviderById(providerId)?.models.find((model) => model.id === modelId)
  )?.contextWindow;

  const [rules, setRules] = useState<{ text: string; truncated: boolean } | null>(null);
  const rulePaths = [
    ...selectedFilesPaths,
    ...buffers.filter((buffer) => selectedBufferIds.has(buffer.id)).map((buffer) => buffer.path),
    ...editorContexts.map((selection) => selection.filePath),
  ]
    .sort()
    .join("\n");

  useEffect(() => {
    if (!enabled) {
      setRules(null);
      return;
    }
    let cancelled = false;
    void loadContextProjectRules(
      {
        projectRoot: projectRoot ?? undefined,
        selectedProjectFiles: rulePaths ? rulePaths.split("\n") : [],
      },
      { userRules },
    ).then((loaded) => {
      if (!cancelled) setRules(loaded ? { text: loaded.text, truncated: loaded.truncated } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, projectRoot, rulePaths, userRules]);

  return useMemo(
    () =>
      enabled
        ? getComposerContextBudget({
            providerId,
            modelContextWindow,
            mode,
            messages,
            buffers,
            selectedBufferIds,
            editorContexts,
            rules,
          })
        : null,
    [
      buffers,
      editorContexts,
      enabled,
      messages,
      mode,
      modelContextWindow,
      providerId,
      rules,
      selectedBufferIds,
    ],
  );
}
