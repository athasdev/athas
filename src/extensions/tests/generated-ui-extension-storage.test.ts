import { describe, expect, it } from "vite-plus/test";
import { normalizeGeneratedExtensionId } from "../ui/services/generated/generated-ui-extension-storage";

describe("generated UI extension storage", () => {
  it("normalizes generated extension ids into their isolated namespace", () => {
    expect(normalizeGeneratedExtensionId("  Project Dashboard / Preview  ")).toBe(
      "generated.project-dashboard-preview",
    );
    expect(normalizeGeneratedExtensionId("already.valid-id")).toBe("generated.already.valid-id");
  });
});
