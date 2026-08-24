import { enableMapSet } from "immer";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { useUIExtensionStore } from "../ui/stores/ui-extension-store";

enableMapSet();

const extensionId = "test.structured-dialog";

afterEach(() => {
  useUIExtensionStore.getState().actions.cleanupExtension(extensionId);
});

describe("UI extension store", () => {
  it("replaces an open extension dialog with the same id", () => {
    const actions = useUIExtensionStore.getState().actions;
    const id = `${extensionId}.result`;

    actions.openDialog({
      id,
      extensionId,
      title: "Initial result",
      render: () => null,
    });
    actions.openDialog({
      id,
      extensionId,
      title: "Updated result",
      render: () => null,
    });

    const dialogs = useUIExtensionStore
      .getState()
      .activeDialogs.filter((dialog) => dialog.id === id);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].title).toBe("Updated result");
  });
});
