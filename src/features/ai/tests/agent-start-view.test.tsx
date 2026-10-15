import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { AgentStartView } from "../components/agent-start-view";

describe("AgentStartView", () => {
  it("renders the start composition around its composer", () => {
    const markup = renderToStaticMarkup(
      <AgentStartView>
        <div data-slot="test-composer">Composer</div>
      </AgentStartView>,
    );

    expect(markup).toContain('data-slot="agent-start-view"');
    expect(markup).toContain('data-slot="test-composer"');
    expect(markup).toContain("Where should we begin?");
    expect(markup).not.toContain("<canvas");
    expect(markup).not.toContain("New file");
    expect(markup).not.toContain("Open file");
    expect(markup).not.toContain("New terminal");
  });
});
