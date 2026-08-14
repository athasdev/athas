import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { FileNavigatorItem } from "@/features/file-explorer/components/file-navigator-sidebar";
import { ReviewWorkspace } from "../components/review-workspace";

const items: FileNavigatorItem[] = [
  { key: "src/first.ts", path: "src/first.ts" },
  { key: "src/second.ts", path: "src/second.ts" },
];

describe("ReviewWorkspace", () => {
  it("provides one content scroll owner with synchronized sidebar and stepper navigation", () => {
    const markup = renderToStaticMarkup(
      <ReviewWorkspace items={items} selectedKey={items[0].key} onSelect={vi.fn()}>
        Diff content
      </ReviewWorkspace>,
    );

    expect(markup).toContain("data-review-scroll-container");
    expect(markup).toContain('aria-label="Changed files"');
    expect(markup).toContain('data-slot="review-file-stepper"');
    expect(markup).toContain("File 1 of 2");
  });

  it("keeps step navigation when an owning sidebar supplies the file list", () => {
    const markup = renderToStaticMarkup(
      <ReviewWorkspace
        items={items}
        selectedKey={items[1].key}
        onSelect={vi.fn()}
        fileNavigation="external"
      >
        Diff content
      </ReviewWorkspace>,
    );

    expect(markup).not.toContain('aria-label="Changed files"');
    expect(markup).toContain('data-slot="review-file-stepper"');
    expect(markup).toContain("File 2 of 2");
  });

  it("omits redundant file navigation for a one-file review", () => {
    const markup = renderToStaticMarkup(
      <ReviewWorkspace items={items.slice(0, 1)} selectedKey={items[0].key} onSelect={vi.fn()}>
        Diff content
      </ReviewWorkspace>,
    );

    expect(markup).not.toContain('aria-label="Changed files"');
    expect(markup).not.toContain('data-slot="review-file-stepper"');
  });
});
