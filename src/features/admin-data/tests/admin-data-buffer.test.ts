import { describe, expect, it } from "vitest";
import { getAdminDataBufferPath } from "@/features/admin-data/lib/admin-data-buffer";

describe("admin data buffer paths", () => {
  it("keeps setup tabs project-scoped", () => {
    expect(getAdminDataBufferPath("/projects/athas")).toBe(
      "admin-data://create/%2Fprojects%2Fathas",
    );
  });

  it("gives each saved source a stable tab path", () => {
    expect(getAdminDataBufferPath("/projects/athas", "release-downloads")).toBe(
      "admin-data://%2Fprojects%2Fathas/release-downloads",
    );
  });
});
