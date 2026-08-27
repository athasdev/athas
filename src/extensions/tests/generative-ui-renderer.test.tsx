import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { GenerativeUIRenderer } from "../ui/components/generative-ui-renderer";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/features/window/hooks/use-pro-feature", () => ({
  useProFeature: () => ({ hasIntelligence: true }),
}));

describe("GenerativeUIRenderer", () => {
  it("renders canonical message UI through the embedded structured surface", () => {
    const markup = renderToStaticMarkup(
      <GenerativeUIRenderer
        component={{
          type: "screen",
          title: "Build health",
          children: [
            { type: "metric", label: "Passing", value: 18, tone: "success" },
            {
              type: "list",
              children: [{ type: "listItem", title: "Linux ARM64", description: "Ready" }],
            },
          ],
        }}
      />,
    );

    expect(markup).toContain('data-slot="extension-view-screen"');
    expect(markup).toContain("Build health");
    expect(markup).toContain("Passing");
    expect(markup).toContain("Linux ARM64");
    expect(markup).not.toContain('data-slot="scroll-area"');
  });

  it("keeps legacy message UI renderable through the compatibility adapter", () => {
    const markup = renderToStaticMarkup(
      <GenerativeUIRenderer
        component={{
          type: "card",
          props: { title: "Legacy preview", description: "Still supported" },
          children: [],
        }}
      />,
    );

    expect(markup).toContain("Legacy preview");
    expect(markup).toContain("Still supported");
  });

  it("renders activity and decision controls in structured AI results", () => {
    const markup = renderToStaticMarkup(
      <GenerativeUIRenderer
        component={{
          type: "stack",
          children: [
            {
              type: "activity",
              items: [
                { title: "Analyze workspace", state: "success", meta: "done" },
                { title: "Apply changes", state: "running", meta: "running" },
              ],
            },
            {
              type: "sparkline",
              label: "Files reviewed",
              values: [2, 5, 8, 13],
              detail: "13",
              tone: "accent",
            },
            {
              type: "choice",
              label: "Review depth",
              value: "focused",
              options: [
                { label: "Focused", value: "focused" },
                { label: "Full", value: "full" },
              ],
              onChange: { command: "athas.review.depth" },
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("Analyze workspace");
    expect(markup).toContain("Apply changes");
    expect(markup).toContain('data-slot="sparkline"');
    expect(markup).toContain("Files reviewed");
    expect(markup).toContain("Review depth");
    expect(markup).toContain('data-slot="toggle-group"');
  });

  it("shows a controlled error for invalid generated UI", () => {
    const markup = renderToStaticMarkup(
      <GenerativeUIRenderer component={{ type: "chart", values: [1, 2, 3] } as never} />,
    );

    expect(markup).toContain("Generated UI unavailable");
    expect(markup).toContain('role="alert"');
  });
});
