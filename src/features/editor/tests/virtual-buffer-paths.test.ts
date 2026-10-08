import { describe, expect, it } from "vitest";
import { getViewBufferPath } from "@/features/editor/services/virtual-buffer-paths";

describe("view buffer paths", () => {
  it("keeps setup tabs project-scoped", () => {
    expect(getViewBufferPath("/projects/athas")).toBe("view://create/%2Fprojects%2Fathas");
  });

  it("gives each saved view a stable tab path", () => {
    expect(getViewBufferPath("/projects/athas", "release-downloads")).toBe(
      "view://%2Fprojects%2Fathas/release-downloads",
    );
  });
});
