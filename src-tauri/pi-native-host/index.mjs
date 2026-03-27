import { createInterface } from "node:readline";
import { join } from "node:path";
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import { applyBootstrapHistory } from "./session-bootstrap.mjs";

const sessions = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResponse(id, result) {
  send({ type: "response", id, ok: true, result });
}

function sendError(id, error) {
  send({
    type: "response",
    id,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

function emitEvent(event) {
  send({ type: "event", event });
}

function encodeSessionDir(cwd) {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function getSessionDir(agentDir, cwd) {
  return join(agentDir, "sessions", encodeSessionDir(cwd));
}

function createStatus(record) {
  return {
    agentId: "pi",
    running: Boolean(record?.session.isStreaming),
    sessionActive: Boolean(record),
    initialized: Boolean(record),
    sessionId: record?.session.sessionId ?? null,
  };
}

function createRuntimeState(record) {
  const model = record?.session.model;
  return {
    agentId: "pi",
    source: "pi-native",
    sessionId: record?.session.sessionId ?? null,
    sessionPath: record?.session.sessionFile ?? null,
    workspacePath: record?.cwd ?? null,
    provider: model?.provider ?? null,
    modelId: model?.id ?? null,
    thinkingLevel: record?.session.thinkingLevel ?? null,
    behavior: null,
  };
}

function collectAssistantBlockText(message, type) {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) {
    return "";
  }

  if (type === "thinking") {
    return message.content
      .filter((block) => block.type === "thinking")
      .map((block) => block.thinking)
      .join("");
  }

  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function emitAssistantDelta(routeKey, record, message, isComplete) {
  const sessionId = record.session.sessionId;

  const currentText = collectAssistantBlockText(message, "text");
  const previousText = record.lastAssistantText;
  const nextText = currentText.startsWith(previousText)
    ? currentText.slice(previousText.length)
    : currentText;
  if (nextText) {
    emitEvent({
      type: "content_chunk",
      routeKey,
      sessionId,
      content: { type: "text", text: nextText },
      isComplete,
    });
    record.lastAssistantText = currentText;
  }

  const currentThinking = collectAssistantBlockText(message, "thinking");
  const previousThinking = record.lastAssistantThinking;
  const nextThinking = currentThinking.startsWith(previousThinking)
    ? currentThinking.slice(previousThinking.length)
    : currentThinking;
  if (nextThinking) {
    emitEvent({
      type: "thought_chunk",
      routeKey,
      sessionId,
      content: { type: "text", text: nextThinking },
      isComplete,
    });
    record.lastAssistantThinking = currentThinking;
  }
}

function mapStopReason(stopReason) {
  switch (stopReason) {
    case "length":
      return "max_tokens";
    case "aborted":
      return "cancelled";
    default:
      return "end_turn";
  }
}

function publishSessionState(routeKey, record) {
  emitEvent({
    type: "runtime_state_update",
    routeKey,
    sessionId: record?.session.sessionId ?? null,
    runtimeState: createRuntimeState(record),
  });
  emitEvent({
    type: "status_changed",
    routeKey,
    status: createStatus(record),
  });
}

function detachRoute(routeKey) {
  const record = sessions.get(routeKey);
  if (!record) {
    return;
  }

  record.unsubscribe?.();
  record.session.dispose();
  sessions.delete(routeKey);
}

function attachRoute(routeKey, record) {
  record.unsubscribe = record.session.subscribe((event) => {
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") {
          record.lastAssistantText = "";
          record.lastAssistantThinking = "";
        }
        break;
      case "message_update":
        if (event.message.role === "assistant") {
          emitAssistantDelta(routeKey, record, event.message, false);
        }
        break;
      case "message_end":
        if (event.message.role === "assistant") {
          emitAssistantDelta(routeKey, record, event.message, true);
          if (event.message.stopReason === "error" && event.message.errorMessage) {
            emitEvent({
              type: "error",
              routeKey,
              sessionId: record.session.sessionId,
              error: event.message.errorMessage,
            });
          }
        }
        break;
      case "tool_execution_start":
        emitEvent({
          type: "tool_start",
          routeKey,
          sessionId: record.session.sessionId,
          toolName: event.toolName,
          toolId: event.toolCallId,
          input: event.args,
        });
        break;
      case "tool_execution_end":
        emitEvent({
          type: "tool_complete",
          routeKey,
          sessionId: record.session.sessionId,
          toolId: event.toolCallId,
          success: !event.isError,
          output: event.result ?? null,
          locations: null,
        });
        break;
      case "agent_start":
      case "agent_end":
        publishSessionState(routeKey, record);
        break;
      default:
        break;
    }
  });
}

async function ensureRouteSession(routeKey, options = {}) {
  const existing = sessions.get(routeKey);
  const requestedPath = options.sessionPath ?? null;
  const requestedCwd = options.cwd ?? existing?.cwd ?? process.cwd();

  if (existing) {
    if (!requestedPath || existing.session.sessionFile === requestedPath) {
      return existing;
    }
    detachRoute(routeKey);
  }

  const sessionManager = SessionManager.create(
    requestedCwd,
    getSessionDir(options.agentDir, requestedCwd),
  );
  if (requestedPath) {
    sessionManager.setSessionFile(requestedPath);
  }

  const { session } = await createAgentSession({
    cwd: requestedCwd,
    agentDir: options.agentDir,
    sessionManager,
  });

  const record = {
    cwd: requestedCwd,
    session,
    unsubscribe: undefined,
    lastAssistantText: "",
    lastAssistantThinking: "",
  };

  if (
    Array.isArray(options.bootstrap?.conversationHistory) &&
    options.bootstrap.conversationHistory.length > 0
  ) {
    applyBootstrapHistory(session, options.bootstrap.conversationHistory);
  }

  attachRoute(routeKey, record);
  sessions.set(routeKey, record);
  publishSessionState(routeKey, record);
  return record;
}

async function handleRequest(id, method, params = {}) {
  switch (method) {
    case "startSession": {
      const record = await ensureRouteSession(params.routeKey, {
        cwd: params.workspacePath,
        agentDir: params.agentDir,
        sessionPath: params.sessionPath,
        bootstrap: params.bootstrap,
      });
      return sendResponse(id, createStatus(record));
    }
    case "sendPrompt": {
      const record = sessions.get(params.routeKey);
      if (!record) {
        throw new Error("No native Pi session is running for this route.");
      }

      record.lastAssistantText = "";
      record.lastAssistantThinking = "";
      publishSessionState(params.routeKey, record);

      try {
        await record.session.prompt(params.prompt);
      } catch (error) {
        emitEvent({
          type: "error",
          routeKey: params.routeKey,
          sessionId: record.session.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        publishSessionState(params.routeKey, record);
        return sendResponse(id, null);
      }

      const lastAssistant = [...record.session.messages]
        .reverse()
        .find((message) => message.role === "assistant");

      if (lastAssistant?.stopReason === "error" && lastAssistant.errorMessage) {
        emitEvent({
          type: "error",
          routeKey: params.routeKey,
          sessionId: record.session.sessionId,
          error: lastAssistant.errorMessage,
        });
      } else {
        emitEvent({
          type: "prompt_complete",
          routeKey: params.routeKey,
          sessionId: record.session.sessionId,
          stopReason: mapStopReason(lastAssistant?.stopReason),
        });
        emitEvent({
          type: "session_complete",
          routeKey: params.routeKey,
          sessionId: record.session.sessionId,
        });
      }

      publishSessionState(params.routeKey, record);
      return sendResponse(id, null);
    }
    case "getStatus": {
      return sendResponse(id, createStatus(sessions.get(params.routeKey)));
    }
    case "cancelPrompt": {
      const record = sessions.get(params.routeKey);
      if (record) {
        record.session.agent.abort();
      }
      return sendResponse(id, null);
    }
    case "stopSession": {
      detachRoute(params.routeKey);
      emitEvent({
        type: "status_changed",
        routeKey: params.routeKey,
        status: createStatus(null),
      });
      return sendResponse(id, createStatus(null));
    }
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", async (line) => {
  if (!line.trim()) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(line);
  } catch (error) {
    send({
      type: "event",
      event: {
        type: "error",
        routeKey: "panel",
        sessionId: null,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return;
  }

  try {
    await handleRequest(payload.id, payload.method, payload.params);
  } catch (error) {
    sendError(payload.id, error);
  }
});

rl.on("close", () => {
  for (const routeKey of sessions.keys()) {
    detachRoute(routeKey);
  }
  process.exit(0);
});
