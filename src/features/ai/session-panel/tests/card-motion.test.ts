import { describe, expect, it } from "vite-plus/test";
import { getFlipTransform, setCardOrigin, takeCardOrigin } from "../services/card-motion";

describe("card motion", () => {
  it("draws the card where its pill is on the first frame of the grow", () => {
    const pill = { left: 900, top: 60, width: 100, height: 28 };
    const card = { left: 600, top: 40, width: 400, height: 560 };
    expect(getFlipTransform(pill, card)).toBe("translate(300px, 20px) scale(0.25, 0.05)");
    expect(getFlipTransform(card, card)).toBe("translate(0px, 0px) scale(1, 1)");
  });

  it("hands the pill a card grows from to that session's card once", () => {
    setCardOrigin("a", { left: 1, top: 2, width: 3, height: 4 });
    expect(takeCardOrigin("b")).toBeNull();
    expect(takeCardOrigin("a")).toEqual({ left: 1, top: 2, width: 3, height: 4 });
    expect(takeCardOrigin("a")).toBeNull();
  });
});
