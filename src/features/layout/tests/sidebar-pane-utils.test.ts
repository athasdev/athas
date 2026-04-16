import { describe, expect, test } from "vite-plus/test";
import { getActiveSidebarView, resolveSidebarPaneClick } from "../utils/sidebar-pane-utils";

describe("getActiveSidebarView", () => {
  test("defaults to files when no alternate pane is active", () => {
    expect(
      getActiveSidebarView({
        isGitViewActive: false,
        isGitHubPRsViewActive: false,
      }),
    ).toBe("files");
  });

  test("returns git when git is active", () => {
    expect(
      getActiveSidebarView({
        isGitViewActive: true,
        isGitHubPRsViewActive: false,
      }),
    ).toBe("git");
  });

  test("returns github-prs when pull requests are active", () => {
    expect(
      getActiveSidebarView({
        isGitViewActive: false,
        isGitHubPRsViewActive: true,
      }),
    ).toBe("github-prs");
  });
});

describe("resolveSidebarPaneClick", () => {
  test("hides the sidebar when clicking the active files tab", () => {
    expect(
      resolveSidebarPaneClick(
        {
          isSidebarVisible: true,
          isGitViewActive: false,
          isGitHubPRsViewActive: false,
        },
        "files",
      ),
    ).toEqual({
      nextIsSidebarVisible: false,
      nextView: "files",
    });
  });

  test("switches panes while keeping the sidebar open", () => {
    expect(
      resolveSidebarPaneClick(
        {
          isSidebarVisible: true,
          isGitViewActive: false,
          isGitHubPRsViewActive: false,
        },
        "git",
      ),
    ).toEqual({
      nextIsSidebarVisible: true,
      nextView: "git",
    });
  });

  test("reopens the sidebar when hidden", () => {
    expect(
      resolveSidebarPaneClick(
        {
          isSidebarVisible: false,
          isGitViewActive: true,
          isGitHubPRsViewActive: false,
        },
        "git",
      ),
    ).toEqual({
      nextIsSidebarVisible: true,
      nextView: "git",
    });
  });

  test("restores the clicked pane when reopening from hidden state", () => {
    expect(
      resolveSidebarPaneClick(
        {
          isSidebarVisible: false,
          isGitViewActive: true,
          isGitHubPRsViewActive: false,
        },
        "github-prs",
      ),
    ).toEqual({
      nextIsSidebarVisible: true,
      nextView: "github-prs",
    });
  });
});
