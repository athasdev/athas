import { describe, expect, it } from "vite-plus/test";
import { createStore } from "zustand/vanilla";
import { createModalSlice, type ModalSlice } from "@/features/window/stores/ui-state/modal-slice";

describe("settings dialog navigation", () => {
  it("opens Settings as a modal, navigates within it, and closes with the modal stack", () => {
    const store = createStore<ModalSlice>()(createModalSlice);
    store.getState().setIsCommandPaletteVisible(true);
    store.getState().openSettingsDialog("sharing");
    expect(store.getState().isSettingsDialogVisible).toBe(true);
    expect(store.getState().isCommandPaletteVisible).toBe(false);
    expect(store.getState().settingsInitialTab).toBe("sharing");
    expect(store.getState().hasOpenModal()).toBe(true);
    store.getState().openSettingsDialog("account", "profile");
    expect(store.getState().settingsNavigationRequestId).toBe(2);
    expect(store.getState().settingsInitialSection).toBe("profile");
    expect(store.getState().closeTopModal()).toBe(true);
    expect(store.getState().isSettingsDialogVisible).toBe(false);
  });
});
