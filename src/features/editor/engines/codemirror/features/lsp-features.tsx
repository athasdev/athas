import "./lsp-features.css";
import type { CodeMirrorFeature } from "@/features/editor/services/editor-feature-registry";
import type { CodeMirrorHost } from "../host";
import { LspCompletion } from "./lsp-completion";
import { LspDiagnostics } from "./lsp-diagnostics";
import { LspDocumentHighlight } from "./lsp-document-highlight";
import { LspHover } from "./lsp-hover";
import { LspSemanticTokens } from "./lsp-semantic-tokens";
import { LspSignatureHelp } from "./lsp-signature-help";

/**
 * Language intelligence: diagnostics, hover, completion, hints and tokens, then the contributed
 * completion features (AI ghost text).
 */
export function CodeMirrorLspFeatures({
  host,
  completion,
}: {
  host: CodeMirrorHost;
  completion: CodeMirrorFeature[];
}) {
  return (
    <>
      <LspDiagnostics host={host} />
      <LspHover host={host} />
      <LspCompletion host={host} />
      <LspSignatureHelp host={host} />
      <LspSemanticTokens host={host} />
      <LspDocumentHighlight host={host} />
      {completion.map((Feature, index) => (
        <Feature key={index} host={host} />
      ))}
    </>
  );
}
