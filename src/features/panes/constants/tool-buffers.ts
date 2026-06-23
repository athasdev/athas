import type { PaneContent, PaneContentType } from "@/features/panes/types/pane-content.types";

export type SingletonToolBufferType = Extract<
  PaneContentType,
  "globalSearch" | "diagnostics" | "references"
>;

export const SINGLETON_TOOL_BUFFER_METADATA: Record<
  SingletonToolBufferType,
  { path: string; name: string }
> = {
  globalSearch: {
    path: "search://global",
    name: "Search",
  },
  diagnostics: {
    path: "diagnostics://problems",
    name: "Diagnostics",
  },
  references: {
    path: "references://results",
    name: "References",
  },
};

export function isSingletonToolBufferType(type: PaneContentType): type is SingletonToolBufferType {
  return type in SINGLETON_TOOL_BUFFER_METADATA;
}

export function isSingletonToolBuffer(buffer: PaneContent): boolean {
  return isSingletonToolBufferType(buffer.type);
}
