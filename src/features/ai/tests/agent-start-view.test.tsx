import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { AgentStartView } from "../components/agent-start-view";

describe("AgentStartView", () => {
  it("renders the shared start composition without new-tab actions by default", () => {
    const markup = renderToStaticMarkup(
      <AgentStartView>
        <div data-slot="test-composer">Composer</div>
      </AgentStartView>,
    );

    expect(markup).toContain('data-slot="agent-start-view"');
    expect(markup).toContain('data-slot="test-composer"');
    expect(markup).toContain("Where should we begin?");
    expect(markup).toContain("Try Continuous Agents");
    expect(markup).toContain('data-slot="continuous-agents-callout"');
    expect(markup).not.toContain("<canvas");
    expect(markup).not.toContain("New file");
    expect(markup).not.toContain("Open file");
    expect(markup).not.toContain("New terminal");
  });

  it("shows quick actions when the new-tab owner enables them", () => {
    const markup = renderToStaticMarkup(
      <AgentStartView showQuickActions>
        <div>Composer</div>
      </AgentStartView>,
    );

    expect(markup).toContain("New file");
    expect(markup).toContain("Open file");
    expect(markup).toContain("New terminal");
    expect(markup).not.toContain('data-slot="context-menu-trigger"');
  });
});
