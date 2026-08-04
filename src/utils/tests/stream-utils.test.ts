import { describe, expect, it } from "vite-plus/test";
import { processStreamingResponse } from "@/utils/stream-utils";

function streamResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    }),
  );
}

describe("processStreamingResponse", () => {
  it("extracts plain text chunks from v0 jsondiffpatch streams", async () => {
    const chunks: string[] = [];
    let completeCount = 0;
    const errors: string[] = [];

    await processStreamingResponse(
      streamResponse([
        'data: {"type":"connected"}\n\n',
        'data: {"delta":{"_t":"a","0":[[0,["Hello"]]]}}\n\n',
        'data: {"delta":{"_t":"a","0":{"_t":"a","1":{"_t":"a","0":["Hello","Hello world"]}}}}\n\n',
        'data: {"type":"done"}\n\n',
      ]),
      (chunk) => chunks.push(chunk),
      () => {
        completeCount += 1;
      },
      (error) => errors.push(error),
    );

    expect(chunks).toEqual(["Hello", " world"]);
    expect(completeCount).toBe(1);
    expect(errors).toEqual([]);
  });

  it("surfaces completed v0 chat metadata and completes the stream", async () => {
    const chunks: string[] = [];
    let completeCount = 0;

    await processStreamingResponse(
      streamResponse([
        'data: {"delta":{"_t":"a","0":[[0,["Creating your app..."]]]}}\n\n',
        [
          "data: ",
          JSON.stringify({
            object: "chat",
            webUrl: "https://v0.app/chat/abc",
            latestVersion: {
              status: "completed",
              demoUrl: "https://abc.v0.build",
              files: [{ name: "app/page.tsx" }, { name: "package.json" }],
            },
          }),
          "\n\n",
        ].join(""),
      ]),
      (chunk) => chunks.push(chunk),
      () => {
        completeCount += 1;
      },
      () => {},
    );

    expect(chunks).toEqual([
      "Creating your app...",
      [
        "\n\nv0 sandbox is ready.",
        "Chat: https://v0.app/chat/abc",
        "Preview: https://abc.v0.build",
        "Files: app/page.tsx, package.json",
      ].join("\n"),
    ]);
    expect(completeCount).toBe(1);
  });

  it("extracts visible task progress from v0 content parts", async () => {
    const chunks: string[] = [];

    await processStreamingResponse(
      streamResponse([
        [
          "data: ",
          JSON.stringify({
            delta: {
              _t: "a",
              "0": [
                [
                  0,
                  [
                    [
                      "AssistantMessageContentPart",
                      {
                        part: {
                          type: "task-coding-v1",
                          taskNameActive: "Creating files",
                          parts: [{ type: "search-repo", status: "reading" }],
                        },
                      },
                    ],
                  ],
                ],
              ],
            },
          }),
          "\n\n",
        ].join(""),
      ]),
      (chunk) => chunks.push(chunk),
      () => {},
      () => {},
    );

    expect(chunks).toEqual(["Creating files\nReading files"]);
  });

  it("surfaces OpenRouter errors delivered inside a successful SSE response", async () => {
    const chunks: string[] = [];
    const errors: string[] = [];
    let completeCount = 0;

    await processStreamingResponse(
      streamResponse([
        [
          "data: ",
          JSON.stringify({
            error: { code: 429, message: "Provider rate limit exceeded" },
            choices: [{ delta: { content: "" }, finish_reason: "error" }],
          }),
          "\n\n",
        ].join(""),
        "data: [DONE]\n\n",
      ]),
      (chunk) => chunks.push(chunk),
      () => {
        completeCount += 1;
      },
      (error) => errors.push(error),
    );

    expect(chunks).toEqual([]);
    expect(errors).toEqual([
      'Streaming API error: 429 Provider rate limit exceeded|||{"code":429,"message":"Provider rate limit exceeded"}',
    ]);
    expect(completeCount).toBe(0);
  });

  it("does not mistake OpenRouter chat completion chunks for v0 chat metadata", async () => {
    const chunks: string[] = [];

    await processStreamingResponse(
      streamResponse([
        `data: ${JSON.stringify({
          id: "gen-test",
          object: "chat.completion.chunk",
          model: "openai/gpt-5.4-mini",
          choices: [{ index: 0, delta: { content: "OpenRouter response" } }],
        })}\n\n`,
        "data: [DONE]\n\n",
      ]),
      (chunk) => chunks.push(chunk),
      () => {},
      () => {},
    );

    expect(chunks).toEqual(["OpenRouter response"]);
  });

  it("handles compact SSE events without a trailing newline", async () => {
    const chunks: string[] = [];
    let completeCount = 0;

    await processStreamingResponse(
      streamResponse(['data:{"choices":[{"delta":{"content":"Hello"}}]}']),
      (chunk) => chunks.push(chunk),
      () => {
        completeCount += 1;
      },
      () => {},
    );

    expect(chunks).toEqual(["Hello"]);
    expect(completeCount).toBe(1);
  });

  it("handles a buffered non-streaming JSON completion", async () => {
    const chunks: string[] = [];

    await processStreamingResponse(
      streamResponse(['{"choices":[{"message":{"content":"Buffered response"}}]}']),
      (chunk) => chunks.push(chunk),
      () => {},
      () => {},
    );

    expect(chunks).toEqual(["Buffered response"]);
  });

  it("joins multi-line SSE data fields and ignores keep-alive comments", async () => {
    const chunks: string[] = [];

    await processStreamingResponse(
      streamResponse([
        ": OPENROUTER PROCESSING\r\n\r\n",
        'event: message\r\ndata: {"choices":[{"delta":\r\ndata: {"content":"Hello"}}]}\r\n\r\n',
        "data: [DONE]\r\n\r\n",
      ]),
      (chunk) => chunks.push(chunk),
      () => {},
      () => {},
    );

    expect(chunks).toEqual(["Hello"]);
  });

  it("extracts text and refusal strings from structured OpenAI content", async () => {
    const chunks: string[] = [];

    await processStreamingResponse(
      streamResponse([
        [
          "data: ",
          JSON.stringify({
            choices: [
              {
                delta: {
                  content: [
                    { type: "text", text: "Structured " },
                    { type: "output_text", text: { value: "response" } },
                  ],
                },
              },
            ],
          }),
          "\n\n",
        ].join(""),
        `data: ${JSON.stringify({ choices: [{ delta: { refusal: "Cannot comply." } }] })}\n\n`,
        "data: [DONE]\n\n",
      ]),
      (chunk) => chunks.push(chunk),
      () => {},
      () => {},
    );

    expect(chunks).toEqual(["Structured response", "Cannot comply."]);
  });

  it("reports a token-limited reasoning-only response instead of completing empty", async () => {
    const errors: string[] = [];
    let completeCount = 0;

    await processStreamingResponse(
      streamResponse([
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                reasoning_details: [{ type: "reasoning.text", text: "Working" }],
              },
            },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({
          choices: [{ delta: { content: "" }, finish_reason: "length" }],
        })}\n\n`,
        "data: [DONE]\n\n",
      ]),
      () => {},
      () => {
        completeCount += 1;
      },
      (error) => errors.push(error),
    );

    expect(errors).toEqual([
      "The model reached its completion token limit before producing visible answer text.",
    ]);
    expect(completeCount).toBe(0);
  });

  it("parses a pretty-printed JSON response body", async () => {
    const chunks: string[] = [];

    await processStreamingResponse(
      streamResponse([
        "{\n",
        '  "choices": [{\n',
        '    "message": { "content": "Pretty response" }\n',
        "  }]\n",
        "}\n",
      ]),
      (chunk) => chunks.push(chunk),
      () => {},
      () => {},
    );

    expect(chunks).toEqual(["Pretty response"]);
  });
});
