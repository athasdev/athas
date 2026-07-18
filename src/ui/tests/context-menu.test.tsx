import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../context-menu";

describe("ContextMenu", () => {
  it("uses the compound trigger and content structure", () => {
    const markup = renderToStaticMarkup(
      <ContextMenu>
        <ContextMenuTrigger>Target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Open</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    expect(markup).toContain('data-slot="context-menu-trigger"');
    expect(markup).toContain("Target");
  });
});
