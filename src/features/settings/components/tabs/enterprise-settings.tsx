import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/stores/toast-store";
import Button from "@/ui/button";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";
import Textarea from "@/ui/textarea";
import { updateEnterprisePolicy } from "@/utils/auth-api";

const parseAllowlistInput = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

export const EnterpriseSettings = () => {
  const subscription = useAuthStore((state) => state.subscription);
  const refreshSubscription = useAuthStore((state) => state.refreshSubscription);

  const enterprise = subscription?.enterprise;
  const policy = enterprise?.policy;
  const isAdmin = Boolean(enterprise?.is_admin);
  const hasAccess = Boolean(enterprise?.has_access);

  const [isSaving, setIsSaving] = useState(false);
  const [allowlistInput, setAllowlistInput] = useState(
    policy?.allowedExtensionIds.join("\n") || "",
  );

  useEffect(() => {
    setAllowlistInput(policy?.allowedExtensionIds.join("\n") || "");
  }, [policy?.allowedExtensionIds]);

  const parsedAllowlist = useMemo(() => parseAllowlistInput(allowlistInput), [allowlistInput]);

  const savePolicyPatch = async (
    patch: Partial<{
      managedMode: boolean;
      requireExtensionAllowlist: boolean;
      allowByok: boolean;
      aiCompletionEnabled: boolean;
      aiChatEnabled: boolean;
      allowedExtensionIds: string[];
    }>,
    successMessage: string,
  ) => {
    if (!isAdmin) return;

    setIsSaving(true);
    try {
      await updateEnterprisePolicy(patch);
      await refreshSubscription();
      toast.success(successMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update policy.";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!hasAccess) {
    return (
      <div className="space-y-4">
        <Section title="Enterprise Controls" description="Access restricted">
          <div className="px-1 py-2 text-text-lighter text-xs">
            Enterprise policy controls are available only for enterprise workspaces.
          </div>
        </Section>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="space-y-4">
        <Section title="Enterprise Controls" description="Policy unavailable">
          <div className="px-1 py-2 text-text-lighter text-xs">
            Enterprise policy could not be loaded. Try re-authenticating.
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Section
        title="Enterprise Controls"
        description={isAdmin ? "Manage organization policy controls." : "Read-only policy view."}
      >
        <SettingRow
          label="Managed Mode"
          description="Enforce enterprise policy controls in the desktop app."
        >
          <Switch
            checked={policy.managedMode}
            onChange={(checked) =>
              savePolicyPatch({ managedMode: checked }, "Managed mode updated.")
            }
            size="sm"
            disabled={!isAdmin || isSaving}
          />
        </SettingRow>

        <SettingRow
          label="Require Extension Allowlist"
          description="Only approved extension IDs can be installed or updated."
        >
          <Switch
            checked={policy.requireExtensionAllowlist}
            onChange={(checked) =>
              savePolicyPatch(
                { requireExtensionAllowlist: checked },
                "Allowlist enforcement updated.",
              )
            }
            size="sm"
            disabled={!isAdmin || isSaving || !policy.managedMode}
          />
        </SettingRow>

        <SettingRow
          label="Allow BYOK Autocomplete"
          description="Allow user-provided OpenRouter keys for autocomplete."
        >
          <Switch
            checked={policy.allowByok}
            onChange={(checked) => savePolicyPatch({ allowByok: checked }, "BYOK policy updated.")}
            size="sm"
            disabled={!isAdmin || isSaving || !policy.managedMode}
          />
        </SettingRow>

        <SettingRow
          label="Enable AI Autocomplete"
          description="Enable inline AI completion for enterprise users."
        >
          <Switch
            checked={policy.aiCompletionEnabled}
            onChange={(checked) =>
              savePolicyPatch({ aiCompletionEnabled: checked }, "AI autocomplete policy updated.")
            }
            size="sm"
            disabled={!isAdmin || isSaving || !policy.managedMode}
          />
        </SettingRow>

        <SettingRow label="Enable AI Chat" description="Enable AI chat panel for enterprise users.">
          <Switch
            checked={policy.aiChatEnabled}
            onChange={(checked) =>
              savePolicyPatch({ aiChatEnabled: checked }, "AI chat policy updated.")
            }
            size="sm"
            disabled={!isAdmin || isSaving || !policy.managedMode}
          />
        </SettingRow>
      </Section>

      <Section
        title="Extension Allowlist"
        description="Approved extension IDs, one per line (or comma-separated)."
      >
        <div className="space-y-3 px-1 py-1">
          <Textarea
            value={allowlistInput}
            onChange={(event) => setAllowlistInput(event.target.value)}
            rows={8}
            size="sm"
            className="font-mono text-xs"
            placeholder="athas.typescript&#10;athas.python&#10;athas.go"
            disabled={!isAdmin || isSaving || !policy.managedMode}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-text-lighter text-xs">
              Parsed entries: <span className="text-text">{parsedAllowlist.length}</span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={() => setAllowlistInput("")}
                disabled={!isAdmin || isSaving || !policy.managedMode}
              >
                Clear
              </Button>
              <Button
                size="xs"
                onClick={() =>
                  savePolicyPatch(
                    { allowedExtensionIds: parsedAllowlist },
                    "Extension allowlist updated.",
                  )
                }
                disabled={!isAdmin || isSaving || !policy.managedMode}
              >
                {isSaving ? "Saving..." : "Apply allowlist"}
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};
