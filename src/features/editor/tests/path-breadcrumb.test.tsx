import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { PathBreadcrumb } from "../components/toolbar/path-breadcrumb";

describe("PathBreadcrumb", () => {
  it("renders plain segments separated by chevrons", () => {
    const markup = renderToStaticMarkup(
      <PathBreadcrumb segments={["src", "features", "editor.tsx"]} />,
    );

    expect(markup.match(/data-slot="breadcrumb-segment"/g)).toHaveLength(3);
    expect(markup.match(/data-slot="breadcrumb-separator"/g)).toHaveLength(2);
    expect(markup).not.toContain("themed-file-icon");
  });
});
