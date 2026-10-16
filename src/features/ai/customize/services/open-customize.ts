import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useCustomizeStore } from "../stores/customize.store";
import type { CustomizeSection } from "../types/customize.types";

/**
 * Opens Customize, the page for MCP servers, agents, skills and extensions, as a tab in the main
 * area, on `section` when given and otherwise on the page it last showed.
 */
export function openCustomize(section?: CustomizeSection): string {
  if (section) useCustomizeStore.getState().actions.setSection(section);
  return useBufferStore.getState().actions.openContent({ type: "customize" });
}
