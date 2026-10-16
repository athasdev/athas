import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const openContent = vi.hoisted(() => vi.fn(() => "buffer-1"));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ actions: { openContent } }) },
}));

import { openCustomize } from "@/features/ai/customize/services/open-customize";
import { useCustomizeStore } from "@/features/ai/customize/stores/customize.store";
import { createPaneContent } from "@/features/editor/stores/buffer-content-factory";
import { isSingletonToolBuffer } from "@/features/panes/constants/tool-buffers";
import { isVirtualContent } from "@/features/panes/types/pane-content.types";

const state = () => useCustomizeStore.getState();

beforeEach(() => {
  openContent.mockClear();
  state().actions.setSection("mcp");
  state().actions.setTab("agents", "catalog");
});

describe("Customize routing", () => {
  it("opens the Customize tab on the requested page", () => {
    expect(openCustomize("skills")).toBe("buffer-1");
    expect(openContent).toHaveBeenCalledWith({ type: "customize" });
    expect(state().section).toBe("skills");
  });

  it("keeps the last page when no page is named", () => {
    openCustomize("agents");
    openCustomize();
    expect(state().section).toBe("agents");
  });

  it("reveals an installed item on its page's installed tab until the page changes", () => {
    state().actions.reveal("agents", "gemini-cli");
    expect(state()).toMatchObject({ section: "agents", revealedItemId: "gemini-cli" });
    expect(state().tabs.agents).toBe("installed");

    state().actions.setSection("mcp");
    expect(state().revealedItemId).toBeNull();
  });

  it("is one virtual singleton buffer", () => {
    const buffer = createPaneContent("b", { type: "customize" });
    expect(buffer).toMatchObject({
      type: "customize",
      path: "customize://agents",
      name: "Customize",
    });
    expect(isSingletonToolBuffer(buffer)).toBe(true);
    expect(isVirtualContent(buffer)).toBe(true);
  });
});
