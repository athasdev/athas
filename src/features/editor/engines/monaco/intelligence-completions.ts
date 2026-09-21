import { editor, languages, Range } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { requestInlineEdit } from "@/features/ai/intelligence/services/intelligence-text-service";
import { useIntelligenceSettingsStore } from "@/features/ai/intelligence/stores/intelligence-settings.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { filePathFromAthasModelUri } from "./model-uri";

let registered = false;

export function createIntelligenceCompletionsProvider(): Monaco.languages.InlineCompletionsProvider {
  return {
    displayName: "Athas Intelligence",
    debounceDelayMs: 350,
    async provideInlineCompletions(model, position, context, token) {
      if (
        token.isCancellationRequested ||
        context.selectedSuggestionInfo ||
        !useSettingsStore.getState().settings.aiCompletion ||
        model.uri.scheme !== "athas" ||
        model.uri.authority !== "editor" ||
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

      const filePath = filePathFromAthasModelUri(model.uri.path, model.uri.query);
      if (/(?:^|[/\\])(?:\.env(?:\..*)?|[^/\\]+\.(?:pem|key|p12|pfx))$/i.test(filePath)) {
        return { items: [] };
      }
      const offset = model.getOffsetAt(position);
      const beforeStart = model.getPositionAt(Math.max(0, offset - 12000));
      const afterEnd = model.getPositionAt(offset + 4000);
      const beforeSelection = model.getValueInRange(Range.fromPositions(beforeStart, position));
      if (!beforeSelection.trim()) return { items: [] };
      const afterSelection = model.getValueInRange(Range.fromPositions(position, afterEnd));
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
            instruction: "Insert a short completion at the cursor.",
          },
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) },
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
        return { items: [{ insertText: editedText, range: Range.fromPositions(position) }] };
      } catch {
        return { items: [] };
      } finally {
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

export function registerIntelligenceCompletions() {
  if (registered) return;
  registered = true;
  languages.registerInlineCompletionsProvider(
    { scheme: "athas", pattern: "**/*" },
    createIntelligenceCompletionsProvider(),
  );
}
