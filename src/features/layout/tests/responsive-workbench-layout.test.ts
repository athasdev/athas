import { describe, expect, it } from "vitest";
import { getResponsiveWorkbenchLayout } from "@/features/layout/hooks/use-responsive-workbench-layout";

describe("responsive workbench layout", () => {
  it("keeps normal chrome at desktop widths", () => {
    expect(getResponsiveWorkbenchLayout(1200)).toEqual({ compact: false, narrow: false });
  });

  it("collapses the activity bar before hiding secondary panes", () => {
    expect(getResponsiveWorkbenchLayout(820)).toEqual({ compact: true, narrow: false });
    expect(getResponsiveWorkbenchLayout(700)).toEqual({ compact: true, narrow: true });
  });
});
