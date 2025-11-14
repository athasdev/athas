import type { ParsedSnippet, TabStop } from "./types";

/**
 * Parse a snippet body into a ParsedSnippet with tab stops
 * Supports TextMate snippet syntax:
 * - $1, $2, etc. - simple tab stops
 * - ${1}, ${2}, etc. - tab stops with braces
 * - ${1:placeholder} - tab stops with placeholder text
 * - ${1|choice1,choice2|} - tab stops with choices
 * - $0 - final tab stop
 */
export function parseSnippet(body: string | string[]): ParsedSnippet {
  // Convert array body to string
  const bodyStr = Array.isArray(body) ? body.join("\n") : body;

  const tabStops: TabStop[] = [];
  let expandedBody = bodyStr;
  let offset = 0;

  // Regular expressions for different tab stop patterns
  const patterns = [
    // ${1:placeholder}
    {
      regex: /\$\{(\d+):([^}]+)\}/g,
      handler: (match: RegExpMatchArray): string => {
        const index = parseInt(match[1], 10);
        const placeholder = match[2];
        const startOffset = offset;

        tabStops.push({
          index,
          placeholder,
          offset: startOffset,
          length: placeholder.length,
        });

        offset += placeholder.length;
        return placeholder;
      },
    },
    // ${1|choice1,choice2|}
    {
      regex: /\$\{(\d+)\|([^}]+)\|\}/g,
      handler: (match: RegExpMatchArray): string => {
        const index = parseInt(match[1], 10);
        const choicesStr = match[2];
        const choices = choicesStr.split(",").map((c) => c.trim());
        const placeholder = choices[0] || "";
        const startOffset = offset;

        tabStops.push({
          index,
          placeholder,
          choices,
          offset: startOffset,
          length: placeholder.length,
        });

        offset += placeholder.length;
        return placeholder;
      },
    },
    // ${1} or $1
    {
      regex: /\$\{(\d+)\}|\$(\d+)/g,
      handler: (match: RegExpMatchArray): string => {
        const index = parseInt(match[1] || match[2], 10);
        const startOffset = offset;

        tabStops.push({
          index,
          offset: startOffset,
          length: 0,
        });

        return "";
      },
    },
  ];

  // Process each pattern
  for (const { regex, handler } of patterns) {
    let lastIndex = 0;
    let result = "";
    offset = 0;

    const matches = Array.from(expandedBody.matchAll(regex));

    for (const match of matches) {
      // Add text before the match
      const beforeMatch = expandedBody.slice(lastIndex, match.index);
      result += beforeMatch;
      offset += beforeMatch.length;

      // Handle the match
      const replacement = handler(match);
      result += replacement;

      lastIndex = (match.index || 0) + match[0].length;
    }

    // Add remaining text
    result += expandedBody.slice(lastIndex);
    expandedBody = result;
  }

  // Sort tab stops by index
  tabStops.sort((a, b) => a.index - b.index);

  return {
    body: bodyStr,
    expandedBody,
    tabStops,
    hasTabStops: tabStops.length > 0,
  };
}

/**
 * Replace snippet variables with actual values
 * Supports common VSCode snippet variables
 */
export function replaceVariables(
  text: string,
  context?: {
    fileName?: string;
    filePath?: string;
    selectedText?: string;
  },
): string {
  let result = text;

  // Date/time variables
  const now = new Date();
  result = result.replace(/\$CURRENT_YEAR/g, now.getFullYear().toString());
  result = result.replace(/\$CURRENT_MONTH/g, (now.getMonth() + 1).toString().padStart(2, "0"));
  result = result.replace(/\$CURRENT_DATE/g, now.getDate().toString().padStart(2, "0"));
  result = result.replace(/\$CURRENT_HOUR/g, now.getHours().toString().padStart(2, "0"));
  result = result.replace(/\$CURRENT_MINUTE/g, now.getMinutes().toString().padStart(2, "0"));
  result = result.replace(/\$CURRENT_SECOND/g, now.getSeconds().toString().padStart(2, "0"));

  // File variables
  if (context?.fileName) {
    result = result.replace(/\$TM_FILENAME/g, context.fileName);
    const nameWithoutExt = context.fileName.replace(/\.[^.]+$/, "");
    result = result.replace(/\$TM_FILENAME_BASE/g, nameWithoutExt);
  }

  if (context?.filePath) {
    result = result.replace(/\$TM_FILEPATH/g, context.filePath);
    const directory = context.filePath.substring(0, context.filePath.lastIndexOf("/"));
    result = result.replace(/\$TM_DIRECTORY/g, directory);
  }

  if (context?.selectedText) {
    result = result.replace(/\$TM_SELECTED_TEXT/g, context.selectedText);
    result = result.replace(/\$SELECTION/g, context.selectedText);
  }

  // Default empty for unsupported variables
  result = result.replace(/\$[A-Z_]+/g, "");

  return result;
}
