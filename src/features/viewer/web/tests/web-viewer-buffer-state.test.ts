import { describe, expect, it } from "vite-plus/test";
import type { WebViewerContent } from "@/features/panes/types/pane-content.types";
import { getWebViewerBufferStateUpdate } from "../utils/web-viewer-buffer-state";

const buffer: WebViewerContent = {
  id: "web-1",
  type: "webViewer",
  path: "web-viewer://http://localhost:3000/",
  name: "localhost",
  title: "localhost",
  url: "http://localhost:3000/",
  profileKey: "workspace:athas",
  history: ["http://localhost:3000/"],
  historyIndex: 0,
  isPinned: false,
  isPreview: false,
  isActive: true,
};

describe("getWebViewerBufferStateUpdate", () => {
  it("does not replace an already synchronized buffer", () => {
    expect(
      getWebViewerBufferStateUpdate(buffer, {
        currentUrl: buffer.url,
        history: buffer.history ?? [],
        historyIndex: buffer.historyIndex ?? -1,
        profileKey: buffer.profileKey ?? "global",
      }),
    ).toBeNull();
  });

  it("clears unsupported persisted favicon URLs once", () => {
    const updated = getWebViewerBufferStateUpdate(
      { ...buffer, favicon: "file:///Users/example/project/favicon.ico" },
      {
        currentUrl: buffer.url,
        history: buffer.history ?? [],
        historyIndex: buffer.historyIndex ?? -1,
        profileKey: buffer.profileKey ?? "global",
      },
    );

    expect(updated?.favicon).toBeUndefined();
    expect(
      updated &&
        getWebViewerBufferStateUpdate(updated, {
          currentUrl: updated.url,
          history: updated.history ?? [],
          historyIndex: updated.historyIndex ?? -1,
          profileKey: updated.profileKey ?? "global",
        }),
    ).toBeNull();
  });
});
