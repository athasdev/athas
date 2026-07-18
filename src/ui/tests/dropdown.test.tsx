import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { MenuItemsList } from "../dropdown";

describe("MenuItemsList", () => {
  it("supports compact icon-free presentation", () => {
    const markup = renderToStaticMarkup(
      <MenuItemsList
        density="compact"
        showIcons={false}
        items={[
          {
            id: "open",
            label: "Open",
            icon: <svg data-testid="decorative-icon" />,
            onClick: vi.fn(),
          },
        ]}
      />,
    );

    expect(markup).toContain("rounded-md");
    expect(markup).toContain("px-2");
    expect(markup).toContain("py-1");
    expect(markup).not.toContain("decorative-icon");
  });
});
