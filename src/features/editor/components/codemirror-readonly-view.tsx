import { defaultKeymap } from "@codemirror/commands";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef } from "react";
import { cn } from "@/utils/cn";
import { loadCodeMirrorLanguage } from "../engines/codemirror/languages";
import {
  athasEditorFont,
  athasEditorTheme,
  athasSyntaxHighlighting,
} from "../engines/codemirror/theme";
import { editorAPI } from "../services/editor-api";
import { useEditorViewSettings } from "../hooks/use-editor-view-settings";

export type ReadonlyEditorView = EditorView;

interface CodeMirrorReadonlyViewProps {
  content: string;
  /** An Athas language id; ids without CodeMirror support show as plain text. */
  languageId?: string;
  /** Extra extensions for this view, such as a log language's folding and decorations. */
  extensions?: Extension;
  wordWrap?: boolean;
  folding?: boolean;
  lineNumberFormatter?: (lineNumber: number) => string;
  ariaLabel?: string;
  className?: string;
  /**
   * Called once the editor exists. Return a cleanup that runs before the editor
   * is destroyed, so callers can remove listeners they added.
   */
  onReady?: (view: ReadonlyEditorView) => void | (() => void);
  /**
   * Called after the document text changed with the view and whether the change
   * was an append (the previous text is a prefix of the new one).
   */
  onContentApplied?: (view: ReadonlyEditorView, appended: boolean) => void;
}

const readonlyTheme = EditorView.theme({
  "&.cm-editor .cm-content": { padding: "8px 0" },
});

/**
 * A read-only CodeMirror surface that owns its own document instead of going
 * through the buffer store. Meant for large generated text such as CI logs:
 * CodeMirror only renders the visible lines, and appended content is applied as
 * an insertion so scroll position and folds survive live updates.
 */
export function CodeMirrorReadonlyView({
  content,
  languageId,
  extensions,
  wordWrap = false,
  folding = false,
  lineNumberFormatter,
  ariaLabel,
  className,
  onReady,
  onContentApplied,
}: CodeMirrorReadonlyViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const instanceId = useId();
  const settings = useEditorViewSettings();
  const contentApplied = useEffectEvent((view: EditorView, appended: boolean) =>
    onContentApplied?.(view, appended),
  );
  const ready = useEffectEvent((view: EditorView) => onReady?.(view));
  const compartments = useMemo(
    () => ({
      language: new Compartment(),
      extensions: new Compartment(),
      lineNumbers: new Compartment(),
      options: new Compartment(),
    }),
    [],
  );

  const optionExtensions = useMemo<Extension>(
    () => [
      athasEditorFont(settings.fontFamily, settings.fontSize, settings.lineHeight),
      athasSyntaxHighlighting(settings.editorItalicComments),
      wordWrap ? EditorView.lineWrapping : [],
      folding
        ? foldGutter({
            // Fold ranges can come from state the caller updates with effects, without a document
            // change, so the markers are refreshed whenever any effect is dispatched.
            foldingChanged: (update) =>
              update.transactions.some((transaction) => transaction.effects.length > 0),
          })
        : [],
      ariaLabel ? EditorView.contentAttributes.of({ "aria-label": ariaLabel }) : [],
    ],
    [
      ariaLabel,
      folding,
      settings.editorItalicComments,
      settings.fontFamily,
      settings.fontSize,
      settings.lineHeight,
      wordWrap,
    ],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ownerId = `athas-readonly-view-${instanceId}`;
    const focusListener = EditorView.updateListener.of((update) => {
      if (!update.focusChanged) return;
      if (update.view.hasFocus) {
        editorAPI.setActiveFindAdapter({
          ownerId,
          openFind: () => openSearchPanel(update.view),
        });
      } else {
        editorAPI.clearActiveFindAdapter(ownerId);
      }
    });

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: content,
        extensions: [
          EditorState.readOnly.of(true),
          highlightSpecialChars(),
          drawSelection(),
          search({ top: true }),
          keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]),
          athasEditorTheme,
          readonlyTheme,
          compartments.language.of([]),
          compartments.extensions.of(extensions ?? []),
          compartments.lineNumbers.of(lineNumberExtension(lineNumberFormatter)),
          compartments.options.of(optionExtensions),
          focusListener,
        ],
      }),
    });
    viewRef.current = view;
    const cleanup = ready(view);

    return () => {
      cleanup?.();
      editorAPI.clearActiveFindAdapter(ownerId);
      viewRef.current = null;
      view.destroy();
    };
    // The view is created once; everything else is reconfigured below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: compartments.lineNumbers.reconfigure(lineNumberExtension(lineNumberFormatter)),
    });
    const previous = view.state.doc.toString();
    if (previous === content) return;

    const appended = previous.length > 0 && content.startsWith(previous);
    view.dispatch({
      changes: appended
        ? { from: view.state.doc.length, insert: content.slice(previous.length) }
        : { from: 0, to: view.state.doc.length, insert: content },
    });
    contentApplied(view, appended);
  }, [compartments, content, lineNumberFormatter]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        compartments.options.reconfigure(optionExtensions),
        compartments.extensions.reconfigure(extensions ?? []),
      ],
    });
  }, [compartments, extensions, optionExtensions]);

  useEffect(() => {
    let cancelled = false;
    void loadCodeMirrorLanguage(languageId).then((language) => {
      const view = viewRef.current;
      if (cancelled || !view) return;
      view.dispatch({ effects: compartments.language.reconfigure(language ?? []) });
    });
    return () => {
      cancelled = true;
    };
  }, [compartments, languageId]);

  return (
    <div
      ref={containerRef}
      className={cn("size-full min-h-0 min-w-0", className)}
      data-editor-engine="codemirror"
      data-readonly-view
    />
  );
}

function lineNumberExtension(formatter: ((lineNumber: number) => string) | undefined): Extension {
  return formatter ? lineNumbers({ formatNumber: formatter }) : lineNumbers();
}
