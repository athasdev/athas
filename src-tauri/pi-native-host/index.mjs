import { createInterface } from "node:readline";
import { join } from "node:path";
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import { createExtensionUiBridge } from "./extension-ui.mjs";
import { applyBootstrapHistory } from "./session-bootstrap.mjs";
import { listSessionsForWorkspace, resolveSessionPathForStart } from "./session-listing.mjs";
import {
  clearPiAuthCredential,
  getPiSettingsSnapshot,
  installPiPackage,
  loginPiProvider,
  logoutPiProvider,
  removePiPackage,
  setPiApiKeyCredential,
  setPiScopedDefaults,
} from "./pi-settings.mjs";
import {
  getAvailableModelsForSession,
  getAvailableThinkingLevels,
  getSessionModeState,
  listSlashCommandsForSession,
  reloadSessionResources,
  setSessionMode,
  setSessionModel,
  setSessionThinkingLevel,
} from "./session-runtime.mjs";
import { loadSessionTranscript } from "./session-transcript.mjs";

const sessions = new Map();
const pendingSettingsPrompts = new Map();
let nextSettingsPromptId = 1;

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

function emitSettingsEvent(event) {
  send({ type: "settings_event", event });
}

function encodeSessionDir(cwd) {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function getSessionDir(agentDir, cwd) {
  return join(agentDir, "sessions", encodeSessionDir(cwd));
}

function resolveWorkspacePath(workspacePath) {
  return typeof workspacePath === "string" && workspacePath.length > 0 ? workspacePath : null;
}

function createSettingsContext(params = {}) {
  return {
    cwd: resolveWorkspacePath(params.workspacePath),
    agentDir: params.agentDir,
  };
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

function createSessionSnapshot(record) {
  return {
    runtimeState: createRuntimeState(record),
    slashCommands: listSlashCommandsForSession(record.session),
    sessionModeState: getSessionModeState(record.session),
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
  if (record?.session.sessionId) {
    emitEvent({
      type: "slash_commands_update",
      routeKey,
      sessionId: record.session.sessionId,
      commands: listSlashCommandsForSession(record.session),
    });
    emitEvent({
      type: "session_mode_update",
      routeKey,
      sessionId: record.session.sessionId,
      modeState: getSessionModeState(record.session),
    });
  }
}

function detachRoute(routeKey) {
  const record = sessions.get(routeKey);
  if (!record) {
    return;
  }

  record.unsubscribe?.();
  record.uiBridge?.clear();
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
  const availableSessions = await listSessionsForWorkspace(
    requestedCwd,
    getSessionDir(options.agentDir, requestedCwd),
  );
  const sessionPath = resolveSessionPathForStart({
    requestedPath,
    bootstrapConversationHistory: options.bootstrap?.conversationHistory ?? [],
    sessions: availableSessions,
  });

  if (existing) {
    if (!sessionPath || existing.session.sessionFile === sessionPath) {
      publishSessionState(routeKey, existing);
      return existing;
    }
    detachRoute(routeKey);
  }

  const sessionManager = SessionManager.create(
    requestedCwd,
    getSessionDir(options.agentDir, requestedCwd),
  );
  if (sessionPath) {
    sessionManager.setSessionFile(sessionPath);
  }

  const { session } = await createAgentSession({
    cwd: requestedCwd,
    agentDir: options.agentDir,
    sessionManager,
  });

  const uiBridge = createExtensionUiBridge({
    routeKey,
    emitEvent,
  });
  await session.bindExtensions({ uiContext: uiBridge.uiContext });

  const record = {
    cwd: requestedCwd,
    session,
    uiBridge,
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

function requestSettingsPrompt({ providerId, kind, message, placeholder, allowEmpty }) {
  const requestId = `pi-auth-${nextSettingsPromptId++}`;

  return new Promise((resolve, reject) => {
    pendingSettingsPrompts.set(requestId, { resolve, reject });
    emitSettingsEvent({
      type: "auth_prompt",
      providerId,
      requestId,
      kind,
      message,
      placeholder,
      allowEmpty: Boolean(allowEmpty),
    });
  });
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
    case "listSessions": {
      const cwd = params.workspacePath ?? process.cwd();
      const sessions = await listSessionsForWorkspace(cwd, getSessionDir(params.agentDir, cwd));
      return sendResponse(id, sessions);
    }
    case "listCommands": {
      const record = await ensureRouteSession(params.routeKey, {
        cwd: params.workspacePath,
        agentDir: params.agentDir,
        sessionPath: params.sessionPath,
      });
      return sendResponse(id, listSlashCommandsForSession(record.session));
    }
    case "listModels": {
      const record = await ensureRouteSession(params.routeKey, {
        cwd: params.workspacePath,
        agentDir: params.agentDir,
        sessionPath: params.sessionPath,
      });
      return sendResponse(id, getAvailableModelsForSession(record.session));
    }
    case "listThinkingLevels": {
      await ensureRouteSession(params.routeKey, {
        cwd: params.workspacePath,
        agentDir: params.agentDir,
        sessionPath: params.sessionPath,
      });
      return sendResponse(id, getAvailableThinkingLevels());
    }
    case "getSessionSnapshot": {
      const record = await ensureRouteSession(params.routeKey, {
        cwd: params.workspacePath,
        agentDir: params.agentDir,
        sessionPath: params.sessionPath,
      });
      return sendResponse(id, createSessionSnapshot(record));
    }
    case "reloadSessionResources": {
      const record = await ensureRouteSession(params.routeKey, {
        cwd: params.workspacePath,
        agentDir: params.agentDir,
        sessionPath: params.sessionPath,
      });

      await reloadSessionResources(record.session);
      publishSessionState(params.routeKey, record);
      return sendResponse(id, createSessionSnapshot(record));
    }
    case "getSettingsSnapshot": {
      return sendResponse(id, await getPiSettingsSnapshot(createSettingsContext(params)));
    }
    case "setDefaults": {
      return sendResponse(
        id,
        await setPiScopedDefaults({
          ...createSettingsContext(params),
          scope: params.scope,
          defaultProvider: params.defaultProvider,
          defaultModel: params.defaultModel,
          defaultThinkingLevel: params.defaultThinkingLevel,
        }),
      );
    }
    case "setApiKeyCredential": {
      await setPiApiKeyCredential({
        agentDir: params.agentDir,
        providerId: params.providerId,
        key: params.key,
      });
      return sendResponse(id, await getPiSettingsSnapshot(createSettingsContext(params)));
    }
    case "clearAuthCredential": {
      await clearPiAuthCredential({
        agentDir: params.agentDir,
        providerId: params.providerId,
      });
      return sendResponse(id, await getPiSettingsSnapshot(createSettingsContext(params)));
    }
    case "logoutProvider": {
      await logoutPiProvider({
        agentDir: params.agentDir,
        providerId: params.providerId,
      });
      return sendResponse(id, await getPiSettingsSnapshot(createSettingsContext(params)));
    }
    case "loginProvider": {
      emitSettingsEvent({
        type: "auth_start",
        providerId: params.providerId,
      });
      try {
        await loginPiProvider({
          agentDir: params.agentDir,
          providerId: params.providerId,
          onAuth(info) {
            emitSettingsEvent({
              type: "auth_open_url",
              providerId: params.providerId,
              url: info.url,
              instructions: info.instructions ?? null,
            });
          },
          onProgress(message) {
            emitSettingsEvent({
              type: "auth_progress",
              providerId: params.providerId,
              message,
            });
          },
          requestPrompt(prompt) {
            return requestSettingsPrompt({
              providerId: params.providerId,
              ...prompt,
            });
          },
        });
      } catch (error) {
        emitSettingsEvent({
          type: "auth_error",
          providerId: params.providerId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      emitSettingsEvent({
        type: "auth_complete",
        providerId: params.providerId,
      });
      return sendResponse(id, await getPiSettingsSnapshot(createSettingsContext(params)));
    }
    case "respondAuthPrompt": {
      const pending = pendingSettingsPrompts.get(params.requestId);
      if (!pending) {
        throw new Error(`Unknown native Pi auth prompt: ${params.requestId}`);
      }

      pendingSettingsPrompts.delete(params.requestId);
      if (params.cancelled) {
        pending.reject(new Error("Pi auth prompt cancelled"));
      } else {
        pending.resolve(typeof params.value === "string" ? params.value : "");
      }
      return sendResponse(id, null);
    }
    case "installPackage": {
      return sendResponse(
        id,
        await installPiPackage({
          ...createSettingsContext(params),
          scope: params.scope,
          source: params.source,
        }),
      );
    }
    case "removePackage": {
      return sendResponse(
        id,
        await removePiPackage({
          ...createSettingsContext(params),
          scope: params.scope,
          source: params.source,
        }),
      );
    }
    case "getSessionTranscript": {
      return sendResponse(id, await loadSessionTranscript(params.sessionPath));
    }
    case "changeMode": {
      const record = await ensureRouteSession(params.routeKey, {
        cwd: params.workspacePath,
        agentDir: params.agentDir,
        sessionPath: params.sessionPath,
      });

      setSessionMode(record.session, params.modeId);
      publishSessionState(params.routeKey, record);
      return sendResponse(id, getSessionModeState(record.session));
    }
    case "setModel": {
      const record = await ensureRouteSession(params.routeKey, {
        cwd: params.workspacePath,
        agentDir: params.agentDir,
        sessionPath: params.sessionPath,
      });

      await setSessionModel(record.session, {
        provider: params.provider,
        modelId: params.modelId,
      });
      publishSessionState(params.routeKey, record);
      return sendResponse(id, createRuntimeState(record));
    }
    case "setThinkingLevel": {
      const record = await ensureRouteSession(params.routeKey, {
        cwd: params.workspacePath,
        agentDir: params.agentDir,
        sessionPath: params.sessionPath,
      });

      setSessionThinkingLevel(record.session, params.level);
      publishSessionState(params.routeKey, record);
      return sendResponse(id, createRuntimeState(record));
    }
    case "cancelPrompt": {
      const record = sessions.get(params.routeKey);
      if (record) {
        record.session.agent.abort();
      }
      return sendResponse(id, null);
    }
    case "respondPermission": {
      const record = sessions.get(params.routeKey);
      if (!record) {
        throw new Error("No native Pi session is running for this route.");
      }

      const handled = record.uiBridge.respond(params.requestId, {
        approved: Boolean(params.approved),
        cancelled: Boolean(params.cancelled),
        value: typeof params.value === "string" ? params.value : null,
      });

      if (!handled) {
        throw new Error(`Unknown native Pi permission request: ${params.requestId}`);
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
  for (const pending of pendingSettingsPrompts.values()) {
    pending.reject(new Error("Pi native host closed"));
  }
  pendingSettingsPrompts.clear();
  for (const routeKey of sessions.keys()) {
    detachRoute(routeKey);
  }
  process.exit(0);
});
