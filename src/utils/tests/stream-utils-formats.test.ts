import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { processStreamingResponse } from "@/utils/stream-utils";

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

async function collect(response: Response) {
  const chunks: string[] = [];
  const errors: string[] = [];
  let completed = 0;
  await processStreamingResponse(
    response,
    (chunk) => chunks.push(chunk),
    () => {
      completed += 1;
    },
    (error) => errors.push(error),
  );
  return { text: chunks.join(""), chunks, errors, completed };
}

const sse = (...events: unknown[]) =>
  streamResponse(
    events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`),
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stream transport", () => {
  it("reports a response without a body", async () => {
    const result = await collect(new Response(null));

    expect(result.errors).toEqual(["No response body reader available"]);
    expect(result.completed).toBe(0);
  });

  it("reports a stream that breaks while reading", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"a"}}]}\n'),
          );
          controller.error(new Error("socket closed"));
        },
      }),
    );

    const result = await collect(response);

    expect(result.errors).toEqual(["Error reading stream"]);
  });

  it("joins multi-line SSE data, ignores comments and handles CRLF", async () => {
    const result = await collect(
      streamResponse([
        ": keep-alive\r\n",
        'event: message\r\ndata: {"choices":[{"delta":\r\n',
        'data: {"content":"Hi"}}]}\r\n\r\n',
        "data: [DONE]\r\n\r\n",
        'data: {"choices":[{"delta":{"content":"late"}}]}\n\n',
      ]),
    );

    expect(result.text).toBe("Hi");
    expect(result.completed).toBe(1);
  });

  it("flushes a final SSE event without a trailing blank line", async () => {
    const result = await collect(
      streamResponse(['data: {"choices":[{"delta":{"content":"tail"}}]}']),
    );

    expect(result.text).toBe("tail");
    expect(result.completed).toBe(1);
  });

  it("fails on malformed SSE events", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await collect(sse("{not json", { choices: [{ delta: { content: "x" } }] }));

    expect(result.errors).toEqual(["The provider returned a malformed streaming event."]);
    expect(result.text).toBe("");
  });

  it("accepts plain JSON bodies split across chunks", async () => {
    const result = await collect(
      streamResponse(['{"choices":[{"message":', '{"content":"Whole answer"}}]}']),
    );

    expect(result.text).toBe("Whole answer");
    expect(result.completed).toBe(1);
  });

  it("accepts JSON arrays of events", async () => {
    const result = await collect(
      streamResponse([
        JSON.stringify([
          { candidates: [{ content: { parts: [{ text: "Gem" }, { text: "ini" }] } }] },
          "ignored",
          { type: "content_block_delta", delta: { type: "text_delta", text: "!" } },
        ]),
      ]),
    );

    expect(result.text).toBe("Gemini!");
  });

  it("fails on a truncated JSON body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await collect(streamResponse(['{"choices":[{"message":']));

    expect(result.errors).toEqual(["The provider returned a malformed JSON response."]);
  });
});

describe("provider payloads", () => {
  it("reads text from structured content, refusals and legacy text fields", async () => {
    const result = await collect(
      sse(
        {
          choices: [
            { delta: { content: [{ type: "text", text: "A" }, { text: { value: "B" } }] } },
          ],
        },
        { choices: [{ delta: { content: { content: "C" } } }] },
        { choices: [{ delta: { refusal: "D" } }] },
        { choices: [{ text: "E" }] },
        { choices: [{ delta: { content: 42 } }] },
      ),
    );

    expect(result.text).toBe("ABCDE");
  });

  it("reports API errors with their code and message", async () => {
    const result = await collect(
      sse(
        { error: { code: 429, message: " Rate limited " } },
        { choices: [{ delta: { content: "x" } }] },
      ),
    );

    expect(result.errors).toEqual([
      'Streaming API error: 429 Rate limited|||{"code":429,"message":" Rate limited "}',
    ]);
  });

  it("reports nested response and choice errors", async () => {
    const nested = await collect(sse({ response: { error: { message: "" } } }));
    expect(nested.errors[0]).toMatch(/^Streaming API error: unknown\|\|\|/);

    const choice = await collect(sse({ choices: [{ error: { code: "overloaded" } }] }));
    expect(choice.errors[0]).toMatch(/^Streaming API error: overloaded\|\|\|/);
  });

  it("fails when the provider ends with a generation error", async () => {
    const result = await collect(sse({ choices: [{ delta: {}, finish_reason: "error" }] }));

    expect(result.errors).toEqual([
      "The provider ended the stream with an unspecified generation error.",
    ]);
  });

  it("explains streams that end without visible text", async () => {
    const limit = await collect(
      sse({ choices: [{ delta: { content: " " }, finish_reason: "length" }] }),
    );
    expect(limit.errors).toEqual([
      "The model reached its completion token limit before producing visible answer text.",
    ]);

    const tools = await collect(sse({ choices: [{ delta: { tool_calls: [{ id: "call" }] } }] }));
    expect(tools.errors).toEqual([
      "The provider returned a tool call that Athas did not request or cannot execute.",
    ]);

    const reasoning = await collect(
      sse(
        { choices: [{ delta: { reasoning: "thinking..." } }] },
        { choices: [{ delta: { reasoning_details: { step: 1 } } }] },
      ),
    );
    expect(reasoning.errors).toEqual([
      "The model returned reasoning data but no visible answer text.",
    ]);

    const empty = await collect(sse({ choices: [{ delta: { reasoning: "  ", tool_calls: [] } }] }));
    expect(empty.errors).toEqual([]);
    expect(empty.completed).toBe(1);
  });
});

describe("v0 streams", () => {
  it("renders code blocks, task parts and removals from jsondiffpatch deltas", async () => {
    const result = await collect(
      sse(
        {
          delta: {
            _t: "a",
            0: [[0, ["Codeblock", { lang: "ts" }, "const a = 1;"]]],
            1: [[0, ["Codeblock", {}, "plain"]]],
            2: [[1, "not text"]],
          },
        },
        { delta: { _t: "a", _1: ["", 0, 0] } },
        {
          delta: {
            _t: "a",
            1: [
              [
                0,
                [
                  "AssistantMessageContentPart",
                  {
                    part: {
                      taskNameActive: "Researching",
                      parts: [
                        { type: "search-web", status: "searching", query: "athas" },
                        { type: "search-web", status: "analyzing", count: 4 },
                        { type: "search-repo", status: "searching", query: "store" },
                        { type: "search-repo", status: "reading" },
                        { type: "diagnostics", status: "checking" },
                        { type: "diagnostics", status: "complete", issues: 0 },
                        { type: "diagnostics", status: "complete", issues: 2 },
                        { thought: "Done thinking" },
                        "bad",
                      ],
                    },
                  },
                ],
              ],
            ],
          },
        },
        { type: "done" },
      ),
    );

    expect(result.errors).toEqual([]);
    expect(result.chunks[0]).toBe("```ts\nconst a = 1;\n```\n```\nplain\n```");
    expect(result.chunks[1]).toBe("```ts\nconst a = 1;\n```");
    expect(result.chunks[2]).toBe(
      `\n${[
        "Researching",
        'Searching "athas"',
        "Analyzing 4 results...",
        'Searching "store"',
        "Reading files",
        "Checking for issues...",
        "No issues found",
        "Done thinking",
      ].join("\n")}`,
    );
  });

  it("reads plain object parts and nested element children", async () => {
    const result = await collect(
      sse(
        {
          delta: [
            [
              [0, ["AssistantMessageContentPart", { part: { answer: "Answer" } }]],
              [0, ["div", { className: "x" }, ["text", {}, "Nested"], ["b", {}, " bold"]]],
              [0, [{ title: "Title" }, { taskNameComplete: "Built app", parts: [] }]],
              [0, { query: "q" }],
              [0, ["Codeblock", null, "x"]],
            ],
          ],
        },
        { type: "done" },
      ),
    );

    expect(result.text.split("\n")).toEqual([
      "Answer",
      "Nested bold",
      "TitleBuilt app",
      "q",
      "```",
      "x",
      "```",
    ]);
  });

  it("starts over when a delta replaces the message list with an object", async () => {
    const result = await collect(
      sse(
        {
          delta: [
            [
              [0, "first"],
              [0, "second"],
            ],
          ],
        },
        { delta: { title: ["Draft"], removed: ["old", 0, 0] } },
        { delta: [[[0, "third"]]] },
        { type: "done" },
      ),
    );

    expect(result.errors).toEqual([]);
    expect(result.chunks).toEqual(["first\nsecond", "third"]);
  });

  it("summarizes chat events and completes on terminal status", async () => {
    const result = await collect(
      sse(
        { object: "chat", webUrl: "https://v0.dev/chat/1" },
        { object: "chat", webUrl: "https://v0.dev/chat/1" },
        {
          object: "chat",
          latestVersion: {
            status: "completed",
            demoUrl: "https://demo.vusercontent.net",
            files: [{ name: "app.tsx" }, { name: " " }, {}],
          },
        },
        { choices: [{ delta: { content: "after" } }] },
      ),
    );

    expect(result.chunks).toEqual([
      "v0 sandbox was created.\nChat: https://v0.dev/chat/1",
      "v0 sandbox is ready.\nPreview: https://demo.vusercontent.net\nFiles: app.tsx",
    ]);
    expect(result.completed).toBe(1);
  });

  it("reports a failed v0 generation and separates it from earlier text", async () => {
    const result = await collect(
      sse({ delta: [[[0, "Working"]]] }, { object: "chat", latestVersion: { status: "failed" } }),
    );

    expect(result.chunks).toEqual(["Working", "\n\nv0 sandbox generation failed."]);
    expect(result.completed).toBe(1);
  });
});
