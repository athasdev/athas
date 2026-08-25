import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityProjectTrigger } from "../components/sidebar/activity-project-switcher";
import { getProjectNameFromPath, isRemoteProjectPath } from "../components/sidebar/project-glyph";

describe("activity project switcher", () => {
  it("renders one accessible trigger without nesting another interactive control", () => {
    const markup = renderToStaticMarkup(
      <ActivityProjectTrigger
        expanded
        projectName="athas"
        projectGlyph={<span aria-hidden="true">icon</span>}
      />,
    );

    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Switch project"');
    expect(markup).not.toContain('role="button"');
  });

  it("uses the shared project path rules for local and remote projects", () => {
    expect(getProjectNameFromPath("/Users/mehmet/Git/athas")).toBe("athas");
    expect(getProjectNameFromPath("C:\\Users\\mehmet\\athas")).toBe("athas");
    expect(getProjectNameFromPath()).toBe("Open Project");
    expect(isRemoteProjectPath("remote://server/workspace")).toBe(true);
    expect(isRemoteProjectPath("/Users/mehmet/Git/athas")).toBe(false);
  });
});
