import { commands } from "@/bindings/commands";
import { useCallback, useEffect, useState } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Select from "@/ui/select";
import { Spinner } from "@/ui/spinner";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import Section, { SettingRow } from "@/features/settings/components/settings-section";
import { CodexIntegrationService } from "./codex-integration-service";
import type { CodexIntegrationStatus } from "./codex-types";
import { useCodexSettings } from "./use-codex-settings";
import { useCodexModels } from "./use-codex-models";
import { useProjectStore } from "@/features/window/stores/project.store";
import { normalizeCodexSkills, normalizeCodexThreads } from "./codex-composer-catalog";
import { getCodexModelPatch } from "./codex-model-settings";

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
  const { settings, update } = useCodexSettings();
  const { models, retry: refreshModels } = useCodexModels(cwd);
  const model = models.find((item) =>
    settings.model ? item.id === settings.model : item.isDefault,
  );
  const effortOptions =
    model?.reasoningEfforts.map(({ value, label }) => ({
      value,
      label: value,
      keywords: [label],
    })) ?? [];
  const [details, setDetails] = useState({ skills: 0, mcp: 0, threads: 0 });
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = useCallback(async () => {
    setBusy(true);
    setCatalogError(null);
    try {
      setStatus(await commands.startCodexIntegration({ cwd }));
      refreshModels();
      const [skillsResult, mcpResult, threadResult] = await Promise.all([
        commands.listCodexSkills(cwd),
        commands.listCodexMcpServers() as Promise<{ data?: unknown[]; servers?: unknown[] }>,
        commands.listCodexThreads(cwd, null, null),
      ]);
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
  }, [cwd, refreshModels]);

  useEffect(() => {
    void CodexIntegrationService.status()
      .then(setStatus)
      .catch(() => {});
  }, []);

  return (
    <Section title="Codex" icon={<ProviderIcon providerId="codex" />}>
      <SettingRow
        label="Codex CLI"
        description={status?.version ?? status?.error ?? "Not installed"}
      >
        <div className="flex items-center gap-2">
          <Badge tone={status?.initialized ? "success" : "neutral"}>
            {status?.initialized ? "Connected" : status?.installed ? "Installed" : "Unavailable"}
          </Badge>
          <Button
            variant="outline"
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
      <SettingRow label="Model" control="select">
        <Select
          value={settings.model ?? ""}
          options={[
            { value: "", label: "Codex default" },
            ...models.map((model) => ({
              value: model.id,
              label: model.name,
            })),
          ]}
          placeholder="Codex default"
          onChange={(model) => update(getCodexModelPatch(model || undefined, models, settings))}
          variant="surface"
          width="full"
          searchable
        />
      </SettingRow>
      <SettingRow label="Reasoning" control="select">
        <Select
          value={settings.effort ?? "medium"}
          options={effortOptions}
          disabled={effortOptions.length === 0}
          onChange={(effort) => update({ effort })}
          variant="surface"
          width="full"
        />
      </SettingRow>
      <SettingRow label="Workspace Access" control="select">
        <Select
          value={settings.sandbox ?? "workspace-write"}
          options={sandboxOptions}
          onChange={(sandbox) => update({ sandbox })}
          variant="surface"
          width="full"
        />
      </SettingRow>
      <SettingRow label="Approvals" control="select">
        <Select
          value={settings.approvalPolicy ?? "on-request"}
          options={approvalOptions}
          onChange={(approvalPolicy) => update({ approvalPolicy })}
          variant="surface"
          width="full"
        />
      </SettingRow>
      <SettingRow label="Capabilities" description={catalogError ?? undefined}>
        <div className="flex items-center gap-1.5">
          <Badge>{details.threads} threads</Badge>
          <Badge>{details.skills} skills</Badge>
          <Badge>{details.mcp} MCP</Badge>
        </div>
      </SettingRow>
      <SettingRow label="Account">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void commands.startCodexLogin("chatgpt")}>
            Sign in
          </Button>
          <Button variant="outline" onClick={() => void commands.logoutCodexAccount()}>
            Sign out
          </Button>
        </div>
      </SettingRow>
    </Section>
  );
}
