import { describe, expect, it } from "vite-plus/test";
import {
  CHANNEL_FILTER_OPTIONS,
  matchesCollaborationSearchQuery,
  normalizeCollaborationSearchQuery,
  NOTE_FILTER_OPTIONS,
  PEOPLE_FILTER_OPTIONS,
} from "../lib/collaboration-sidebar-filters";

describe("collaboration sidebar filters", () => {
  it("normalizes search once for every sidebar section", () => {
    expect(normalizeCollaborationSearchQuery("  Mehmet Özgül ")).toBe("mehmet özgül");
    expect(matchesCollaborationSearchQuery("özg", [12, "Mehmet Özgül", false])).toBe(true);
    expect(matchesCollaborationSearchQuery("missing", [12, null, false])).toBe(false);
    expect(matchesCollaborationSearchQuery("", [])).toBe(true);
  });

  it("keeps each section's supported filters explicit", () => {
    expect(CHANNEL_FILTER_OPTIONS.map((option) => option.id)).toEqual([
      "all",
      "active",
      "with-guests",
      "empty",
    ]);
    expect(PEOPLE_FILTER_OPTIONS.map((option) => option.id)).toEqual([
      "all",
      "online",
      "offline",
      "sharing",
      "has-file",
    ]);
    expect(NOTE_FILTER_OPTIONS.map((option) => option.id)).toEqual(["notes", "secrets", "all"]);
  });
});
