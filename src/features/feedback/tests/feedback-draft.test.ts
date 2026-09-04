import { describe, expect, it } from "vitest";
import {
  aggregateFrictionSignals,
  buildFeedbackIssueBody,
  buildFeedbackIssueUrl,
} from "../lib/feedback-draft";

describe("feedback draft", () => {
  it("structures feedback around intent, actual behavior, and expectation", () => {
    const body = buildFeedbackIssueBody({
      intent: "Open a repository",
      actual: "The chooser closed",
      expected: "The repository opens",
    });

    expect(body).toContain("## Intent\n\nOpen a repository");
    expect(body).toContain("## What happened\n\nThe chooser closed");
    expect(body).toContain("## What I expected\n\nThe repository opens");
    expect(body).not.toContain("Sanitized environment");
  });

  it("includes only aggregated friction signal names in diagnostics", () => {
    const frictionSignals = aggregateFrictionSignals([
      {
        id: "1",
        timestamp: "2026-01-01T00:00:00.000Z",
        status: "local",
        eventType: "friction:agent:cancel",
        summary: "/private/project/secret.ts",
      },
      {
        id: "2",
        timestamp: "2026-01-01T00:00:01.000Z",
        status: "failed",
        eventType: "batch",
        summary: "Failed to send",
        error: "private error detail",
      },
    ]);

    const body = buildFeedbackIssueBody(
      { intent: "Steer an agent", actual: "It stopped", expected: "It continued" },
      { appVersion: "1.2.3", os: "macOS", frictionSignals },
    );

    expect(body).toContain("friction:agent:cancel: 1");
    expect(body).not.toContain("secret.ts");
    expect(body).not.toContain("private error detail");
  });

  it("creates a GitHub issue draft without a bug-template placeholder", () => {
    const url = new URL(
      buildFeedbackIssueUrl({
        intent: "Compare two files",
        actual: "The second file replaced the first",
        expected: "A split comparison",
      }),
    );

    expect(url.pathname).toBe("/athasdev/athas/issues/new");
    expect(url.searchParams.get("title")).toBe("Feedback: Compare two files");
    expect(url.searchParams.get("template")).toBeNull();
  });
});
