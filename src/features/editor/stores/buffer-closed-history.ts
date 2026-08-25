import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import type { GitDiff } from "@/features/git/types/git.types";
import type { PaneContent } from "@/features/panes/types/pane-content.types";

type ClosedBufferType =
  | "editor"
  | "image"
  | "pdf"
  | "binary"
  | "diff"
  | "markdownPreview"
  | "htmlPreview"
  | "csvPreview";

interface ClosedBufferBase {
  type: ClosedBufferType;
  path: string;
  name: string;
  isPinned: boolean;
}

interface ClosedEditorLikeBuffer extends ClosedBufferBase {
  type: "editor" | "image" | "pdf" | "binary";
}

interface ClosedDiffBuffer extends ClosedBufferBase {
  type: "diff";
  content: string;
  diffData?: GitDiff | MultiFileDiff;
}

interface ClosedPreviewBuffer extends ClosedBufferBase {
  type: "markdownPreview" | "htmlPreview" | "csvPreview";
  content: string;
  sourceFilePath: string;
}

export type ClosedBuffer = ClosedEditorLikeBuffer | ClosedDiffBuffer | ClosedPreviewBuffer;

const isReopenableBuffer = (
  buffer: PaneContent,
): buffer is Extract<PaneContent, { type: ClosedBufferType }> => {
  return (
    (buffer.type === "editor" && !buffer.isVirtual) ||
    buffer.type === "image" ||
    buffer.type === "pdf" ||
    buffer.type === "binary" ||
    buffer.type === "diff" ||
    buffer.type === "markdownPreview" ||
    buffer.type === "htmlPreview" ||
    buffer.type === "csvPreview"
  );
};

export const getClosedBufferHistoryKey = (buffer: ClosedBuffer) => `${buffer.type}:${buffer.path}`;

export const buildClosedBufferHistoryEntry = (buffer: PaneContent): ClosedBuffer | null => {
  if (!isReopenableBuffer(buffer) || !buffer.path) return null;

  switch (buffer.type) {
    case "editor":
    case "image":
    case "pdf":
    case "binary":
      return {
        type: buffer.type,
        path: buffer.path,
        name: buffer.name,
        isPinned: buffer.isPinned,
      };
    case "diff":
      return {
        type: "diff",
        path: buffer.path,
        name: buffer.name,
        isPinned: buffer.isPinned,
        content: buffer.content,
        diffData: buffer.diffData,
      };
    case "markdownPreview":
    case "htmlPreview":
    case "csvPreview":
      return {
        type: buffer.type,
        path: buffer.path,
        name: buffer.name,
        isPinned: buffer.isPinned,
        content: buffer.content,
        sourceFilePath: buffer.sourceFilePath,
      };
  }
};
