import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewChangeCard } from "../components/review-change-card";
import type { ReviewChangeSet } from "../types/review.types";

const changeSet: ReviewChangeSet = {
  id: "working-tree",
  kind: "working-tree",
  title: "Working tree",
  author: "Agent",
  files: [{ path: "src/app.tsx", additions: 12, deletions: 3 }],
  additions: 12,
  deletions: 3,
  risk: "medium",
  riskReasons: ["Broad UI change"],
  categories: ["UI"],
  reviewed: false,
};

describe("review change card", () => {
  it("keeps review rows compact while preserving their primary actions", () => {
    const markup = renderToStaticMarkup(
      <ReviewChangeCard changeSet={changeSet} onOpen={() => {}} onMarkReviewed={() => {}} />,
    );

    expect(markup).toContain("Working tree");
    expect(markup).toContain("1 file · Agent");
    expect(markup).toContain("+12");
    expect(markup).toContain("-3");
    expect(markup).toContain('aria-label="Mark reviewed"');
    expect(markup).not.toContain("Open diff");
    expect(markup).not.toContain("src/app.tsx");
  });
});
