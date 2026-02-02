import { useEffect, useState } from "react";
import type { EditorConfigProperties } from "../api/editorconfig";
import { useEditorConfigStore } from "../stores/editorconfig-store";
import { useEditorSettingsStore } from "../stores/settings-store";

export interface ResolvedEditorSettings {
  tabSize: number;
  indentStyle: "tab" | "space";
  endOfLine?: "lf" | "crlf" | "cr";
  charset?: string;
  trimTrailingWhitespace?: boolean;
  insertFinalNewline?: boolean;
  maxLineLength?: number;
}

const VIRTUAL_PATH_PREFIXES = ["diff://", "preview://"];

function isVirtualPath(path: string): boolean {
  return VIRTUAL_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function useResolvedEditorSettings(filePath: string | null): ResolvedEditorSettings {
  const globalTabSize = useEditorSettingsStore.use.tabSize();
  const [editorConfigProperties, setEditorConfigProperties] = useState<EditorConfigProperties>({});

  useEffect(() => {
    if (!filePath || isVirtualPath(filePath)) {
      setEditorConfigProperties({});
      return;
    }

    let cancelled = false;
    useEditorConfigStore
      .getState()
      .actions.resolveProperties(filePath)
      .then((properties) => {
        if (!cancelled) setEditorConfigProperties(properties);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  return {
    tabSize: editorConfigProperties.indentSize ?? editorConfigProperties.tabWidth ?? globalTabSize,
    indentStyle: editorConfigProperties.indentStyle ?? "space",
    endOfLine: editorConfigProperties.endOfLine,
    charset: editorConfigProperties.charset,
    trimTrailingWhitespace: editorConfigProperties.trimTrailingWhitespace,
    insertFinalNewline: editorConfigProperties.insertFinalNewline,
    maxLineLength: editorConfigProperties.maxLineLength,
  };
}
