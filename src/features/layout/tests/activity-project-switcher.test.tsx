import { describe, expect, it } from "vitest";
import { getProjectNameFromPath, isRemoteProjectPath } from "../components/sidebar/project-glyph";

describe("activity project switcher", () => {
  it("uses the shared project path rules for local and remote projects", () => {
    expect(getProjectNameFromPath("/Users/mehmet/Git/athas")).toBe("athas");
    expect(getProjectNameFromPath("C:\\Users\\mehmet\\athas")).toBe("athas");
    expect(getProjectNameFromPath()).toBe("Open Project");
    expect(isRemoteProjectPath("remote://server/workspace")).toBe(true);
    expect(isRemoteProjectPath("/Users/mehmet/Git/athas")).toBe(false);
  });
});
