import { IS_MAC } from "@/utils/platform";

/**
 * Whether the workbench has no title row of its own: the traffic lights and the sidebar toggle sit
 * at the top of the sidebar, and the pane headers of the centre and the dock form the window's top
 * row. On macOS (and the web build, which reports macOS) nothing else needs the row. Windows and
 * Linux keep it, since their window controls would otherwise sit on the dock's pane actions.
 */
export const MERGED_TITLE_ROW = IS_MAC;
