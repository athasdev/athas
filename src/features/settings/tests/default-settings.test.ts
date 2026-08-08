import { describe, expect, it } from "vite-plus/test";
import { getDefaultSettingsSnapshot } from "@/features/settings/config/default-settings";

describe("default settings", () => {
  it("starts with window transparency disabled", () => {
    expect(getDefaultSettingsSnapshot().windowTransparency).toBe(false);
  });

  it("opens new projects in separate windows by default", () => {
    expect(getDefaultSettingsSnapshot().openFoldersInNewWindow).toBe(true);
  });

  it("preserves the established editor and terminal interaction behavior", () => {
    const settings = getDefaultSettingsSnapshot();

    expect(settings.editorFontLigatures).toBe(false);
    expect(settings.editorItalicComments).toBe(false);
    expect(settings.editorStickyScroll).toBe(false);
    expect(settings.editorBracketPairColorization).toBe(true);
    expect(settings.editorSmoothScrolling).toBe(false);
    expect(settings.editorScrollBeyondLastLine).toBe(false);
    expect(settings.editorCursorStyle).toBe("line");
    expect(settings.editorCursorBlinking).toBe("blink");
    expect(settings.terminalCursorInactiveStyle).toBe("outline");
    expect(settings.terminalAltClickMovesCursor).toBe(true);
    expect(settings.terminalMacOptionIsMeta).toBe(false);
    expect(settings.terminalRightClickSelectsWord).toBe(false);
  });

  it("preserves the established interface while exposing optional UI controls", () => {
    const settings = getDefaultSettingsSnapshot();

    expect(settings.reduceMotion).toBe(false);
    expect(settings.showStatusBar).toBe(true);
    expect(settings.showTabIcons).toBe(true);
    expect(settings.tabCloseButtonVisibility).toBe("active");
    expect(settings.windowChromeDensity).toBe("focused");
    expect(settings.activityRailExpanded).toBe(false);
    expect(settings.activityRailWidth).toBe(180);
    expect(settings.showActivityRailProjectSwitcher).toBe(true);
    expect(settings.showActivityRailAgentHistory).toBe(true);
    expect(settings.showActivityRailTerminals).toBe(true);
    expect(settings.showActivityRailWorktrees).toBe(true);
    expect(settings.showActivityRailProjectIcons).toBe(true);
    expect(settings.hiddenSidebarActivityItems).toEqual([]);
    expect(settings.collapsedActivityRailSections).toEqual([]);
    expect(settings.sidebarWidth).toBe(220);
  });

  it("preserves established file-tree behavior", () => {
    const settings = getDefaultSettingsSnapshot();

    expect(settings.fileTreeSortOrder).toBe("folders-first");
    expect(settings.autoRevealActiveFileInFileTree).toBe(true);
    expect(settings.showFileIconsInFileTree).toBe(true);
    expect(settings.showIndentGuidesInFileTree).toBe(true);
    expect(settings.confirmBeforeFileDelete).toBe(true);
  });
});
