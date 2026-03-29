import { invoke } from "@tauri-apps/api/core";

export type PiSettingsScope = "global" | "project";

export interface PiSettingsDefaults {
  defaultProvider: string | null;
  defaultModel: string | null;
  defaultThinkingLevel: string | null;
}

export interface PiPackageFilters {
  extensions: string[] | null;
  skills: string[] | null;
  prompts: string[] | null;
  themes: string[] | null;
}

export interface PiPackageEntry {
  source: string;
  filters: PiPackageFilters | null;
  scope: PiSettingsScope;
  installedPath: string | null;
}

export interface PiResourceEntry {
  id: string;
  kind: string;
  name: string;
  path: string;
  enabled: boolean;
  source: string;
  origin: "package" | "top-level";
  scope: "user" | "project" | "temporary";
  baseDir: string | null;
}

export interface PiProviderModelEntry {
  provider: string;
  modelId: string;
  name: string;
  reasoning: boolean;
  available: boolean;
  configured: boolean;
}

export interface PiStoredCredentialSummary {
  type: "oauth" | "api_key";
  expiresAt?: string | null;
  keyMode?: "command" | "environment" | "literal";
}

export interface PiProviderState {
  id: string;
  name: string;
  supportsOAuth: boolean;
  supportsApiKey: boolean;
  hasEnvironmentAuth: boolean;
  hasStoredAuth: boolean;
  storedCredential: PiStoredCredentialSummary | null;
  authStatus: "oauth" | "api_key" | "environment" | "missing" | string;
  modelCount: number;
  models: PiProviderModelEntry[];
}

export interface PiSettingsFileEntry {
  id: string;
  label: string;
  path: string;
  exists: boolean;
}

export interface PiSettingsSnapshot {
  agentDir: string;
  workspacePath: string;
  hasProjectScope: boolean;
  thinkingLevels: string[];
  defaults: {
    global: PiSettingsDefaults;
    project: PiSettingsDefaults;
    effective: PiSettingsDefaults;
  };
  packages: {
    global: PiPackageEntry[];
    project: PiPackageEntry[];
  };
  resources: PiResourceEntry[];
  providers: PiProviderState[];
  files: PiSettingsFileEntry[];
}

export type PiNativeSettingsEvent =
  | {
      type: "auth_start";
      providerId: string;
    }
  | {
      type: "auth_open_url";
      providerId: string;
      url: string;
      instructions: string | null;
    }
  | {
      type: "auth_progress";
      providerId: string;
      message: string;
    }
  | {
      type: "auth_prompt";
      providerId: string;
      requestId: string;
      kind: "prompt" | "manual_code";
      message: string;
      placeholder: string | null;
      allowEmpty: boolean;
    }
  | {
      type: "auth_complete";
      providerId: string;
    }
  | {
      type: "auth_error";
      providerId: string;
      error: string;
    };

interface PiWorkspaceParams {
  workspacePath?: string | null;
}

interface PiDefaultsParams extends PiWorkspaceParams {
  scope: PiSettingsScope;
  defaultProvider?: string | null;
  defaultModel?: string | null;
  defaultThinkingLevel?: string | null;
}

interface PiProviderCredentialParams extends PiWorkspaceParams {
  providerId: string;
}

interface PiApiKeyParams extends PiProviderCredentialParams {
  key: string;
}

interface PiPackageParams extends PiWorkspaceParams {
  scope: PiSettingsScope;
  source: string;
}

export async function getPiSettingsSnapshot(
  workspacePath?: string | null,
): Promise<PiSettingsSnapshot> {
  return invoke("get_pi_native_settings_snapshot", { workspacePath });
}

export async function setPiScopedDefaults(params: PiDefaultsParams): Promise<PiSettingsSnapshot> {
  return invoke("set_pi_native_scoped_defaults", {
    workspacePath: params.workspacePath ?? null,
    scope: params.scope,
    defaultProvider: params.defaultProvider ?? undefined,
    defaultModel: params.defaultModel ?? undefined,
    defaultThinkingLevel: params.defaultThinkingLevel ?? undefined,
  });
}

export async function loginPiProvider(
  params: PiProviderCredentialParams,
): Promise<PiSettingsSnapshot> {
  return invoke("login_pi_native_provider", {
    workspacePath: params.workspacePath ?? null,
    providerId: params.providerId,
  });
}

export async function logoutPiProvider(
  params: PiProviderCredentialParams,
): Promise<PiSettingsSnapshot> {
  return invoke("logout_pi_native_provider", {
    workspacePath: params.workspacePath ?? null,
    providerId: params.providerId,
  });
}

export async function setPiApiKeyCredential(params: PiApiKeyParams): Promise<PiSettingsSnapshot> {
  return invoke("set_pi_native_api_key_credential", {
    workspacePath: params.workspacePath ?? null,
    providerId: params.providerId,
    key: params.key,
  });
}

export async function clearPiAuthCredential(
  params: PiProviderCredentialParams,
): Promise<PiSettingsSnapshot> {
  return invoke("clear_pi_native_auth_credential", {
    workspacePath: params.workspacePath ?? null,
    providerId: params.providerId,
  });
}

export async function respondPiNativeAuthPrompt(params: {
  requestId: string;
  value?: string | null;
  cancelled?: boolean;
}): Promise<void> {
  await invoke("respond_pi_native_auth_prompt", {
    requestId: params.requestId,
    value: params.value ?? null,
    cancelled: Boolean(params.cancelled),
  });
}

export async function installPiPackage(params: PiPackageParams): Promise<PiSettingsSnapshot> {
  return invoke("install_pi_native_package", {
    workspacePath: params.workspacePath ?? null,
    scope: params.scope,
    source: params.source,
  });
}

export async function removePiPackage(params: PiPackageParams): Promise<PiSettingsSnapshot> {
  return invoke("remove_pi_native_package", {
    workspacePath: params.workspacePath ?? null,
    scope: params.scope,
    source: params.source,
  });
}

export function getPiScopedDefaults(
  snapshot: PiSettingsSnapshot,
  scope: PiSettingsScope,
): PiSettingsDefaults {
  return scope === "project" ? snapshot.defaults.project : snapshot.defaults.global;
}

export function getPiEffectiveProviderId(
  snapshot: PiSettingsSnapshot,
  scope: PiSettingsScope,
): string {
  const scoped = getPiScopedDefaults(snapshot, scope);
  return scoped.defaultProvider ?? snapshot.defaults.effective.defaultProvider ?? "";
}
