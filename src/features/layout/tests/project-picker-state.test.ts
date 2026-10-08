import { createStore } from "zustand/vanilla";
import { describe, expect, it } from "vitest";
import { createModalSlice, type ModalSlice } from "../stores/ui-state/modal-slice";

const createModalStore = () => createStore<ModalSlice>()(createModalSlice);

describe("project picker state", () => {
  it("opens the requested project picker step", () => {
    const store = createModalStore();

    store.getState().openProjectPicker("addRemote");

    expect(store.getState().isProjectPickerVisible).toBe(true);
    expect(store.getState().projectPickerInitialStep).toBe("addRemote");
  });

  it("uses the project list for existing generic open calls", () => {
    const store = createModalStore();
    store.getState().openProjectPicker("addRemote");
    store.getState().setIsProjectPickerVisible(false);

    store.getState().setIsProjectPickerVisible(true);

    expect(store.getState().projectPickerInitialStep).toBe("picker");
  });
});
