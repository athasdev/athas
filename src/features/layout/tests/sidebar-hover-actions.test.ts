import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const fileExplorerSource = readFileSync(
  fileURLToPath(new URL("../../file-explorer/components/file-explorer-tree.tsx", import.meta.url)),
  "utf8",
);
const fileExplorerViewportSource = readFileSync(
  fileURLToPath(
    new URL("../../file-explorer/components/file-explorer-viewport.tsx", import.meta.url),
  ),
  "utf8",
);
const outlineSource = readFileSync(
  fileURLToPath(new URL("../../outline/components/outline-sidebar.tsx", import.meta.url)),
  "utf8",
);

describe("sidebar hover actions", () => {
  it("uses the shared hover header in file and outline sidebars", () => {
    expect(fileExplorerSource).toContain("<SidebarPanel");
    expect(fileExplorerSource).toMatch(/<SidebarHeader\s+variant="hover-actions"/);
    expect(outlineSource).toMatch(/<SidebarHeader\s+variant="hover-actions"/);
    expect(fileExplorerSource).not.toContain('className="justify-end"');
  });

  it("delegates tree padding and scrollbar gutter ownership", () => {
    expect(fileExplorerViewportSource).toContain("<SidebarTreeScrollArea");
    expect(fileExplorerViewportSource).toContain('contentPadding="inline"');
    expect(outlineSource).toContain("<SidebarTreeScrollArea");
    expect(fileExplorerViewportSource).not.toContain("scrollbar-gutter-both");
    expect(outlineSource).not.toContain("contentClassName");
  });
});
