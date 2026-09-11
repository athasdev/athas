import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { buttonVariants, type ButtonVariant } from "@/ui/button";

const source = readFileSync(new URL("../../../ui/button.tsx", import.meta.url), "utf8");

const FIXED_HEIGHT_VARIANTS: ButtonVariant[] = [
  "default",
  "accent",
  "accent-ghost",
  "ghost",
  "danger",
];

describe("Button geometry", () => {
  it("reserves the same border on every fixed-height variant", () => {
    // A variant that drops the border while a sibling keeps one makes the
    // control jump a pixel whenever a component swaps between them.
    for (const variant of FIXED_HEIGHT_VARIANTS) {
      expect(buttonVariants({ variant }), variant).not.toMatch(/(^|\s)border-0(\s|$)/);
    }

    expect(buttonVariants({})).toMatch(/(^|\s)border border-transparent(\s|$)/);
  });

  it("keeps state variants to paint-only properties", () => {
    const stateClasses = source.match(
      /(?:hover|focus|focus-visible|data-\[active=true\]|data-pressed):[^\s"]+/g,
    );

    expect(stateClasses?.length ?? 0).toBeGreaterThan(0);
    for (const className of stateClasses ?? []) {
      expect(className, className).not.toMatch(
        /:(?:border-[0-9]|p[xytblr]?-[0-9]|m[xytblr]?-[0-9]|h-[0-9]|w-[0-9]|gap-[0-9]|font-(?:medium|semibold|bold))/,
      );
    }
  });
});
