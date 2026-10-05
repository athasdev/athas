import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { isLspHost } from "../navigation/lsp-document";
import { lspNavigationTheme } from "../navigation/navigation-theme";
import { CodeMirrorCodeActions } from "./lsp-code-actions";
import { useActiveNavigation } from "./use-active-navigation";
import { useDefinitionLinks } from "./use-definition-links";
import { useInlayHints } from "./use-inlay-hints";
import { useLspCodeLens } from "./use-lsp-code-lens";
import { useLspFolding } from "./use-lsp-folding";
import { useOnTypeFormatting } from "./use-on-type-formatting";
import { useReferencesPeek } from "./use-references-peek";

/**
 * LSP navigation and refactoring in a CodeMirror editor: go to definition links, the references
 * peek, code lenses, inlay hints, folding and selection ranges, on-type formatting and the code
 * action lightbulb. Rename and the format commands go through engine-neutral paths that apply
 * their edits to the buffer, which the editor then picks up.
 */
export function CodeMirrorLspNavigation({ host }: { host: CodeMirrorHost }) {
  const lspEnabled = isLspHost(host);
  useCodeMirrorExtension(host.view, lspNavigationTheme);
  useDefinitionLinks(host, lspEnabled);
  useLspFolding(host, lspEnabled);
  useInlayHints(host, lspEnabled);
  const peek = useReferencesPeek(host);
  useLspCodeLens(host, lspEnabled, peek.open);
  useOnTypeFormatting(host, lspEnabled);
  useActiveNavigation(host, lspEnabled, peek.peekAtCursor);

  return lspEnabled && !host.isReadOnly && host.isActiveSurface ? (
    <CodeMirrorCodeActions host={host} />
  ) : null;
}
