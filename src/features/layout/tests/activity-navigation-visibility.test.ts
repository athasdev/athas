import { describe, expect, it } from "vite-plus/test";
import { isActivityNavigationItemVisible } from "../utils/activity-navigation-visibility";

describe("Activity navigation visibility", () => {
  it("keeps focused core items visible and specialist items hidden", () => {
    const hiddenCoreItemIds = ["debugger", "databases", "extensions"];

    expect(isActivityNavigationItemVisible("files", hiddenCoreItemIds, [])).toBe(true);
    expect(isActivityNavigationItemVisible("debugger", hiddenCoreItemIds, [])).toBe(false);
  });

  it("shows extension views only after they are explicitly pinned", () => {
    expect(isActivityNavigationItemVisible("extension.tasks", [], [])).toBe(false);
    expect(isActivityNavigationItemVisible("extension.tasks", [], ["extension.tasks"])).toBe(true);
  });
});
