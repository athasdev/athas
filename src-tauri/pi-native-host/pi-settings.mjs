import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import {
  AuthStorage,
  DefaultPackageManager,
  ModelRegistry,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { getEnvApiKey, getProviders } from "@mariozechner/pi-ai";

const PI_CONFIG_DIR_NAME = ".pi";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];
const API_KEY_PROVIDER_IDS = new Set([
  "anthropic",
  "azure-openai-responses",
  "openai",
  "google",
  "mistral",
  "groq",
  "cerebras",
  "xai",
  "openrouter",
  "vercel-ai-gateway",
  "zai",
  "opencode",
  "huggingface",
  "kimi-coding",
  "minimax",
  "minimax-cn",
]);

function humanizeProviderId(providerId) {
  return providerId
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function normalizeScope(scope) {
  return scope === "project" ? "project" : "global";
}

function getProjectSettingsPath(cwd) {
  return join(cwd, PI_CONFIG_DIR_NAME, "settings.json");
}

function getPiPaths(cwd, agentDir) {
  return {
    agentDir,
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    globalSettingsPath: join(agentDir, "settings.json"),
    projectSettingsPath: cwd ? getProjectSettingsPath(cwd) : null,
  };
}

function readJsonFile(path) {
  if (!path || !existsSync(path)) {
    return {};
  }

  const content = readFileSync(path, "utf8").trim();
  if (!content) {
    return {};
  }

  return JSON.parse(content);
}

function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function syncLegacyDefaultAliases(settings) {
  const next = structuredClone(settings);

  if ("defaultProvider" in next) {
    if (next.defaultProvider == null) {
      delete next.default_provider;
    } else {
      next.default_provider = next.defaultProvider;
    }
  }

  if ("defaultModel" in next) {
    if (next.defaultModel == null) {
      delete next.default_model;
    } else {
      next.default_model = next.defaultModel;
    }
  }

  if ("defaultThinkingLevel" in next) {
    if (next.defaultThinkingLevel == null) {
      delete next.default_thinking_level;
    } else {
      next.default_thinking_level = next.defaultThinkingLevel;
    }
  }

  return next;
}

function writeScopedSettingsFile({ cwd, agentDir, scope, updater }) {
  const targetScope = normalizeScope(scope);
  const path = targetScope === "project" ? getProjectSettingsPath(cwd) : join(agentDir, "settings.json");
  const current = readJsonFile(path);
  const next = syncLegacyDefaultAliases(updater(structuredClone(current)));
  writeJsonFile(path, next);
  return next;
}

function getSettingsManager(cwd, agentDir) {
  return SettingsManager.create(cwd ?? process.cwd(), agentDir);
}

function getAuthStorage(agentDir) {
  return AuthStorage.create(join(agentDir, "auth.json"));
}

function getModelRegistry(agentDir) {
  const authStorage = getAuthStorage(agentDir);
  return new ModelRegistry(authStorage, join(agentDir, "models.json"));
}

function createPackageManager(cwd, agentDir, settingsManager) {
  return new DefaultPackageManager({
    cwd: cwd ?? process.cwd(),
    agentDir,
    settingsManager,
  });
}

function summarizeCredential(credential) {
  if (!credential) {
    return null;
  }

  if (credential.type === "oauth") {
    return {
      type: "oauth",
      expiresAt: typeof credential.expires === "number" ? new Date(credential.expires).toISOString() : null,
    };
  }

  return {
    type: "api_key",
    keyMode:
      typeof credential.key === "string" && credential.key.startsWith("!")
        ? "command"
        : typeof credential.key === "string" && /^[A-Z0-9_]+$/.test(credential.key)
          ? "environment"
          : "literal",
  };
}

function createProviderState(providerId, modelRegistry) {
  const authStorage = modelRegistry.authStorage;
  const oauthProvider = authStorage.getOAuthProviders().find((provider) => provider.id === providerId) ?? null;
  const storedCredential = authStorage.get(providerId);
  const envCredential = getEnvApiKey(providerId);
  const allModels = modelRegistry
    .getAll()
    .filter((model) => model.provider === providerId)
    .map((model) => ({
      provider: model.provider,
      modelId: model.id,
      name: model.name,
      reasoning: Boolean(model.reasoning),
      available: Boolean(modelRegistry.find(model.provider, model.id)),
      configured: Boolean(modelRegistry.getAvailable().find((candidate) => {
        return candidate.provider === model.provider && candidate.id === model.id;
      })),
    }));

  return {
    id: providerId,
    name: oauthProvider?.name ?? humanizeProviderId(providerId),
    supportsOAuth: Boolean(oauthProvider),
    supportsApiKey: API_KEY_PROVIDER_IDS.has(providerId),
    hasEnvironmentAuth: Boolean(envCredential),
    hasStoredAuth: Boolean(storedCredential),
    storedCredential: summarizeCredential(storedCredential),
    authStatus: storedCredential
      ? storedCredential.type
      : envCredential
        ? "environment"
        : "missing",
    modelCount: allModels.length,
    models: allModels,
  };
}

function collectProviderStates(modelRegistry) {
  const authStorage = modelRegistry.authStorage;
  const providerIds = new Set([
    ...getProviders(),
    ...modelRegistry.getAll().map((model) => model.provider),
    ...authStorage.list(),
    ...authStorage.getOAuthProviders().map((provider) => provider.id),
  ]);

  return [...providerIds]
    .sort((left, right) => left.localeCompare(right))
    .map((providerId) => createProviderState(providerId, modelRegistry));
}

function serializePackageSource(source) {
  if (typeof source === "string") {
    return {
      source,
      filters: null,
    };
  }

  return {
    source: source.source,
    filters: {
      extensions: source.extensions ?? null,
      skills: source.skills ?? null,
      prompts: source.prompts ?? null,
      themes: source.themes ?? null,
    },
  };
}

function collectPackageEntries(settingsManager, packageManager) {
  const globalPackages = settingsManager.getGlobalSettings().packages ?? [];
  const projectPackages = settingsManager.getProjectSettings().packages ?? [];

  const serialize = (entry, scope) => {
    const serialized = serializePackageSource(entry);
    return {
      ...serialized,
      scope,
      installedPath:
        typeof serialized.source === "string"
          ? packageManager.getInstalledPath(serialized.source, scope === "global" ? "user" : "project") ?? null
          : null,
    };
  };

  return {
    global: globalPackages.map((entry) => serialize(entry, "global")),
    project: projectPackages.map((entry) => serialize(entry, "project")),
  };
}

function deriveResourceName(path) {
  const fileName = basename(path);
  const extension = extname(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

function collectResolvedResources(resolvedPaths) {
  const result = [];

  for (const [kind, entries] of Object.entries(resolvedPaths)) {
    for (const entry of entries) {
      result.push({
        id: `${kind}:${entry.path}`,
        kind,
        name: deriveResourceName(entry.path),
        path: entry.path,
        enabled: entry.enabled,
        source: entry.metadata.source,
        origin: entry.metadata.origin,
        scope: entry.metadata.scope,
        baseDir: entry.metadata.baseDir ?? null,
      });
    }
  }

  return result.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    if (left.scope !== right.scope) {
      return left.scope.localeCompare(right.scope);
    }
    return left.name.localeCompare(right.name);
  });
}

function getEffectiveDefaults(settingsManager) {
  return {
    defaultProvider: settingsManager.getDefaultProvider() ?? null,
    defaultModel: settingsManager.getDefaultModel() ?? null,
    defaultThinkingLevel: settingsManager.getDefaultThinkingLevel() ?? null,
  };
}

function getScopeDefaults(settingsManager, scope) {
  const source =
    normalizeScope(scope) === "project"
      ? settingsManager.getProjectSettings()
      : settingsManager.getGlobalSettings();

  return {
    defaultProvider: source.defaultProvider ?? null,
    defaultModel: source.defaultModel ?? null,
    defaultThinkingLevel: source.defaultThinkingLevel ?? null,
  };
}

function getDefaultFiles(cwd, agentDir) {
  const paths = getPiPaths(cwd, agentDir);
  return [
    {
      id: "global-settings",
      label: "Global Pi Settings",
      path: paths.globalSettingsPath,
      exists: existsSync(paths.globalSettingsPath),
    },
    {
      id: "auth",
      label: "Pi Auth File",
      path: paths.authPath,
      exists: existsSync(paths.authPath),
    },
    {
      id: "models",
      label: "Pi Models File",
      path: paths.modelsPath,
      exists: existsSync(paths.modelsPath),
    },
    ...(paths.projectSettingsPath
      ? [
          {
            id: "project-settings",
            label: "Project Pi Settings",
            path: paths.projectSettingsPath,
            exists: existsSync(paths.projectSettingsPath),
          },
        ]
      : []),
  ];
}

export async function getPiSettingsSnapshot({ cwd, agentDir }) {
  const workspacePath = cwd ?? process.cwd();
  const settingsManager = getSettingsManager(workspacePath, agentDir);
  const packageManager = createPackageManager(workspacePath, agentDir, settingsManager);
  const modelRegistry = getModelRegistry(agentDir);
  const resolvedPaths = await packageManager.resolve();

  return {
    agentDir,
    workspacePath,
    hasProjectScope: Boolean(cwd),
    thinkingLevels: THINKING_LEVELS,
    defaults: {
      global: getScopeDefaults(settingsManager, "global"),
      project: getScopeDefaults(settingsManager, "project"),
      effective: getEffectiveDefaults(settingsManager),
    },
    packages: collectPackageEntries(settingsManager, packageManager),
    resources: collectResolvedResources(resolvedPaths),
    providers: collectProviderStates(modelRegistry),
    files: getDefaultFiles(cwd, agentDir),
  };
}

export async function setPiScopedDefaults({
  cwd,
  agentDir,
  scope,
  defaultProvider,
  defaultModel,
  defaultThinkingLevel,
}) {
  const workspacePath = cwd ?? process.cwd();
  const normalizedScope = normalizeScope(scope);
  const shouldClearAny =
    defaultProvider === null || defaultModel === null || defaultThinkingLevel === null;

  if (normalizedScope === "global" && !shouldClearAny) {
    const settingsManager = getSettingsManager(workspacePath, agentDir);
    if (defaultProvider !== undefined && defaultModel !== undefined) {
      settingsManager.setDefaultModelAndProvider(defaultProvider, defaultModel);
    } else {
      if (defaultProvider !== undefined) {
        settingsManager.setDefaultProvider(defaultProvider);
      }
      if (defaultModel !== undefined) {
        settingsManager.setDefaultModel(defaultModel);
      }
    }
    if (defaultThinkingLevel !== undefined) {
      settingsManager.setDefaultThinkingLevel(defaultThinkingLevel);
    }
    await settingsManager.flush();
    const globalSettingsPath = join(agentDir, "settings.json");
    writeJsonFile(globalSettingsPath, syncLegacyDefaultAliases(readJsonFile(globalSettingsPath)));
    return getPiSettingsSnapshot({ cwd, agentDir });
  }

  writeScopedSettingsFile({
    cwd: workspacePath,
    agentDir,
    scope: normalizedScope,
    updater(current) {
      if (defaultProvider !== undefined) {
        if (defaultProvider === null) {
          delete current.defaultProvider;
        } else {
          current.defaultProvider = defaultProvider;
        }
      }
      if (defaultModel !== undefined) {
        if (defaultModel === null) {
          delete current.defaultModel;
        } else {
          current.defaultModel = defaultModel;
        }
      }
      if (defaultThinkingLevel !== undefined) {
        if (defaultThinkingLevel === null) {
          delete current.defaultThinkingLevel;
        } else {
          current.defaultThinkingLevel = defaultThinkingLevel;
        }
      }
      return current;
    },
  });

  return getPiSettingsSnapshot({ cwd, agentDir });
}

export async function setPiApiKeyCredential({ agentDir, providerId, key }) {
  const authStorage = getAuthStorage(agentDir);
  authStorage.set(providerId, {
    type: "api_key",
    key,
  });
}

export async function clearPiAuthCredential({ agentDir, providerId }) {
  const authStorage = getAuthStorage(agentDir);
  authStorage.remove(providerId);
}

export async function logoutPiProvider({ agentDir, providerId }) {
  const authStorage = getAuthStorage(agentDir);
  authStorage.logout(providerId);
}

export async function loginPiProvider({
  agentDir,
  providerId,
  onAuth,
  onProgress,
  requestPrompt,
}) {
  const authStorage = getAuthStorage(agentDir);
  await authStorage.login(providerId, {
    onAuth,
    onProgress,
    onPrompt(prompt) {
      return requestPrompt({
        kind: "prompt",
        message: prompt.message,
        placeholder: prompt.placeholder ?? null,
        allowEmpty: Boolean(prompt.allowEmpty),
      });
    },
    onManualCodeInput() {
      return requestPrompt({
        kind: "manual_code",
        message: "Paste the authorization code from your browser to finish signing in.",
        placeholder: "Authorization code",
        allowEmpty: false,
      });
    },
  });
}

export async function installPiPackage({ cwd, agentDir, scope, source }) {
  const workspacePath = cwd ?? process.cwd();
  const settingsManager = getSettingsManager(workspacePath, agentDir);
  const packageManager = createPackageManager(workspacePath, agentDir, settingsManager);
  await packageManager.install(source, {
    local: normalizeScope(scope) === "project",
  });
  return getPiSettingsSnapshot({ cwd, agentDir });
}

export async function removePiPackage({ cwd, agentDir, scope, source }) {
  const workspacePath = cwd ?? process.cwd();
  const settingsManager = getSettingsManager(workspacePath, agentDir);
  const packageManager = createPackageManager(workspacePath, agentDir, settingsManager);
  await packageManager.remove(source, {
    local: normalizeScope(scope) === "project",
  });
  return getPiSettingsSnapshot({ cwd, agentDir });
}
