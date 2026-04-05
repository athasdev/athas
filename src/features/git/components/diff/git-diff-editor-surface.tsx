import CodeEditor from "@/features/editor/components/code-editor";
import type { BreadcrumbProps } from "@/features/editor/components/toolbar/breadcrumb";
import { useDiffEditorBuffer } from "../../hooks/use-diff-editor-buffer";
import {
  serializeGitDiffForEditor,
  serializeMultiFileDiffForEditor,
} from "../../utils/diff-editor-content";
import type { MultiFileDiff } from "../../types/git-diff-types";
import type { GitDiff } from "../../types/git-types";

interface GitDiffEditorSurfaceProps {
  cacheKey: string;
  diff?: GitDiff;
  multiDiff?: MultiFileDiff;
  title?: string;
  breadcrumbProps?: BreadcrumbProps;
  readOnly?: boolean;
}

const GitDiffEditorSurface = ({
  cacheKey,
  diff,
  multiDiff,
  title,
  breadcrumbProps,
  readOnly = false,
}: GitDiffEditorSurfaceProps) => {
  const sourcePath = diff?.new_path || diff?.old_path || diff?.file_path || title || "Diff";
  const editorContent = diff
    ? serializeGitDiffForEditor(diff)
    : multiDiff
      ? serializeMultiFileDiffForEditor(multiDiff)
      : "";
  const bufferId = useDiffEditorBuffer({
    cacheKey,
    content: editorContent,
    sourcePath,
    name: title || sourcePath.split("/").pop() || "Diff",
  });

  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-primary-bg">
      <CodeEditor
        bufferId={bufferId}
        isActiveSurface={true}
        showToolbar={true}
        readOnly={readOnly}
        breadcrumbProps={breadcrumbProps}
      />
    </div>
  );
};

export default GitDiffEditorSurface;
