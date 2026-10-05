import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { LspClient } from "../../../lsp/lsp-client";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { inlayHintDecorations, inlayHintsField, setInlayHints } from "../navigation/inlay-hints";
import { useLspRevision } from "./lsp-feature-utils";

const REFRESH_DELAY_MS = 250;
/** Lines past the viewport that are asked for too, so scrolling a little shows hints at once. */
const LINE_MARGIN = 100;

interface LineSpan {
  start: number;
  end: number;
}

function visibleLineSpan(view: EditorView, margin: number): LineSpan {
  const { doc } = view.state;
  const { from, to } = view.viewport;
  return {
    start: Math.max(0, doc.lineAt(from).number - 1 - margin),
    end: Math.min(doc.lines - 1, doc.lineAt(to).number - 1 + margin),
  };
}

/**
 * Inlay hints for the lines around the viewport, refreshed after edits (debounced) and when
 * scrolling leaves the lines already asked for. The `inlayHints` setting turns them off.
 */
export function useInlayHints(host: CodeMirrorHost, lspEnabled: boolean) {
  const { view, filePath } = host;
  const setting = useSettingsStore((state) => state.settings.inlayHints);
  const enabled = lspEnabled && setting;
  const revision = useLspRevision();
  const fetched = useRef<LineSpan | null>(null);
  const [scrollRevision, setScrollRevision] = useState(0);

  const extension = useMemo(
    () =>
      enabled
        ? [
            inlayHintsField,
            EditorView.updateListener.of((update) => {
              if (!update.viewportChanged) return;
              const visible = visibleLineSpan(update.view, 0);
              const span = fetched.current;
              if (!span || visible.start < span.start || visible.end > span.end) {
                setScrollRevision((current) => current + 1);
              }
            }),
          ]
        : null,
    [enabled],
  );
  useCodeMirrorExtension(view, extension);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const client = LspClient.getInstance();
      if (!client.isDocumentOpen(filePath)) return;
      const doc = view.state.doc;
      const lines = visibleLineSpan(view, LINE_MARGIN);
      fetched.current = lines;
      void client.getInlayHints(filePath, lines.start, lines.end + 1).then((hints) => {
        if (cancelled || view.state.doc !== doc) return;
        view.dispatch({ effects: setInlayHints.of(inlayHintDecorations(doc, hints)) });
      });
    }, REFRESH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, filePath, revision, scrollRevision, view]);
}
