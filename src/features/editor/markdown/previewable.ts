export function isMarkdownPreviewableFile(filePath: string): boolean {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return extension === "md" || extension === "markdown" || extension === "rmd";
}
