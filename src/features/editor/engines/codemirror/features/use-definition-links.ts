import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { isMac } from "@/utils/platform";
import { LspClient } from "../../../lsp/lsp-client";
import { navigateToLspLocation } from "../../../lsp/location-navigation";
import { fileUriFromPath } from "../../../lsp/workspace-edit";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { definitionLink } from "../navigation/definition-link";
import { type DocumentLink, findDocumentLinkAt } from "../navigation/document-links";
import { toLspPosition } from "../navigation/lsp-document";
import { jumpOrigin } from "./lsp-feature-utils";
import { useProjectStore } from "@/features/workspace/stores/project.store";

async function openDocumentLink(link: DocumentLink, follow: (uri: string) => Promise<void>) {
  try {
    if (link.target.kind === "url") {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(link.target.url);
    } else {
      await follow(fileUriFromPath(link.target.path));
    }
  } catch (error) {
    toast.error("Could not open link", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cmd/Ctrl+hover and click for go to definition and document links. Multiple definitions go to
 * the first one, as Monaco's `multipleDefinitions: "goto"` did.
 */
export function useDefinitionLinks(host: CodeMirrorHost, lspEnabled: boolean) {
  const { filePath } = host;
  const hostRef = useRef(host);
  hostRef.current = host;
  const extension = useMemo(
    () =>
      definitionLink({
        isModifier: (event) => (isMac() ? event.metaKey : event.ctrlKey),
        resolveDefinition: lspEnabled
          ? (view, position) => {
              const { line, character } = toLspPosition(view.state.doc, position);
              return LspClient.getInstance().getDefinition(filePath, line, character);
            }
          : null,
        resolveLink: (view, position, withFiles) =>
          findDocumentLinkAt(
            view.state,
            position,
            withFiles ? filePath : "",
            useProjectStore.getState().rootFolderPath,
          ),
        openDefinition: (view, position, locations) => {
          const [first] = locations;
          if (!first) return;
          void navigateToLspLocation(first, jumpOrigin(hostRef.current, view, position)).catch(
            (error: unknown) => {
              toast.error("Could not open definition", {
                description: error instanceof Error ? error.message : String(error),
              });
            },
          );
        },
        openLink: (view, link) => {
          void openDocumentLink(link, (uri) =>
            navigateToLspLocation(
              { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
              jumpOrigin(hostRef.current, view, view.state.selection.main.head),
            ),
          );
        },
      }),
    [filePath, lspEnabled],
  );
  useCodeMirrorExtension(host.view, extension);
}
