import { editor, languages, Range } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { toast } from "sonner";
import {
  InlineEditError,
  requestInlineEdit,
} from "@/features/ai/intelligence/services/intelligence-text-service";
import { AutocompleteModelRequiredError } from "@/features/ai/intelligence/services/intelligence-connection";
import { useIntelligenceSettingsStore } from "@/features/ai/intelligence/stores/intelligence-settings.store";
import { onProviderApiTokenChange } from "@/features/ai/services/ai-token-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import {
  type IntelligenceCompletionPauseReason,
  useIntelligenceCompletionStore,
} from "@/features/editor/stores/intelligence-completion.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import {
  getModelFilePath,
  getNearbyDiagnostics,
  getRecentEdits,
  isAthasEditorModel,
  recordRecentEdit,
  SENSITIVE_FILE_PATTERN,
} from "./intelligence-completion-context";

let registered = false;
const notifiedPauseReasons = new Set<IntelligenceCompletionPauseReason>();

const PAUSE_NOTICES: Record<IntelligenceCompletionPauseReason, string> = {
  credits:
    "Tab autocomplete is paused: there is no Athas AI credit left. Pro includes $10 of Athas AI every month, then pay as you go at list price +10%.",
  "sign-in": "Tab autocomplete is paused. Sign in to use Athas AI.",
  "api-key": "Tab autocomplete is paused because the selected provider needs an API key.",
  policy: "Tab autocomplete is disabled by your organization.",
  model: "Tab autocomplete is paused until you choose a model for it in Settings.",
};

function getPauseReason(error: InlineEditError): IntelligenceCompletionPauseReason | null {
  if (error.status === 401) return error.hosted ? "sign-in" : "api-key";
  if (error.status === 402) return error.hosted ? "credits" : "api-key";
  // Only Athas enforces organization policy; a provider's own 403 is an ordinary failure.
  if (error.status === 403 && error.hosted) return "policy";
  return null;
}

/** Pauses Tab on account or billing errors so it stops retrying, and reports others once. */
export function reportIntelligenceCompletionError(error: unknown) {
  const { actions } = useIntelligenceCompletionStore.getState();
  // Tab on Automatic with nothing to run on: the status indicator says so, without a notice.
  if (error instanceof AutocompleteModelRequiredError) {
    actions.pause("model", error.message);
    return;
  }
  if (error instanceof InlineEditError) {
    const reason = getPauseReason(error);
    if (reason) {
      actions.pause(reason, error.message);
      // One notice per reason per session; after that the status indicator carries it. A
      // signed-out user only sees the indicator, since the notice is for lost sessions.
      const notify = reason !== "sign-in" || useAuthStore.getState().isAuthenticated;
      if (notify && !notifiedPauseReasons.has(reason)) {
        notifiedPauseReasons.add(reason);
        toast.warning(PAUSE_NOTICES[reason]);
      }
      return;
    }
    actions.fail(error.message);
    return;
  }
  actions.fail("Tab autocomplete failed. Try again.");
}

/**
 * Drops the end of a multi-line completion when it repeats the text that already follows
 * the cursor, such as a closing brace the model wrote again.
 */
export function trimSuffixOverlap(completion: string, suffix: string) {
  const nextLine = suffix.split(/\r?\n/, 1)[0].trim();
  if (!nextLine || !completion.includes("\n")) return completion;
  const trimmed = completion.trimEnd();
  if (!trimmed.endsWith(nextLine)) return completion;
  const withoutOverlap = trimmed.slice(0, trimmed.length - nextLine.length);
  return withoutOverlap.trim() ? withoutOverlap.replace(/[ \t]+$/, "") : completion;
}

