import type { Hover, MarkedString, MarkupContent } from "vscode-languageserver-types";

function formatHoverItem(item: string | MarkedString | MarkupContent): string {
  if (typeof item === "string") {
    return item;
  }

  if ("language" in item && item.language && item.value) {
    const singleLine = !item.value.includes("\n");
    if (singleLine && item.value.length <= 220) {
      return `\`${item.value}\``;
    }
    return `\`\`\`${item.language}\n${item.value}\n\`\`\``;
  }

  if ("kind" in item && item.value) {
    return item.value;
  }

  return "";
}

export function formatHoverContents(contents: Hover["contents"]): string {
  const content =
    typeof contents === "string"
      ? contents
      : Array.isArray(contents)
        ? contents.map(formatHoverItem).filter(Boolean).join("\n")
        : formatHoverItem(contents);

  return content
    .replace(/^\s*---+\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
