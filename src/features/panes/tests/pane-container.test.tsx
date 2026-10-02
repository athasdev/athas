import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { PaneContainer } from "../components/pane-container";
import { PaneSurfaceLayer } from "../components/pane-surface-layer";

describe("PaneContainer", () => {
  it("keeps a blank pane shell mounted when no tabs are open", () => {
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
    expect(markup).toMatch(/data-pane-id="empty-pane" class="[^"]*bg-background/);
    expect(markup).toContain('role="tablist"');
    expect(markup).not.toContain('role="tab"');
    expect(markup).not.toContain('data-slot="empty"');
    expect(markup).not.toContain("No tabs open");
  });

  it("stacks the active surface above warm editors so a hidden editor cannot flash over it", () => {
    const markup = renderToStaticMarkup(
      <div>
        <PaneSurfaceLayer active={false}>warm editor</PaneSurfaceLayer>
        <PaneSurfaceLayer active>agent chat</PaneSurfaceLayer>
      </div>,
    );
    const [hidden, active] = markup.match(/<div data-pane-surface-layer="[^"]*"[^>]*>/g) ?? [];

    expect(hidden).toContain('data-pane-surface-layer="hidden"');
    expect(hidden).toContain("inert");
    expect(hidden).toContain('aria-hidden="true"');
    expect(hidden).toMatch(/class="[^"]*\binvisible\b[^"]*\bz-0\b/);
    // The active surface is its own opaque layer on top, not in-flow content that a positioned
    // hidden editor would paint over.
    expect(active).toContain('data-pane-surface-layer="active"');
    expect(active).toMatch(/class="absolute inset-0 z-10 bg-background"/);
    expect(active).not.toContain("inert");
  });
});
