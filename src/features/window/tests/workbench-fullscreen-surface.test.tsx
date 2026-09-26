import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { WorkbenchFullscreenSurface } from "../components/workbench-fullscreen-surface";

describe("WorkbenchFullscreenSurface", () => {
  it("fills the window so its tabs share the title bar row", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchFullscreenSurface>Fullscreen content</WorkbenchFullscreenSurface>,
    );

    expect(markup).toContain('data-slot="workbench-fullscreen-surface"');
    expect(markup).toContain("top:0");
    expect(markup).toContain("bottom-0");
    expect(markup).toContain("inset-x-0");
    expect(markup).not.toContain("rounded");
    expect(markup).not.toContain("border");
    expect(markup).not.toContain("shadow");
  });
});
