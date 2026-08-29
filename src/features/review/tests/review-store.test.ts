import { beforeEach, describe, expect, it } from "vitest";
import { useReviewStore } from "../stores/review.store";

describe("review store hunk sessions", () => {
  beforeEach(() => {
    useReviewStore.setState({ projects: {} });
  });

  it("persists summaries and idempotent hunk progress per checkpoint", () => {
    const actions = useReviewStore.getState().actions;

    actions.setHunkSummaries("/repo", "commit:abc", {
      first: {
        title: "Updates session checks",
        description: "Requires a valid session before continuing.",
      },
    });
    actions.markHunkReviewed("/repo", "commit:abc", "first");
    actions.markHunkReviewed("/repo", "commit:abc", "first");
    actions.completeHunkSession("/repo", "commit:abc");

    expect(useReviewStore.getState().projects["/repo"].hunkSessions?.["commit:abc"]).toMatchObject({
      reviewedHunkIds: ["first"],
      summaries: {
        first: {
          title: "Updates session checks",
          description: "Requires a valid session before continuing.",
        },
      },
      lastVisitedHunkId: "first",
    });
  });

  it("resets progress without discarding generated summaries", () => {
    const actions = useReviewStore.getState().actions;
    actions.setHunkSummaries("/repo", "working-tree:one", {
      first: {
        title: "Adds a footer action",
        description: "Introduces a direct action in the footer.",
      },
    });
    actions.markHunkReviewed("/repo", "working-tree:one", "first");
    actions.resetHunkSession("/repo", "working-tree:one");

    expect(
      useReviewStore.getState().projects["/repo"].hunkSessions?.["working-tree:one"],
    ).toMatchObject({
      reviewedHunkIds: [],
      summaries: {
        first: {
          title: "Adds a footer action",
          description: "Introduces a direct action in the footer.",
        },
      },
      lastVisitedHunkId: null,
      completedAt: null,
    });
  });

  it("caches generative insights and attention flags per hunk", () => {
    const actions = useReviewStore.getState().actions;
    actions.setHunkInsight("/repo", "commit:abc", "first", "risks", {
      kind: "risks",
      title: "Authorization risks",
      items: ["Verify inactive sessions remain blocked."],
    });
    actions.toggleHunkAttention("/repo", "commit:abc", "first");

    expect(useReviewStore.getState().projects["/repo"].hunkSessions?.["commit:abc"]).toMatchObject({
      attentionHunkIds: ["first"],
      insights: {
        first: {
          risks: {
            kind: "risks",
            title: "Authorization risks",
            items: ["Verify inactive sessions remain blocked."],
          },
        },
      },
    });
  });
});
