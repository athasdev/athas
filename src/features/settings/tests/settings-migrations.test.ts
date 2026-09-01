import { describe, expect, it } from "vite-plus/test";
import { migrateSettingsRecord } from "@/features/settings/lib/settings-migrations";

describe("settings migrations", () => {
  it("preserves a hidden Activity worktrees section in Source Control", () => {
    const migrated = migrateSettingsRecord({ showActivityRailWorktrees: false }, 2);

    expect(migrated.hiddenGitSidebarItems).toEqual(["worktrees"]);
    expect("showActivityRailWorktrees" in migrated).toBe(false);
  });

  it("keeps Worktrees visible when the old Activity section was visible", () => {
    const migrated = migrateSettingsRecord({ showActivityRailWorktrees: true }, 2);

    expect(migrated.hiddenGitSidebarItems).toEqual([]);
  });

  it("disables compact folders for settings created before the new default", () => {
    const migrated = migrateSettingsRecord({ compactFoldersInFileTree: true }, 3);

    expect(migrated.compactFoldersInFileTree).toBe(false);
  });

  it("preserves a compact folders opt-in after the migration", () => {
    const migrated = migrateSettingsRecord({ compactFoldersInFileTree: true }, 4);

    expect(migrated.compactFoldersInFileTree).toBe(true);
  });
});
