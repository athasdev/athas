import { Compartment, type Extension, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useEffect, useMemo } from "react";
import type { LineSeparator } from "./document-change";

/**
 * What an editor feature (vim, LSP, inline edit, blame...) gets from the CodeMirror editor it is
 * rendered into. Features are components that take a host and install their own extensions with
 * `useCodeMirrorExtension`, so the editor component only has to render them.
 */
export interface CodeMirrorHost {
  view: EditorView;
  /** The editor's outer element, positioned, for overlays anchored to the editor. */
  container: HTMLElement;
  bufferId: string;
  filePath: string;
  languageId: string | null;
  viewStateKey: string | null;
  isActiveSurface: boolean;
  /** Read-only or preview: the user cannot edit the text. */
  isReadOnly: boolean;
  /** A buffer with no file behind it (diff sides, logs, scratch views). */
  isVirtual: boolean;
  /** Lines are numbered from a map (stitched views), so they don't match the file's lines. */
  hasLineNumberMap?: boolean;
  /** The buffer's line separator; positions handed to the rest of the app count CRLF as two. */
  getSeparator: () => LineSeparator;
  /** Runs the Athas buffer history, which owns undo and redo instead of CodeMirror. */
  applyHistory: (direction: "undo" | "redo") => boolean;
}

/**
 * Installs an extension into the view under its own compartment and keeps it in step with
 * `extension`, removing it again when the caller unmounts. Pass a memoized extension; every new
 * value reconfigures the view.
 */
export function useCodeMirrorExtension(view: EditorView | null, extension: Extension | null) {
  const compartment = useMemo(() => new Compartment(), []);

  useEffect(() => {
    if (!view) return;
    const next = extension ?? [];
    view.dispatch({
      effects:
        compartment.get(view.state) === undefined
          ? StateEffect.appendConfig.of(compartment.of(next))
          : compartment.reconfigure(next),
    });
  }, [compartment, extension, view]);

  useEffect(() => {
    if (!view) return;
    return () => {
      if (compartment.get(view.state) !== undefined) {
        view.dispatch({ effects: compartment.reconfigure([]) });
      }
    };
  }, [compartment, view]);
}
