import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ViewDataDisplay } from "@/features/views/components/view-data-display";
import type { ViewPresentation, ViewTable } from "@/features/views/types/view.types";

const table: ViewTable = {
  columns: ["title", "status", "attempts", "created_at"],
  rows: [
    ["Build macOS", "completed", 3, "2026-08-27T10:00:00Z"],
    ["Build Linux", "queued", 1, "2026-08-27T11:00:00Z"],
  ],
};

function render(presentation: ViewPresentation) {
  return renderToStaticMarkup(<ViewDataDisplay table={table} presentation={presentation} />);
}

describe("view data display", () => {
  it("renders a structured table with semantic values", () => {
    const markup = render({ layout: "table", titleColumn: "title" });

    expect(markup).toContain("<table");
    expect(markup).toContain("Created At");
    expect(markup).toContain("bg-success/10 text-success");
    expect(markup).toContain("font-mono");
  });

  it("renders list cards grouped by a selected column", () => {
    const markup = render({ layout: "list", titleColumn: "title", groupBy: "status" });

    expect(markup).toContain("Build macOS");
    expect(markup).toContain("completed");
    expect(markup).toContain('data-slot="card"');
  });

  it("renders board columns and cards", () => {
    const markup = render({ layout: "board", titleColumn: "title", groupBy: "status" });

    expect(markup).toContain("min-w-64");
    expect(markup).toContain("Build Linux");
    expect(markup).toContain("queued");
  });
});
