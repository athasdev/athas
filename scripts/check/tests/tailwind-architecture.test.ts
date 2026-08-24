import { describe, expect, it } from "vite-plus/test";
import { findTailwindArchitectureViolations } from "../tailwind-architecture";

describe("Tailwind architecture checks", () => {
  it("rejects legacy scrollbar classes and arbitrary gutter syntax", () => {
    const violations = findTailwindArchitectureViolations(
      "src/features/example/example.tsx",
      `<div className="custom-scrollbar-auto scrollbar-hidden [scrollbar-gutter:stable]" />`,
    );

    expect(violations).toEqual([
      expect.stringContaining("use the shared ScrollArea primitive"),
      expect.stringContaining("use the canonical scrollbar-none utility"),
      expect.stringContaining("use Tailwind's scrollbar-gutter-stable utility"),
    ]);
  });

  it("rejects raw utility syntax for registered design tokens", () => {
    const violations = findTailwindArchitectureViolations(
      "src/ui/example.tsx",
      `<div className="gap-(--athas-chrome-gap) rounded-(--athas-chrome-radius) duration-(--app-duration-fast)" />`,
    );

    expect(violations).toHaveLength(3);
    expect(
      violations.every((violation) => violation.includes("semantic Tailwind v4 theme utility")),
    ).toBe(true);
  });

  it("accepts shared primitives and canonical utilities", () => {
    const violations = findTailwindArchitectureViolations(
      "src/features/example/example.tsx",
      `<SidebarScrollArea className="gap-chrome rounded-chrome duration-fast scrollbar-thin" />`,
    );

    expect(violations).toEqual([]);
  });
});
