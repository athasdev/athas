import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { FileNavigatorItem } from "@/features/file-explorer/components/file-navigator-sidebar";
import {
  getMultibufferFileNavigationDirection,
  MultibufferFileStepper,
} from "../components/multibuffer/multibuffer-file-stepper";

const items: FileNavigatorItem[] = [
  { key: "src/first.ts", path: "src/first.ts" },
  { key: "src/second.ts", path: "src/second.ts" },
  { key: "src/third.ts", path: "src/third.ts" },
];

describe("MultibufferFileStepper", () => {
  it("maps J and K to unmodified file navigation shortcuts", () => {
    const event = {
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    };

    expect(getMultibufferFileNavigationDirection({ ...event, key: "j" })).toBe(-1);
    expect(getMultibufferFileNavigationDirection({ ...event, key: "k" })).toBe(1);
    expect(getMultibufferFileNavigationDirection({ ...event, key: "j", metaKey: true })).toBeNull();
  });

  it("stays hidden when there is only one changed file", () => {
    const markup = renderToStaticMarkup(
      <MultibufferFileStepper
        items={items.slice(0, 1)}
        selectedKey={items[0].key}
        onSelect={vi.fn()}
      />,
    );

    expect(markup).toBe("");
  });

  it("shows progress beside stable previous and next controls", () => {
    const markup = renderToStaticMarkup(
      <MultibufferFileStepper items={items} selectedKey={items[0].key} onSelect={vi.fn()} />,
    );

    expect(markup).toContain('data-slot="multibuffer-file-stepper"');
    expect(markup).toContain("File 1 of 3");
    expect(markup).toContain(">K</kbd>");
    expect(markup).toContain(">J</kbd>");
    expect(markup).toMatch(/aria-label="Previous file"[^>]*disabled/);
    expect(markup).not.toMatch(/aria-label="Next file"[^>]*disabled/);
  });

  it("enables both directions for a file in the middle", () => {
    const markup = renderToStaticMarkup(
      <MultibufferFileStepper items={items} selectedKey={items[1].key} onSelect={vi.fn()} />,
    );

    expect(markup).toContain("File 2 of 3");
    expect(markup).not.toMatch(/aria-label="Previous file"[^>]*disabled/);
    expect(markup).not.toMatch(/aria-label="Next file"[^>]*disabled/);
  });
});
