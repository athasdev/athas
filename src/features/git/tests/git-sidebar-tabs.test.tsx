import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { SidebarTabBar, SidebarTabPanels } from "@/ui/sidebar";

type GitTab = "changes" | "history";

const gitTabs: Array<{ id: GitTab; label: string }> = [
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
];

function renderGitTabs(value: GitTab) {
  return renderToStaticMarkup(
    <SidebarTabBar items={gitTabs} value={value} onChange={() => {}}>
      <SidebarTabPanels
        items={[
          { id: "changes", content: <div>Uncommitted changes</div> },
          { id: "history", content: <div>Recent commits</div> },
        ]}
      />
    </SidebarTabBar>,
  );
}

describe("Git sidebar tabs", () => {
  it("renders only the selected panel", () => {
    const changesMarkup = renderGitTabs("changes");
    const historyMarkup = renderGitTabs("history");

    expect(changesMarkup).toContain("Uncommitted changes");
    expect(changesMarkup).not.toContain("Recent commits");
    expect(historyMarkup).toContain("Recent commits");
    expect(historyMarkup).not.toContain("Uncommitted changes");
  });
});
