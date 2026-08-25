import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { PaneContainer } from "../components/pane-container";

describe("PaneContainer", () => {
  it("keeps the pane shell mounted when no tabs are open", () => {
    const markup = renderToStaticMarkup(
      <PaneContainer
        pane={{
          id: "empty-pane",
          type: "group",
          bufferIds: [],
          activeBufferId: null,
        }}
      />,
    );

    expect(markup).toContain('data-pane-id="empty-pane"');
    expect(markup).toContain('role="tablist"');
    expect(markup).not.toContain('role="tab"');
    expect(markup).toContain('data-slot="empty"');
    expect(markup).toContain("No tabs open");
  });
});
