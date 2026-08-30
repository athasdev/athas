import { afterEach, describe, expect, it } from "vite-plus/test";
import { useLinuxFolderPickerStore } from "../stores/linux-folder-picker.store";

describe("Linux folder picker store", () => {
  afterEach(() => {
    useLinuxFolderPickerStore.getState().actions.resolve(null);
  });

  it("opens at the requested path and resolves the selected folder", async () => {
    const selection = useLinuxFolderPickerStore.getState().actions.open("/workspace");

    expect(useLinuxFolderPickerStore.getState()).toMatchObject({
      initialPath: "/workspace",
      isOpen: true,
    });

    useLinuxFolderPickerStore.getState().actions.resolve("/workspace/project");

    await expect(selection).resolves.toBe("/workspace/project");
    expect(useLinuxFolderPickerStore.getState()).toMatchObject({
      initialPath: null,
      isOpen: false,
    });
  });

  it("cancels an earlier pending picker before opening another one", async () => {
    const firstSelection = useLinuxFolderPickerStore.getState().actions.open("/first");
    const secondSelection = useLinuxFolderPickerStore.getState().actions.open("/second");

    await expect(firstSelection).resolves.toBeNull();
    expect(useLinuxFolderPickerStore.getState()).toMatchObject({
      initialPath: "/second",
      isOpen: true,
    });

    useLinuxFolderPickerStore.getState().actions.resolve("/second/project");
    await expect(secondSelection).resolves.toBe("/second/project");
  });
});
