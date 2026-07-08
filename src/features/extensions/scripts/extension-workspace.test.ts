import { describe, expect, it } from "vite-plus/test";
import { getReservedBuiltInThemeContribution } from "./extension-workspace";

describe("extension workspace theme ownership", () => {
  it("reserves Athas default theme identities for built-in themes", () => {
    expect(
      getReservedBuiltInThemeContribution({
        id: "market-light",
        name: "Athas Light",
      }),
    ).toEqual({ id: "market-light", name: "athas light" });

    expect(
      getReservedBuiltInThemeContribution({
        id: "athas-dark",
        name: "Custom Dark",
      }),
    ).toEqual({ id: "athas-dark", name: "custom dark" });
  });

  it("allows non-Athas marketplace theme identities", () => {
    expect(
      getReservedBuiltInThemeContribution({
        id: "vercel-light",
        name: "Vercel Light",
      }),
    ).toBeNull();
  });
});
