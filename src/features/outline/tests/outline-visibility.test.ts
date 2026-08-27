import { beforeEach, describe, expect, it } from "vite-plus/test";
import { applyOutlineVisibilityPreference } from "@/features/outline/actions/outline-visibility";
import { useUIState } from "@/features/window/stores/ui-state.store";

describe("outline visibility preference", () => {
  beforeEach(() => {
    useUIState.setState({
      activeRightSidebarView: "outline",
      isRightSidebarVisible: false,
    });
  });

  it("opens Outline in the right sidebar", () => {
    applyOutlineVisibilityPreference(true);

    expect(useUIState.getState().activeRightSidebarView).toBe("outline");
    expect(useUIState.getState().isRightSidebarVisible).toBe(true);
  });

  it("closes the right sidebar when Outline is active", () => {
    useUIState.setState({ isRightSidebarVisible: true });

    applyOutlineVisibilityPreference(false);

    expect(useUIState.getState().isRightSidebarVisible).toBe(false);
  });

  it("does not close another active right sidebar view", () => {
    useUIState.setState({
      activeRightSidebarView: "collaboration",
      isRightSidebarVisible: true,
    });

    applyOutlineVisibilityPreference(false);

    expect(useUIState.getState().activeRightSidebarView).toBe("collaboration");
    expect(useUIState.getState().isRightSidebarVisible).toBe(true);
  });
});
