import { describe, expect, it } from "vite-plus/test";
import {
  extractFollowUpActions,
  getFollowUpActionsForMessage,
  normalizeMessageFollowUpActions,
} from "../lib/follow-up-actions";
import type { Message } from "../types/ai-chat.types";

function assistantMessage(overrides: Partial<Message>): Message {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    timestamp: new Date("2026-05-21T12:00:00Z"),
    ...overrides,
  };
}

describe("follow-up actions", () => {
  it("extracts generated actions and hides the metadata block", () => {
    const extracted = extractFollowUpActions(`Done.

[FOLLOW_UP_ACTIONS]
[
  {"label":"Deploy","prompt":"Deploy this change and verify it.","icon":"RocketLaunch"},
  {"label":"Review","prompt":"Review the diff.","icon":"ShieldCheck"}
]
[/FOLLOW_UP_ACTIONS]`);

    expect(extracted.content).toBe("Done.");
    expect(extracted.actions).toEqual([
      {
        id: "deploy-0",
        label: "Deploy",
        prompt: "Deploy this change and verify it.",
        icon: "RocketLaunch",
      },
      {
        id: "review-1",
        label: "Review",
        prompt: "Review the diff.",
        icon: "ShieldCheck",
      },
    ]);
  });

  it("strips an incomplete generated action block while streaming", () => {
    const extracted = extractFollowUpActions(`Done.

[FOLLOW_UP_ACTIONS]
[
`);

    expect(extracted.content).toBe("Done.");
    expect(extracted.actions).toEqual([]);
  });

  it("extracts compact action blocks emitted on one line", () => {
    const extracted = extractFollowUpActions(
      `Done. [FOLLOW_UP_ACTIONS] [ {"label":"Run tests","prompt":"Run the relevant tests and verify this change.","icon":"ShieldCheck"} ] [/FOLLOW_UP_ACTIONS]`,
    );

    expect(extracted.content).toBe("Done.");
    expect(extracted.actions).toEqual([
      {
        id: "run-tests-0",
        label: "Run tests",
        prompt: "Run the relevant tests and verify this change.",
        icon: "ShieldCheck",
      },
    ]);
  });

  it("falls back to the default package icon for unknown icon names", () => {
    const extracted = extractFollowUpActions(`Done.

[FOLLOW_UP_ACTIONS]
[{"label":"Next","prompt":"Continue.","icon":"MadeUpIcon"}]
[/FOLLOW_UP_ACTIONS]`);

    expect(extracted.actions[0]?.icon).toBe("ArrowRight");
  });

  it("normalizes assistant message content and stores extracted actions", () => {
    const normalized = normalizeMessageFollowUpActions(
      assistantMessage({
        content: `Done.

[FOLLOW_UP_ACTIONS]
[{"label":"Review","prompt":"Review the diff.","icon":"ShieldCheck"}]
[/FOLLOW_UP_ACTIONS]`,
      }),
    );

    expect(normalized.content).toBe("Done.");
    expect(normalized.followUpActions).toEqual([
      {
        id: "review-0",
        label: "Review",
        prompt: "Review the diff.",
        icon: "ShieldCheck",
      },
    ]);
  });

  it("does not show generated follow-ups while the assistant is streaming", () => {
    expect(
      getFollowUpActionsForMessage(
        assistantMessage({
          isStreaming: true,
          followUpActions: [
            {
              id: "deploy-0",
              label: "Deploy",
              prompt: "Deploy this change.",
              icon: "RocketLaunch",
            },
          ],
        }),
      ),
    ).toEqual([]);
  });
});
