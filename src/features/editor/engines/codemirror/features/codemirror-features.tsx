import type { EditorView } from "@codemirror/view";
import { memo, Suspense, useEffect, useLayoutEffect } from "react";
import { fileOpenBenchmark } from "@/features/editor/services/file-open-benchmark";
import {
  getCodeMirrorFeatures,
  useEditorFeatures,
} from "@/features/editor/services/editor-feature-registry";
import {
  beginCodeMirrorExtensionBatch,
  type CodeMirrorHost,
  endCodeMirrorExtensionBatch,
} from "../host";
import { CodeMirrorBreakpoints } from "./codemirror-breakpoints";
import { CodeMirrorContextMenu } from "./codemirror-context-menu";
import { CodeMirrorEditorCommands } from "./codemirror-editor-commands";
import { CodeMirrorHoverCopyTooltip } from "./codemirror-hover-copy-tooltip";
import { CodeMirrorInlineGitBlame } from "./codemirror-inline-git-blame";
import { CodeMirrorLspFeatures } from "./lsp-features";
import { CodeMirrorLspNavigation } from "./lsp-navigation";
import { CodeMirrorMinimap } from "./minimap/codemirror-minimap";
import { CodeMirrorSearch } from "./codemirror-search";
import { CodeMirrorStickyScroll } from "./sticky-scroll/codemirror-sticky-scroll";
import { CodeMirrorVim } from "./codemirror-vim";

/**
 * Every editor feature rendered into a CodeMirror editor once its view exists. Memoized on the
 * host, so features only re-render when the host itself changes. Features contributed by other
 * features (`editor-feature-registry.ts`) render in their slot; until those have loaded, no feature
 * mounts, so every feature installs its extensions in the same order every time.
 */
export const CodeMirrorFeatures = memo(function CodeMirrorFeatures({
  host,
}: {
  host: CodeMirrorHost;
}) {
  return (
    <Suspense fallback={null}>
      <CodeMirrorFeatureList host={host} />
    </Suspense>
  );
});

function CodeMirrorFeatureList({ host }: { host: CodeMirrorHost }) {
  const contributions = useEditorFeatures();
  const { filePath } = host;
  useEffect(() => {
    fileOpenBenchmark.markOnce(filePath, "features-mounted");
  }, [filePath]);
  const overlays = getCodeMirrorFeatures(contributions, "overlays");
  const completion = getCodeMirrorFeatures(contributions, "completion");
  return (
    <>
      <ExtensionBatchStart view={host.view} />
      <CodeMirrorVim host={host} />
      <CodeMirrorSearch host={host} />
      <CodeMirrorContextMenu host={host} />
      <CodeMirrorEditorCommands host={host} />
      <CodeMirrorBreakpoints host={host} />
      <CodeMirrorInlineGitBlame host={host} />
      {overlays.map((Feature, index) => (
        <Feature key={index} host={host} />
      ))}
      <CodeMirrorHoverCopyTooltip host={host} />
      <CodeMirrorMinimap host={host} />
      <CodeMirrorStickyScroll host={host} />
      <CodeMirrorLspNavigation host={host} />
      <CodeMirrorLspFeatures host={host} completion={completion} />
      <ExtensionBatchEnd view={host.view} />
    </>
  );
}

/**
 * Brackets the features: React runs layout effects in render order, so the features mounting for
 * a view install their extensions between these two, and the view is reconfigured once.
 */
function ExtensionBatchStart({ view }: { view: EditorView }) {
  useLayoutEffect(() => beginCodeMirrorExtensionBatch(view), [view]);
  return null;
}

function ExtensionBatchEnd({ view }: { view: EditorView }) {
  useLayoutEffect(() => endCodeMirrorExtensionBatch(view), [view]);
  return null;
}
