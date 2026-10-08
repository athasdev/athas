import { Compartment, type Extension, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useLayoutEffect, useMemo } from "react";
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
 * Extensions waiting to be installed into a view in one transaction. Features mounting together
 * with the editor each add a compartment; installing them one dispatch at a time reconfigures the
 * whole editor once per feature before its first paint.
 */
const pendingInstalls = new WeakMap<EditorView, StateEffect<unknown>[]>();

/**
 * Collects the extensions features install from here on into one transaction, sent by
 * `endCodeMirrorExtensionBatch`. Extensions keep the order they were installed in.
 */
export function beginCodeMirrorExtensionBatch(view: EditorView) {
  if (pendingInstalls.has(view)) return;
  pendingInstalls.set(view, []);
  // A feature that throws before the batch ends must not leave the rest waiting for it.
  queueMicrotask(() => endCodeMirrorExtensionBatch(view));
}

/** Installs the extensions collected since `beginCodeMirrorExtensionBatch` in one dispatch. */
export function endCodeMirrorExtensionBatch(view: EditorView) {
  flushCodeMirrorExtensionBatch(view);
  pendingInstalls.delete(view);
}

/**
 * Installs what the open batch has collected so far, so an extension installed directly next
 * keeps its place after them.
 */
export function flushCodeMirrorExtensionBatch(view: EditorView) {
  const effects = pendingInstalls.get(view);
  if (!effects?.length) return;
  pendingInstalls.set(view, []);
  view.dispatch({ effects });
}

/**
 * Installs an extension into the view under its own compartment and keeps it in step with
 * `extension`, removing it again when the caller unmounts. Pass a memoized extension; every new
 * value reconfigures the view.
 *
 * Installed in a layout effect, so every extension is in place before the passive effects that
 * feed it state run; inside an extension batch the install joins the batch's transaction.
 */
export function useCodeMirrorExtension(view: EditorView | null, extension: Extension | null) {
  const compartment = useMemo(() => new Compartment(), []);

  useLayoutEffect(() => {
    if (!view) return;
    const next = extension ?? [];
    if (compartment.get(view.state) !== undefined) {
      view.dispatch({ effects: compartment.reconfigure(next) });
      return;
    }
    const install = StateEffect.appendConfig.of(compartment.of(next));
    const batch = pendingInstalls.get(view);
    if (batch) batch.push(install);
    else view.dispatch({ effects: install });
  }, [compartment, extension, view]);

  useLayoutEffect(() => {
    if (!view) return;
    return () => {
      if (compartment.get(view.state) !== undefined) {
        view.dispatch({ effects: compartment.reconfigure([]) });
      }
    };
  }, [compartment, view]);
}
