import { describe, expect, it } from "vite-plus/test";
import { createMemoryStateStorage } from "@/utils/zustand-storage";
import { createTerminalProfilesStore } from "../stores/profiles.store";

describe("terminal profiles store", () => {
  it("preserves actions after persisted profiles hydrate", () => {
    const storage = createMemoryStateStorage();
    const firstStore = createTerminalProfilesStore(storage);

    firstStore.getState().actions.addProfile({
      name: "Project shell",
      shell: "/bin/zsh",
    });

    const restoredStore = createTerminalProfilesStore(storage);
    const restoredState = restoredStore.getState();

    expect(restoredState.profiles).toHaveLength(1);
    expect(restoredState.profiles[0]).toMatchObject({
      name: "Project shell",
      shell: "/bin/zsh",
    });
    expect(restoredState.actions.addProfile).toBeTypeOf("function");
    expect(restoredState.actions.updateProfile).toBeTypeOf("function");
    expect(restoredState.actions.deleteProfile).toBeTypeOf("function");
    expect(restoredState.actions.getProfile).toBeTypeOf("function");
  });
});
