import { describe, expect, it } from "vitest";
import { getResponsiveWorkbenchLayout } from "@/features/layout/hooks/use-responsive-workbench-layout";

describe("responsive workbench layout", () => {
  it("keeps secondary panes at desktop widths", () => {
    expect(getResponsiveWorkbenchLayout(1200)).toEqual({ narrow: false });
    expect(getResponsiveWorkbenchLayout(820)).toEqual({ narrow: false });
  });

  it("hides secondary panes on narrow windows", () => {
    expect(getResponsiveWorkbenchLayout(700)).toEqual({ narrow: true });
  });
});
