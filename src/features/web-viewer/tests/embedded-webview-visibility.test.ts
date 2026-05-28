import { describe, expect, it } from "vite-plus/test";
import { shouldShowEmbeddedWebview } from "../utils/embedded-webview-visibility";

describe("embedded webview visibility", () => {
  it("shows only the active visible webview", () => {
    expect(
      shouldShowEmbeddedWebview({
        isActive: true,
        isVisible: true,
        overlayHidden: false,
      }),
    ).toBe(true);
  });

  it("hides inactive webviews even when their pane content is visible", () => {
    expect(
      shouldShowEmbeddedWebview({
        isActive: false,
        isVisible: true,
        overlayHidden: false,
      }),
    ).toBe(false);
  });

  it("hides active webviews behind app overlays", () => {
    expect(
      shouldShowEmbeddedWebview({
        isActive: true,
        isVisible: true,
        overlayHidden: true,
      }),
    ).toBe(false);
  });
});
