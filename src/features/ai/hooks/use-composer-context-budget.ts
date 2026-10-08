import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useBuffersTextRevision } from "@/features/editor/hooks/use-buffer-text";

const EMPTY_MESSAGES: Message[] = [];
const NO_BUFFERS: ReadonlySet<string> = new Set();
const ATTACHED_TEXT_SETTLE_MS = 300;
/** A streaming reply changes the conversation every frame; the meter follows it at this pace. */
const MESSAGES_SETTLE_MS = 300;

/**
 * The chat's messages, picked up once they stop changing for a moment. Read from the store
 * instead of selected from it, so a streaming reply does not re-render the composer each frame.
 */
function useSettledChatMessages(chatId: string | null): Message[] {
  const read = useCallback(
    () => (chatId ? useAIChatStore.getState().messagesByChat[chatId] : undefined) ?? EMPTY_MESSAGES,
    [chatId],
  );
  const [settled, setSettled] = useState(() => ({ read, messages: read() }));
  let current = settled;
  if (settled.read !== read) {
    current = { read, messages: read() };
    setSettled(current);
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () =>
      setSettled((previous) => {
        const messages = read();
        return previous.read === read && previous.messages === messages
          ? previous
          : { read, messages };
      });
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        settle();
      }, MESSAGES_SETTLE_MS);
    };
    let lastSeen = read();
    // Catches a change between the render and this subscription.
    settle();
    const unsubscribe = useAIChatStore.subscribe(() => {
      const messages = read();
      if (messages === lastSeen) return;
      lastSeen = messages;
      schedule();
    });
    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [read]);

  return current.messages;
}

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
  const messages = useSettledChatMessages(enabled ? chatId : null);
  const dynamicModels = useAIChatStore((state) => state.dynamicModels[providerId]);
  const modelContextWindow = (
    dynamicModels?.find((model) => model.id === modelId) ??
    getProviderById(providerId)?.models.find((model) => model.id === modelId)
  )?.contextWindow;

  const [rules, setRules] = useState<{ text: string; truncated: boolean } | null>(null);
  // Attached files count with their current text, re-read once edits to them pause.
  const attachedTextRevision = useBuffersTextRevision(
    enabled ? selectedBufferIds : NO_BUFFERS,
    ATTACHED_TEXT_SETTLE_MS,
  );
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
    // The attached text is read inside; its settled revision says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      attachedTextRevision,
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
