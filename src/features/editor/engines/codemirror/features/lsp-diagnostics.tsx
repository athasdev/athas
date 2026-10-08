import {
  type Diagnostic as LintDiagnostic,
  diagnosticCount,
  linter,
  setDiagnostics,
  setDiagnosticsEffect,
} from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import { useEffect } from "react";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";

const EMPTY_DIAGNOSTICS: Diagnostic[] = [];

/** Diagnostics come from the diagnostics store; the lint extension only displays them. */
const diagnosticsDisplay = linter(null);

function clampedPosition(doc: Text, line: number, column: number) {
  if (line >= doc.lines) return doc.length;
  const lineInfo = doc.line(Math.max(0, line) + 1);
  return lineInfo.from + Math.max(0, Math.min(lineInfo.length, column));
}

function renderDiagnosticMessage(diagnostic: Diagnostic) {
  const element = document.createElement("span");
  element.className = "cm-athas-diagnosticMessage";
  element.textContent = diagnostic.message;
  if (diagnostic.source || diagnostic.code) {
    const origin = document.createElement("span");
    origin.className = "cm-athas-diagnosticSource";
    origin.textContent = diagnostic.code
      ? `${diagnostic.source ?? ""}(${diagnostic.code})`
      : (diagnostic.source ?? "");
    element.append(" ", origin);
  }
  return element;
}

/** Store diagnostics as CodeMirror lint diagnostics, each covering at least one character. */
export function toLintDiagnostics(doc: Text, diagnostics: readonly Diagnostic[]): LintDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    const from = clampedPosition(doc, diagnostic.line, diagnostic.column);
    const to = Math.max(
      from,
      clampedPosition(
        doc,
        diagnostic.endLine,
        diagnostic.endLine === diagnostic.line
          ? Math.max(diagnostic.endColumn, diagnostic.column + 1)
          : diagnostic.endColumn,
      ),
    );
    return {
      from,
      to,
      severity: diagnostic.severity,
      message: diagnostic.message,
      renderMessage: () => renderDiagnosticMessage(diagnostic),
    };
  });
}

/** Squiggles and hover messages for the file's diagnostics, cleared again on unmount. */
export function LspDiagnostics({ host }: { host: CodeMirrorHost }) {
  const { view, filePath } = host;
  const diagnostics = useDiagnosticsStore((state) =>
    filePath ? (state.diagnosticsByFile.get(filePath) ?? EMPTY_DIAGNOSTICS) : EMPTY_DIAGNOSTICS,
  );

  useCodeMirrorExtension(view, diagnosticsDisplay);

  useEffect(() => {
    // Nothing to show or clear, as for most files when they open.
    if (diagnostics.length === 0 && diagnosticCount(view.state) === 0) return;
    view.dispatch(setDiagnostics(view.state, toLintDiagnostics(view.state.doc, diagnostics)));
    return () => {
      // The effect alone, so a lint extension that is already gone is not installed again.
      view.dispatch({ effects: setDiagnosticsEffect.of([]) });
    };
  }, [diagnostics, view]);

  return null;
}
