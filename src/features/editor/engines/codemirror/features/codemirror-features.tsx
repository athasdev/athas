import { memo } from "react";
import type { CodeMirrorHost } from "../host";
import { CodeMirrorAgentEdits } from "./codemirror-agent-edits";
import { CodeMirrorBreakpoints } from "./codemirror-breakpoints";
import { CodeMirrorContextMenu } from "./codemirror-context-menu";
import { CodeMirrorEditorCommands } from "./codemirror-editor-commands";
import { CodeMirrorHoverCopyTooltip } from "./codemirror-hover-copy-tooltip";
import { CodeMirrorInlineEdit } from "./codemirror-inline-edit";
import { CodeMirrorInlineGitBlame } from "./codemirror-inline-git-blame";
import { CodeMirrorLspFeatures } from "./lsp-features";
import { CodeMirrorLspNavigation } from "./lsp-navigation";
import { CodeMirrorMinimap } from "./minimap/codemirror-minimap";
import { CodeMirrorSearch } from "./codemirror-search";
import { CodeMirrorSelectionAgentAction } from "./codemirror-selection-agent-action";
import { CodeMirrorStickyScroll } from "./sticky-scroll/codemirror-sticky-scroll";
import { CodeMirrorVim } from "./codemirror-vim";

/**
 * Every editor feature rendered into a CodeMirror editor once its view exists. Memoized on the
 * host, so features only re-render when the host itself changes.
 */
export const CodeMirrorFeatures = memo(function CodeMirrorFeatures({
  host,
}: {
  host: CodeMirrorHost;
}) {
  return (
    <>
      <CodeMirrorVim host={host} />
      <CodeMirrorSearch host={host} />
      <CodeMirrorContextMenu host={host} />
      <CodeMirrorEditorCommands host={host} />
      <CodeMirrorBreakpoints host={host} />
      <CodeMirrorInlineGitBlame host={host} />
      <CodeMirrorAgentEdits host={host} />
      <CodeMirrorSelectionAgentAction host={host} />
      <CodeMirrorInlineEdit host={host} />
      <CodeMirrorHoverCopyTooltip host={host} />
      <CodeMirrorMinimap host={host} />
      <CodeMirrorStickyScroll host={host} />
      <CodeMirrorLspNavigation host={host} />
      <CodeMirrorLspFeatures host={host} />
    </>
  );
});
