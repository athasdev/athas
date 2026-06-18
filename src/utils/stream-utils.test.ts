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
});
