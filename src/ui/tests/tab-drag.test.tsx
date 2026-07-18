import { SortableContext } from "@dnd-kit/sortable";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { SortableTab, TabDndContext, TabDragPreview } from "../tab-drag";

describe("tab drag primitives", () => {
  it("uses one translation-only sortable wrapper without a second opacity fade", () => {
    const markup = renderToStaticMarkup(
      <TabDndContext>
        <SortableContext items={["file"]}>
          <SortableTab id="file">
            {({ isDragging }) => <span>{isDragging ? "dragging" : "settled"}</span>}
          </SortableTab>
        </SortableContext>
      </TabDndContext>,
    );

    expect(markup).toContain('data-slot="sortable-tab"');
    expect(markup).toContain('data-dragging="false"');
    expect(markup).toContain("will-change-transform");
    expect(markup).not.toContain("opacity-40");
    expect(markup).toContain("settled");
  });

  it("renders a shared borderless preview matching the connected tab surface", () => {
    const markup = renderToStaticMarkup(<TabDragPreview>File</TabDragPreview>);

    expect(markup).toContain('data-slot="tab-drag-preview"');
    expect(markup).toContain("bg-tab-active");
    expect(markup).toContain("shadow-[var(--shadow-drag)]");
    expect(markup).not.toContain("border");
  });

  it("lets vertical tab layouts fill their available width", () => {
    const markup = renderToStaticMarkup(
      <TabDndContext>
        <SortableContext items={["terminal"]}>
          <SortableTab id="terminal" orientation="vertical">
            {() => <span>Terminal</span>}
          </SortableTab>
        </SortableContext>
      </TabDndContext>,
    );

    expect(markup).toContain("w-full");
    expect(markup).not.toContain("shrink-0");
  });
});
