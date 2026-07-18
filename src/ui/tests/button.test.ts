import { describe, expect, it } from "vite-plus/test";
import { cn } from "@/utils/cn";
import { buttonVariants, type ButtonVariant } from "../button";

function classTokens(variant: ButtonVariant) {
  return new Set(buttonVariants({ variant }).split(/\s+/));
}

describe("button variants", () => {
  it.each<ButtonVariant>(["default", "ghost", "danger"])(
    "keeps the %s variant borderless",
    (variant) => {
      expect(classTokens(variant)).toContain("border-0");
      expect(classTokens(variant)).not.toContain("border");
    },
  );

  it("keeps the accent variant explicitly bordered", () => {
    expect(classTokens("accent")).toContain("border");
    expect(classTokens("accent")).not.toContain("border-0");
  });

  it("allows a consumer to request an explicit border", () => {
    const tokens = new Set(
      cn(buttonVariants({ variant: "default" }), "border border-error/40").split(/\s+/),
    );

    expect(tokens).toContain("border");
    expect(tokens).toContain("border-error/40");
    expect(tokens).not.toContain("border-0");
  });
});
