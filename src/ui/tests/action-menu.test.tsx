import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { ActionMenu } from "../action-menu";

describe("ActionMenu", () => {
  it("renders one accessible trigger for secondary actions", () => {
    const markup = renderToStaticMarkup(
      <ActionMenu
        label="Review actions"
        items={[{ id: "refresh", label: "Refresh", onClick: vi.fn() }]}
      />,
    );

    expect(markup).toContain('aria-label="Review actions"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
  });
});
