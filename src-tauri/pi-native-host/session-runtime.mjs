const BUILTIN_SLASH_COMMANDS = [
  { name: "settings", description: "Open settings menu" },
  { name: "model", description: "Select model (opens selector UI)" },
  { name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
  { name: "export", description: "Export session to HTML file" },
  { name: "share", description: "Share session as a secret GitHub gist" },
  { name: "copy", description: "Copy last agent message to clipboard" },
  { name: "name", description: "Set session display name" },
  { name: "session", description: "Show session info and stats" },
  { name: "changelog", description: "Show changelog entries" },
  { name: "hotkeys", description: "Show all keyboard shortcuts" },
  { name: "fork", description: "Create a new fork from a previous message" },
  { name: "tree", description: "Navigate session tree (switch branches)" },
  { name: "login", description: "Login with OAuth provider" },
  { name: "logout", description: "Logout from OAuth provider" },
  { name: "new", description: "Start a new session" },
  { name: "compact", description: "Manually compact the session context" },
  { name: "resume", description: "Resume a different session" },
  { name: "reload", description: "Reload extensions, skills, prompts, and themes" },
  { name: "quit", description: "Quit pi" },
];

const NATIVE_SESSION_MODES = [
  {
    id: "one-at-a-time",
    name: "One at a Time",
    description: "Deliver queued steering and follow-up messages one at a time.",
  },
  {
    id: "all",
    name: "All at Once",
    description: "Deliver queued steering and follow-up messages without waiting between them.",
  },
];

export const NATIVE_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

export function listSlashCommandsForSession(session) {
  const commands = [];
  const seenNames = new Set();
  const reservedBuiltins = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));

  for (const command of BUILTIN_SLASH_COMMANDS) {
    commands.push({
      name: command.name,
      description: command.description,
    });
    seenNames.add(command.name);
  }

  const extensionCommands =
    session?._extensionRunner?.getRegisteredCommandsWithPaths?.().filter(({ command }) => {
      return !reservedBuiltins.has(command.name);
    }) ?? [];

  for (const { command } of extensionCommands) {
    if (seenNames.has(command.name)) {
      continue;
    }
    commands.push({
      name: command.name,
      description: command.description,
    });
    seenNames.add(command.name);
  }

  for (const template of session?.promptTemplates ?? []) {
    if (seenNames.has(template.name)) {
      continue;
    }
    commands.push({
      name: template.name,
      description: template.description,
    });
    seenNames.add(template.name);
  }

  const skills = session?._resourceLoader?.getSkills?.().skills ?? [];
  for (const skill of skills) {
    const name = `skill:${skill.name}`;
    if (seenNames.has(name)) {
      continue;
    }
    commands.push({
      name,
      description: skill.description,
    });
    seenNames.add(name);
  }

  return commands;
}

export function getSessionModeState(session) {
  const currentModeId =
    session?.steeringMode === session?.followUpMode ? (session?.steeringMode ?? null) : null;

  return {
    currentModeId,
    availableModes: NATIVE_SESSION_MODES,
  };
}

export function setSessionMode(session, modeId) {
  if (!NATIVE_SESSION_MODES.some((mode) => mode.id === modeId)) {
    throw new Error(`Unsupported pi-native mode: ${modeId}`);
  }

  session.setSteeringMode(modeId);
  session.setFollowUpMode(modeId);
}

export function getAvailableModelsForSession(session) {
  return session.modelRegistry.getAvailable().map((model) => ({
    provider: model.provider,
    modelId: model.id,
    name: model.name,
    reasoning: Boolean(model.reasoning),
  }));
}

export function getAvailableThinkingLevels() {
  return [...NATIVE_THINKING_LEVELS];
}

export async function setSessionModel(session, selection) {
  const model = session.modelRegistry.find(selection.provider, selection.modelId);
  if (!model) {
    throw new Error(`Unknown pi-native model: ${selection.provider}/${selection.modelId}`);
  }

  await session.setModel(model);
}

export function setSessionThinkingLevel(session, level) {
  session.setThinkingLevel(level);
}