export function createIntelligenceCompletionsProvider(): Monaco.languages.InlineCompletionsProvider {
  return {
    displayName: "Athas AI",
    debounceDelayMs: 350,
    async provideInlineCompletions(model, position, context, token) {
      if (
        token.isCancellationRequested ||
        context.selectedSuggestionInfo ||
        !useSettingsStore.getState().settings.aiCompletion ||
        useIntelligenceCompletionStore.getState().status.kind === "paused" ||
        !isAthasEditorModel(model) ||
        !editor
          .getEditors()
          .some(
            (instance) =>
              instance.getModel() === model &&
              instance.hasTextFocus() &&
              !instance.getOption(editor.EditorOption.readOnly),
          )
      )
        return { items: [] };

      const filePath = getModelFilePath(model);
      if (SENSITIVE_FILE_PATTERN.test(filePath)) {
        return { items: [] };
      }
      const offset = model.getOffsetAt(position);
      const beforeStart = model.getPositionAt(Math.max(0, offset - 12000));
      const afterEnd = model.getPositionAt(offset + 4000);
      const beforeSelection = model.getValueInRange(Range.fromPositions(beforeStart, position));
      if (!beforeSelection.trim()) return { items: [] };
      const afterSelection = model.getValueInRange(Range.fromPositions(position, afterEnd));
      const recentEdits = getRecentEdits(filePath, position.lineNumber);
      const diagnostics = getNearbyDiagnostics(
        editor.getModelMarkers?.({ resource: model.uri }) ?? [],
        position.lineNumber,
      );
      const version = model.getVersionId();
      const controller = new AbortController();
      const cancellation = token.onCancellationRequested(() => controller.abort());
      const subscriptions = [
        useAuthStore.subscribe((next, previous) => {
          if (next.user?.id !== previous.user?.id || next.subscription !== previous.subscription)
            controller.abort();
        }),
        useIntelligenceSettingsStore.subscribe((next, previous) => {
          if (next.scope !== previous.scope || next.preferences !== previous.preferences)
            controller.abort();
        }),
        useSettingsStore.subscribe((next, previous) => {
          if (next.settings !== previous.settings) controller.abort();
        }),
        model.onDidChangeContent(() => controller.abort()),
        model.onWillDispose(() => controller.abort()),
      ];
      const status = useIntelligenceCompletionStore.getState().actions;
      status.requestStarted();
      try {
        const { editedText } = await requestInlineEdit(
          {
            feature: "autocomplete",
            model: "",
            beforeSelection,
            selectedText: "",
            afterSelection,
            filePath,
            languageId: model.getLanguageId(),
            instruction:
              "Insert a completion at the cursor. Finish the whole statement or block when the next step is clear.",
            ...(recentEdits.length ? { recentEdits } : {}),
            ...(diagnostics.length ? { diagnostics } : {}),
          },
          { signal: controller.signal, timeoutMs: 10000 },
        );
        if (
          controller.signal.aborted ||
          token.isCancellationRequested ||
          model.isDisposed() ||
          model.getVersionId() !== version ||
          !editedText ||
          afterSelection.startsWith(editedText)
        ) {
          return { items: [] };
        }
        return {
          items: [
            {
              insertText: trimSuffixOverlap(editedText, afterSelection),
              range: Range.fromPositions(position),
            },
          ],
        };
      } catch (error) {
        if (!controller.signal.aborted && !token.isCancellationRequested) {
          reportIntelligenceCompletionError(error);
        }
        return { items: [] };
      } finally {
        status.requestFinished();
        cancellation.dispose();
        for (const subscription of subscriptions) {
          if (typeof subscription === "function") subscription();
          else subscription.dispose();
        }
      }
    },
    disposeInlineCompletions() {},
  };
}

function trackRecentEdits(model: Monaco.editor.ITextModel) {
  if (!isAthasEditorModel(model)) return;
  const subscription = model.onDidChangeContent((event) => {
    if (!event.isFlush) recordRecentEdit(model, event.changes);
  });
  model.onWillDispose(() => subscription.dispose());
}

export function registerIntelligenceCompletions() {
  if (registered) return;
  registered = true;
  languages.registerInlineCompletionsProvider(
    { scheme: "athas", pattern: "**/*" },
    createIntelligenceCompletionsProvider(),
  );
  for (const model of editor.getModels()) trackRecentEdits(model);
  editor.onDidCreateModel(trackRecentEdits);

  const resume = () => {
    if (useIntelligenceCompletionStore.getState().status.kind !== "idle") {
      useIntelligenceCompletionStore.getState().actions.resume();
    }
  };
  useAuthStore.subscribe((next, previous) => {
    if (
      next.user?.id !== previous.user?.id ||
      next.isAuthenticated !== previous.isAuthenticated ||
      next.subscription !== previous.subscription
    )
      resume();
  });
  useIntelligenceSettingsStore.subscribe((next, previous) => {
    if (next.scope !== previous.scope || next.preferences !== previous.preferences) resume();
  });
  // A pause for a missing or rejected API key lifts once a key is added or replaced, or once
  // Tab uses another provider or model.
  onProviderApiTokenChange(resume);
  useAIChatStore.subscribe((next, previous) => {
    if (next.providerApiKeys !== previous.providerApiKeys) resume();
  });
  useSettingsStore.subscribe((next, previous) => {
    if (
      next.settings.aiProviderId !== previous.settings.aiProviderId ||
      next.settings.aiModelId !== previous.settings.aiModelId
    )
      resume();
  });
}
