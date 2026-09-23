import { describe, expect, it } from "vite-plus/test";
import {
  type AcpElicitationRequest,
  toElicitationContent,
  toElicitationQuestions,
} from "../lib/acp-elicitation";

function form(entries: Array<[string, string]>) {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

// Shaped like claude-agent-acp's AskUserQuestion elicitation.
const claudeRequest: AcpElicitationRequest = {
  mode: "form",
  message: "Claude has questions",
  sessionId: "sess_1",
  toolCallId: "call_1",
  requestedSchema: {
    type: "object",
    properties: {
      question_0: {
        type: "string",
        title: "Which scope should the refactor cover?",
        oneOf: [
          { const: "Package", title: "Package", description: "Only this package" },
          { const: "Workspace", title: "Workspace" },
        ],
      },
      question_0_custom: {
        type: "string",
        title: "Other",
        _meta: { _askUserQuestionCustomAnswer: { questionId: "question_0", isCustomAnswer: true } },
      },
      question_1: {
        type: "array",
        title: "Which checks should run?",
        items: {
          anyOf: [
            { const: "tests", title: "Tests" },
            { const: "types", title: "Types" },
          ],
        },
      },
    },
    required: ["question_0"],
  },
};

describe("ACP elicitation forms", () => {
  it("turns each schema field into a step and folds paired custom answers in", () => {
    const questions = toElicitationQuestions(claudeRequest);

    expect(questions.map((question) => question.name)).toEqual(["question_0", "question_1"]);
    expect(questions[0]).toMatchObject({
      kind: "choice",
      multiple: false,
      required: true,
      otherField: "question_0_custom",
      options: [
        { value: "Package", label: "Package", description: "Only this package" },
        { value: "Workspace", label: "Workspace" },
      ],
    });
    expect(questions[1]).toMatchObject({ kind: "choice", multiple: true, required: false });
  });

  it("sends choices under the question and typed text under its custom field", () => {
    const questions = toElicitationQuestions(claudeRequest);

    expect(
      toElicitationContent(
        questions,
        form([
          ["question_0", "Package"],
          ["question_1", "tests"],
          ["question_1", "types"],
        ]),
      ),
    ).toEqual({ question_0: "Package", question_1: ["tests", "types"] });

    expect(toElicitationContent(questions, form([["question_0", "Only the ACP bridge"]]))).toEqual({
      question_0_custom: "Only the ACP bridge",
    });
  });

  it("maps booleans, integers, string formats and secrets", () => {
    const questions = toElicitationQuestions({
      mode: "form",
      message: "Codex needs your input to continue.",
      requestedSchema: {
        type: "object",
        properties: {
          force: { type: "boolean", title: "Force push?", default: false },
          retries: { type: "integer", minimum: 0, maximum: 5 },
          contact: { type: "string", format: "email" },
          token: { type: "string", _meta: { codex: { isSecret: true } } },
        },
        required: ["retries"],
      },
    });

    expect(questions.map((question) => question.kind)).toEqual([
      "choice",
      "number",
      "text",
      "text",
    ]);
    expect(questions[0]).toMatchObject({ defaults: ["false"] });
    expect(questions[1]).toMatchObject({ integer: true, minimum: 0, maximum: 5, required: true });
    expect(questions[2]).toMatchObject({ inputType: "email" });
    expect(questions[3]).toMatchObject({ inputType: "password" });

    expect(
      toElicitationContent(
        questions,
        form([
          ["force", "true"],
          ["retries", "3"],
          ["contact", "  "],
        ]),
      ),
    ).toEqual({ force: true, retries: 3 });
  });
});
