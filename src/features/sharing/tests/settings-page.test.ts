import { describe, expect, it } from "vite-plus/test";
import { createStore } from "zustand/vanilla";
import { createModalSlice, type ModalSlice } from "@/features/layout/stores/ui-state/modal-slice";

describe("settings dialog navigation", () => {
  it("opens Settings as a modal and records where to navigate", () => {
    const store = createStore<ModalSlice>()(createModalSlice);
    store.getState().setIsCommandPaletteVisible(true);
    store.getState().openSettings("sharing");
    expect(store.getState().isCommandPaletteVisible).toBe(false);
    expect(store.getState().isSettingsVisible).toBe(true);
    expect(store.getState().settingsInitialTab).toBe("sharing");
    expect(store.getState().hasOpenModal()).toBe(true);

    store.getState().openSettings("account", "profile");
    expect(store.getState().settingsNavigationRequestId).toBe(2);
    expect(store.getState().settingsInitialSection).toBe("profile");
  });

  it("closes Settings after the overlays opened on top of it", () => {
    const store = createStore<ModalSlice>()(createModalSlice);
    store.getState().openSettings();
    store.getState().setIsCommandPaletteVisible(true);

    expect(store.getState().closeTopModal()).toBe(true);
    expect(store.getState().isCommandPaletteVisible).toBe(false);
    expect(store.getState().isSettingsVisible).toBe(true);

    expect(store.getState().closeTopModal()).toBe(true);
    expect(store.getState().isSettingsVisible).toBe(false);
    expect(store.getState().closeTopModal()).toBe(false);
  });
});
