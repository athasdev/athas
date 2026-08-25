import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Select from "@/ui/select";
import { Spinner } from "@/ui/spinner";
import Section, {
  SETTINGS_CONTROL_WIDTHS,
  SettingRow,
} from "@/features/settings/components/settings-section";
import {
  CodexIntegrationService,
  getCodexSettings,
  saveCodexSettings,
} from "./codex-integration-service";
import type { CodexIntegrationStatus, CodexThreadSettings } from "./codex-types";
import { useProjectStore } from "@/features/window/stores/project.store";
import { normalizeCodexSkills, normalizeCodexThreads } from "./codex-composer-catalog";

const effortOptions = ["low", "medium", "high", "xhigh"].map((value) => ({
  value,
  label: value === "xhigh" ? "Extra high" : `${value[0].toUpperCase()}${value.slice(1)}`,
}));
const sandboxOptions = [
  { value: "read-only", label: "Read only" },
  { value: "workspace-write", label: "Workspace write" },
  { value: "danger-full-access", label: "Full access" },
];
const approvalOptions = [
  { value: "on-request", label: "Ask when needed" },
  { value: "untrusted", label: "Untrusted commands" },
  { value: "never", label: "Never ask" },
];

export function CodexSettings() {
  const cwd = useProjectStore((state) => state.rootFolderPath || ".");
  const [status, setStatus] = useState<CodexIntegrationStatus | null>(null);
  const [settings, setSettings] = useState<CodexThreadSettings>(getCodexSettings);
  const [models, setModels] = useState<any[]>([]);
  const [details, setDetails] = useState({ skills: 0, mcp: 0, threads: 0 });
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = useCallback(async () => {
    setBusy(true);
    setCatalogError(null);
    try {
      setStatus(await invoke<CodexIntegrationStatus>("start_codex_integration", { args: { cwd } }));
      const [modelResult, skillsResult, mcpResult, threadResult] = await Promise.all([
        invoke<any>("list_codex_models"),
        invoke<any>("list_codex_skills", { cwd }),
        invoke<any>("list_codex_mcp_servers"),
        invoke<any>("list_codex_threads", { cwd, cursor: null }),
      ]);
      setModels(modelResult.data ?? modelResult.models ?? []);
      setDetails({
        skills: normalizeCodexSkills(skillsResult).skills.length,
        mcp: (mcpResult.data ?? mcpResult.servers ?? []).length,
        threads: normalizeCodexThreads(threadResult).length,
      });
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setStatus(await CodexIntegrationService.status().catch(() => null));
    }
  }, [cwd]);

  useEffect(() => {
    void CodexIntegrationService.status()
      .then(setStatus)
      .catch(() => {});
  }, []);

  const update = (patch: Partial<CodexThreadSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveCodexSettings(next);
  };

  return (
    <Section
      title="Codex Integration"
      description="Native Codex app-server integration. Codex is built into Athas and is not an extension agent."
    >
      <SettingRow
        label="Codex CLI"
        description={
          status?.version ?? status?.error ?? "Install the Codex CLI to use this integration"
        }
      >
        <div className="flex items-center gap-2">
          <Badge variant="default">
            {status?.initialized ? "Connected" : status?.installed ? "Installed" : "Unavailable"}
          </Badge>
          <Button
            size="sm"
            variant="default"
            onClick={() => void connect()}
            disabled={!status?.installed || busy}
          >
            {busy ? (
              <Spinner compact label="Connecting" />
            ) : status?.initialized ? (
              "Refresh"
            ) : (
              "Connect"
            )}
          </Button>
        </div>
      </SettingRow>
      <SettingRow label="Model" description="Models are read from your installed Codex version">
        <Select
          value={settings.model ?? ""}
          options={models.map((model) => ({
            value: model.id ?? model.model,
            label: model.displayName ?? model.name ?? model.id,
          }))}
          placeholder="Codex default"
          onChange={(model) => update({ model })}
          className={SETTINGS_CONTROL_WIDTHS.xwide}
          searchable
        />
      </SettingRow>
      <SettingRow label="Reasoning" description="Reasoning effort for new turns">
        <Select
          value={settings.effort ?? "medium"}
          options={effortOptions}
          onChange={(effort) => update({ effort })}
          className={SETTINGS_CONTROL_WIDTHS.wide}
        />
      </SettingRow>
      <SettingRow label="Workspace access" description="Filesystem sandbox used by Codex">
        <Select
          value={settings.sandbox ?? "workspace-write"}
          options={sandboxOptions}
          onChange={(sandbox) => update({ sandbox })}
          className={SETTINGS_CONTROL_WIDTHS.wide}
        />
      </SettingRow>
      <SettingRow label="Approvals" description="When Codex asks before running an action">
        <Select
          value={settings.approvalPolicy ?? "on-request"}
          options={approvalOptions}
          onChange={(approvalPolicy) => update({ approvalPolicy })}
          className={SETTINGS_CONTROL_WIDTHS.wide}
        />
      </SettingRow>
      <SettingRow
        label="Codex capabilities"
        description={catalogError ?? "Loaded from app-server for the current workspace"}
      >
        <div className="flex items-center gap-1.5">
          <Badge variant="default">{details.threads} threads</Badge>
          <Badge variant="default">{details.skills} skills</Badge>
          <Badge variant="default">{details.mcp} MCP</Badge>
        </div>
      </SettingRow>
      <SettingRow label="Account" description="Uses the Codex CLI account on this device">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => void invoke("start_codex_login", { loginType: "chatgpt" })}
          >
            Sign in
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void invoke("logout_codex_account")}>
            Sign out
          </Button>
        </div>
      </SettingRow>
    </Section>
  );
}
