import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/editor/services/editor-inline-edit-service", () => ({
  requestInlineEdit: vi.fn(),
}));

import {
  parseAdminDataSourcePlan,
  planKnownGitHubSource,
} from "@/features/admin-data/services/admin-data-intelligence";

describe("admin data intelligence", () => {
  it("configures release downloads without asking for a URL", () => {
    expect(planKnownGitHubSource("Show GitHub release download stats")).toMatchObject({
      kind: "github",
      name: "Release downloads",
      endpointPath: "/releases?per_page=100",
      rowsPath: "assets[]",
    });
  });

  it("accepts a constrained GitHub plan from Athas Intelligence", () => {
    expect(
      parseAdminDataSourcePlan(`Result:
{"kind":"github","name":"Latest runs","endpointPath":"/actions/runs?per_page=100","rowsPath":"workflow_runs"}`),
    ).toMatchObject({
      kind: "github",
      name: "Latest runs",
      endpointPath: "/actions/runs?per_page=100",
      rowsPath: "workflow_runs",
    });
  });

  it("rejects plans that require manual configuration", () => {
    expect(() =>
      parseAdminDataSourcePlan('{"kind":"manual","reason":"Use a custom JSON endpoint"}'),
    ).toThrow("Use a custom JSON endpoint");
  });
});
