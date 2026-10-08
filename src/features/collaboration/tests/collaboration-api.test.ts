import { describe, expect, it } from "vite-plus/test";
import { __test__ } from "../services/collaboration-api";

describe("collaboration-api document stream parser", () => {
  it("parses collaboration document stream events", () => {
    const document = { id: 7, path: "README.md", baseVersion: 1, stateVector: {}, updatedAt: null };
    const update = {
      id: 9,
      documentId: 7,
      actorUserId: 1,
      clientId: "client-1",
      clientSeq: 1,
      serverVersion: 2,
      updateType: "cursor",
      operation: { cursor: { line: 1, column: 2 } },
      createdAt: null,
    };

    expect(
      __test__.parseCollaborationSseBlock(
        `event: ready\ndata: ${JSON.stringify({ document, afterServerVersion: 1 })}\n\n`,
      ),
    ).toEqual({
      type: "ready",
      document,
      afterServerVersion: 1,
      pollIntervalMs: 2000,
    });
    expect(
      __test__.parseCollaborationSseBlock(
        `event: update\ndata: ${JSON.stringify({ document, update })}\n\n`,
      ),
    ).toEqual({ type: "update", document, update });
    expect(
      __test__.parseCollaborationSseBlock(
        `event: heartbeat\ndata: ${JSON.stringify({ document, afterServerVersion: 2 })}\n\n`,
      ),
    ).toEqual({ type: "heartbeat", document, afterServerVersion: 2 });
    expect(
      __test__.parseCollaborationSseBlock(
        `event: error\ndata: ${JSON.stringify({ error: "Stream failed", status: 409 })}\n\n`,
      ),
    ).toEqual({ type: "error", error: "Stream failed", status: 409 });
  });

  it("ignores malformed collaboration document stream events", () => {
    expect(__test__.parseCollaborationSseBlock("event: update\ndata: {}\n\n")).toBeNull();
    expect(__test__.parseCollaborationSseBlock("event: ready\n\n")).toBeNull();
  });
});
