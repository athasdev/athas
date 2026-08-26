import { isMarkdownPreviewableFile } from "@/features/editor/markdown/previewable";

export type FilePreviewType = "markdownPreview" | "htmlPreview" | "csvPreview" | "svgPreview";

export function getFilePreviewType(path: string): FilePreviewType | null {
  if (isMarkdownPreviewableFile(path)) return "markdownPreview";

  const extension = path.split(".").pop()?.toLowerCase();

  if (extension === "html" || extension === "htm") return "htmlPreview";
  if (extension === "csv") return "csvPreview";
  if (extension === "svg") return "svgPreview";

  return null;
}
