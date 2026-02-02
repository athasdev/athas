import { invoke } from "@tauri-apps/api/core";

export interface EditorConfigProperties {
  indentStyle?: "tab" | "space";
  indentSize?: number;
  tabWidth?: number;
  endOfLine?: "lf" | "crlf" | "cr";
  charset?: string;
  trimTrailingWhitespace?: boolean;
  insertFinalNewline?: boolean;
  maxLineLength?: number;
}

function parseBoolValue(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseIntValue(value: string): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export async function fetchEditorConfigProperties(
  filePath: string,
): Promise<EditorConfigProperties> {
  try {
    const raw = await invoke<Record<string, string>>("get_editorconfig_properties", {
      filePath,
    });

    const properties: EditorConfigProperties = {};

    if (raw.indent_style === "tab" || raw.indent_style === "space") {
      properties.indentStyle = raw.indent_style;
    }
    if (raw.indent_size) {
      properties.indentSize = parseIntValue(raw.indent_size);
    }
    if (raw.tab_width) {
      properties.tabWidth = parseIntValue(raw.tab_width);
    }
    if (raw.end_of_line === "lf" || raw.end_of_line === "crlf" || raw.end_of_line === "cr") {
      properties.endOfLine = raw.end_of_line;
    }
    if (raw.charset) {
      properties.charset = raw.charset;
    }
    if (raw.trim_trailing_whitespace) {
      properties.trimTrailingWhitespace = parseBoolValue(raw.trim_trailing_whitespace);
    }
    if (raw.insert_final_newline) {
      properties.insertFinalNewline = parseBoolValue(raw.insert_final_newline);
    }
    if (raw.max_line_length) {
      properties.maxLineLength = parseIntValue(raw.max_line_length);
    }

    return properties;
  } catch {
    return {};
  }
}
