import { activateBufferInPaneAndSync } from "@/features/panes/services/pane-activation";
import type { BrowserContent } from "@/features/panes/types/pane-content.types";
import { BrowserPage } from "./browser-page";

interface BrowserViewProps {
  buffer: BrowserContent;
  paneId: string;
  isActive: boolean;
}

export function BrowserView({ buffer, paneId, isActive }: BrowserViewProps) {
  return (
    <BrowserPage
      pageId={buffer.id}
      url={buffer.url}
      zoom={buffer.zoom}
      isActive={isActive}
      onPageFocus={() => activateBufferInPaneAndSync(paneId, buffer.id)}
    />
  );
}
