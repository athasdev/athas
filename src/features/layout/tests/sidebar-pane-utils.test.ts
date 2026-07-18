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

  test("returns the generic active sidebar view when no legacy pane is active", () => {
    expect(
      getActiveSidebarView({
        isGitViewActive: false,
        isGitHubPRsViewActive: false,
        activeSidebarView: "databases",
      }),
    ).toBe("databases");
  });

  test("returns collaboration when the collaboration pane is active", () => {
    expect(
      getActiveSidebarView({
        isGitViewActive: false,
        isGitHubPRsViewActive: false,
        activeSidebarView: "collaboration",
      }),
    ).toBe("collaboration");
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

  test("hides the sidebar when clicking an active generic tab", () => {
    expect(
      resolveSidebarPaneClick(
        {
          isSidebarVisible: true,
          isGitViewActive: false,
          isGitHubPRsViewActive: false,
          activeSidebarView: "databases",
        },
        "databases",
      ),
    ).toEqual({
      nextIsSidebarVisible: false,
      nextView: "databases",
    });
  });

  test("opens the collaboration pane like other sidebar views", () => {
    expect(
      resolveSidebarPaneClick(
        {
          isSidebarVisible: true,
          isGitViewActive: false,
          isGitHubPRsViewActive: false,
          activeSidebarView: "files",
        },
        "collaboration",
      ),
    ).toEqual({
      nextIsSidebarVisible: true,
      nextView: "collaboration",
    });
  });
});
