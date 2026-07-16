import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { WorkbenchFullscreenSurface } from "../components/workbench-fullscreen-surface";

describe("WorkbenchFullscreenSurface", () => {
  it("fills the workbench between the shared title bar and footer", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchFullscreenSurface>Fullscreen content</WorkbenchFullscreenSurface>,
    );

    expect(markup).toContain('data-slot="workbench-fullscreen-surface"');
    expect(markup).toContain("top:var(--athas-title-bar-height)");
    expect(markup).toContain("bottom:var(--athas-footer-height)");
    expect(markup).toContain("inset-x-0");
    expect(markup).not.toContain("rounded");
    expect(markup).not.toContain("border");
    expect(markup).not.toContain("shadow");
  });
});
