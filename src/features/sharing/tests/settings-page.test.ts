import { describe, expect, it, vi } from "vite-plus/test";
import { createStore } from "zustand/vanilla";
import { createModalSlice, type ModalSlice } from "@/features/window/stores/ui-state/modal-slice";

const openSettingsBuffer = vi.hoisted(() => vi.fn());
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ actions: { openSettingsBuffer } }) },
}));

describe("settings page navigation", () => {
  it("opens Settings as a page rather than a modal and records where to navigate", async () => {
    const store = createStore<ModalSlice>()(createModalSlice);
    store.getState().setIsCommandPaletteVisible(true);
    store.getState().openSettings("sharing");
    expect(store.getState().isCommandPaletteVisible).toBe(false);
    expect(store.getState().settingsInitialTab).toBe("sharing");
    expect(store.getState().hasOpenModal()).toBe(false);
    await vi.waitFor(() => expect(openSettingsBuffer).toHaveBeenCalledTimes(1));
    store.getState().openSettings("account", "profile");
    expect(store.getState().settingsNavigationRequestId).toBe(2);
    expect(store.getState().settingsInitialSection).toBe("profile");
    expect(store.getState().closeTopModal()).toBe(false);
    await vi.waitFor(() => expect(openSettingsBuffer).toHaveBeenCalledTimes(2));
  });
});
