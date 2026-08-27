import { describe, expect, it } from "vite-plus/test";
import {
  consumeCloseRequestSuppression,
  markCloseTabShortcutHandled,
} from "../utils/close-request-suppression";

describe("close request suppression", () => {
  it("consumes a close request immediately after the close-tab shortcut", () => {
    markCloseTabShortcutHandled(1000);

    expect(consumeCloseRequestSuppression(1500)).toBe(true);
    expect(consumeCloseRequestSuppression(1500)).toBe(false);
  });

  it("allows close requests outside the shortcut window", () => {
    markCloseTabShortcutHandled(1000);

    expect(consumeCloseRequestSuppression(2001)).toBe(false);
  });
});
