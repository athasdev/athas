import type { BrowserContent } from "@/features/panes/types/pane-content.types";

export type BrowserPagePatch = Partial<Pick<BrowserContent, "url" | "name" | "favicon" | "zoom">>;

/**
 * Where a page that is not a browser tab keeps its address and zoom, such as the browser in an
 * agent session's panel. Browser tabs keep theirs on their buffer instead.
 */
export interface BrowserPageStore {
  read: () => Pick<BrowserContent, "url" | "zoom"> | null;
  update: (patch: BrowserPagePatch) => void;
}
