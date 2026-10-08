import type { EditorView } from "@codemirror/view";
import { useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { LspClient } from "../../../lsp/services/lsp-client";
import { navigateToLspLocation } from "../../../lsp/services/location-navigation";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import type { LspLocation } from "../navigation/code-lens";
import { toLspPosition } from "../navigation/lsp-document";
import {
  closeReferencesPeek,
  openReferencesPeek,
  referencesPeek,
} from "../navigation/references-peek";
import { jumpOrigin } from "./lsp-feature-utils";
import { ReferencesPeekView } from "./references-peek-view";

export type OpenReferencesPeek = (position: number, locations: readonly LspLocation[]) => void;

/**
 * The inline references peek: `open` shows locations under a line, `peekAtCursor` asks the
 * language server for the references of the symbol at the cursor first.
 */
export function useReferencesPeek(host: CodeMirrorHost) {
  const { view } = host;
  const hostRef = useRef(host);
  hostRef.current = host;
  useCodeMirrorExtension(view, referencesPeek);

  const open = useCallback<OpenReferencesPeek>(
    (position, locations) => {
      if (locations.length === 0) {
        toast.info("No references found.");
        return;
      }
      openReferencesPeek(view, position, (element, peekView: EditorView) => {
        const root = createRoot(element);
        const origin = jumpOrigin(hostRef.current, peekView, position);
        root.render(
          <ReferencesPeekView
            locations={locations}
            sourceFilePath={hostRef.current.filePath}
            onClose={() => closeReferencesPeek(peekView)}
            onOpen={(location) => {
              closeReferencesPeek(peekView);
              void navigateToLspLocation(location, origin).catch((error: unknown) => {
                toast.error("Could not open reference", {
                  description: error instanceof Error ? error.message : String(error),
                });
              });
            }}
          />,
        );
        return () => {
          // The widget is torn down during a CodeMirror update, which may be inside a React
          // render of the editor; unmounting has to wait for that to finish.
          setTimeout(() => root.unmount(), 0);
        };
      });
    },
    [view],
  );

  const peekAtCursor = useCallback(async () => {
    const { filePath } = hostRef.current;
    const position = view.state.selection.main.head;
    const { line, character } = toLspPosition(view.state.doc, position);
    const doc = view.state.doc;
    const locations = await LspClient.getInstance().getReferences(filePath, line, character);
    if (view.state.doc !== doc) return;
    open(position, locations ?? []);
  }, [open, view]);

  return { open, peekAtCursor };
}
