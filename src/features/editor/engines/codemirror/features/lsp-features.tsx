import "./lsp-features.css";
import type { CodeMirrorHost } from "../host";
import { AiInlineCompletion } from "./ai-inline-completion";
import { LspCompletion } from "./lsp-completion";
import { LspDiagnostics } from "./lsp-diagnostics";
import { LspDocumentHighlight } from "./lsp-document-highlight";
import { LspHover } from "./lsp-hover";
import { LspSemanticTokens } from "./lsp-semantic-tokens";
import { LspSignatureHelp } from "./lsp-signature-help";

/** Language intelligence: diagnostics, hover, completion, hints, tokens, and AI ghost text. */
export function CodeMirrorLspFeatures({ host }: { host: CodeMirrorHost }) {
  return (
    <>
      <LspDiagnostics host={host} />
      <LspHover host={host} />
      <LspCompletion host={host} />
      <LspSignatureHelp host={host} />
      <LspSemanticTokens host={host} />
      <LspDocumentHighlight host={host} />
      <AiInlineCompletion host={host} />
    </>
  );
}
