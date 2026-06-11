import { openUrl } from "@tauri-apps/plugin-opener";
import { useToast } from "@/features/layout/contexts/toast-context";
import {
  disableSettingsSync,
  enableSettingsSync,
  restoreSettingsFromCloud,
  syncSettingsNow,
} from "@/features/settings/lib/settings-sync";
import { useSettingsSyncStore } from "@/features/settings/stores/settings-sync.store";
import { useProFeature } from "@/extensions/ui/hooks/use-pro-feature";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import {
  extractAutocompleteUsage,
  formatUsageDate,
  formatUsdFromCents,
  getAccountPlanLabel,
  getUsageProgress,
} from "@/features/window/lib/account-usage";
import { useAuthStore } from "@/features/window/stores/auth.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Switch from "@/ui/switch";
import { getApiBase } from "@/utils/api-base";
import Section, { SettingRow } from "../settings-section";

export const AccountSettings = () => {
  const user = useAuthStore((state) => state.user);
  const subscription = useAuthStore((state) => state.subscription);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);
  const { isPro } = useProFeature();
  const { isSigningIn, signIn } = useDesktopSignIn();
  const { showToast } = useToast();
  const settingsSyncEnabled = useSettingsSyncStore((state) => state.enabled);
  const settingsSyncHydrated = useSettingsSyncStore((state) => state.isHydrated);
  const settingsSyncStatus = useSettingsSyncStore((state) => state.status);
  const settingsSyncError = useSettingsSyncStore((state) => state.error);
  const settingsSyncIsSyncing = useSettingsSyncStore((state) => state.isSyncing);
  const settingsSyncLastSyncedAt = useSettingsSyncStore((state) => state.lastSyncedAt);
  const settingsSyncLastSource = useSettingsSyncStore((state) => state.lastSyncSource);

  const isEnterprise = subscription?.subscription?.plan === "enterprise";
  const isTeams = Boolean(subscription?.collaboration?.enabled);
  const isPaidPlan = isPro || isEnterprise || isTeams;
  const planLabel = getAccountPlanLabel(subscription, isAuthenticated);
  const autocompleteUsage = extractAutocompleteUsage(subscription);
  const usageProgress = getUsageProgress(autocompleteUsage);

  const handleManageAccount = async () => {
    await openUrl(new URL("/dashboard", getApiBase()).toString());
  };

  const handleManagePlan = async () => {
    await openUrl(new URL(isPaidPlan ? "/dashboard/billing" : "/pricing", getApiBase()).toString());
  };

  const handleToggleSettingsSync = async (checked: boolean) => {
    try {
      if (checked) {
        await enableSettingsSync();
        showToast({ message: "Cloud settings sync enabled", type: "success" });
      } else {
        disableSettingsSync();
        showToast({ message: "Cloud settings sync disabled", type: "success" });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not update cloud settings sync.";
      showToast({ message, type: "error" });
    }
  };

  const handleSyncNow = async () => {
    try {
      await syncSettingsNow();
      showToast({ message: "Settings synced to cloud", type: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Settings sync failed.";
      showToast({ message, type: "error" });
    }
  };

  const handleRestoreFromCloud = async () => {
    try {
      await restoreSettingsFromCloud();
      showToast({ message: "Settings restored from cloud", type: "success" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not restore settings from cloud.";
      showToast({ message, type: "error" });
    }
  };

  const settingsSyncDescription = !isAuthenticated
    ? "Sign in to access cloud settings sync across devices."
    : !isPaidPlan
      ? "Cloud settings sync is included with Pro."
      : settingsSyncLastSyncedAt
        ? `Last synced ${new Date(settingsSyncLastSyncedAt).toLocaleString()}${settingsSyncLastSource ? ` from ${settingsSyncLastSource}` : ""}.`
        : "Keep non-sensitive settings synced across your devices.";

  return (
    <div className="space-y-4">
      <Section title="Account">
        <SettingRow
          label="Account"
          description="Sign in to access account and subscription features."
        >
          {isAuthenticated ? (
            <span className="ui-font ui-text-base text-text-lighter">{user?.email}</span>
          ) : (
            <Button
              variant="default"
              onClick={signIn}
              disabled={isSigningIn}
              className="ui-text-sm"
              compact
            >
              {isSigningIn ? "Signing In..." : "Sign In"}
            </Button>
          )}
        </SettingRow>

        {isAuthenticated && (
          <div
            role="group"
            aria-labelledby="account-ai-usage-label"
            aria-describedby="account-ai-usage-description"
            className="rounded-lg px-1 py-2"
          >
            <div className="mb-3">
              <div className="min-w-0">
                <div id="account-ai-usage-label" className="ui-font ui-text-sm text-text">
                  AI Usage
                </div>
                <div
                  id="account-ai-usage-description"
                  className="ui-font ui-text-sm text-text-lighter"
                >
                  Monthly hosted AI usage across chat, agents, inline edits, generation, and other
                  Athas AI features.
                </div>
              </div>
            </div>
            {autocompleteUsage ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <span className="ui-font ui-text-xs text-text-lighter">Monthly usage</span>
                  <span className="ui-font ui-text-sm font-medium text-text">
                    {formatUsdFromCents(autocompleteUsage.spendCents)} /{" "}
                    {formatUsdFromCents(autocompleteUsage.budgetCents)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-primary-bg/80">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${usageProgress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="ui-font ui-text-xs text-text-lighter/70">
                    {formatUsageDate(autocompleteUsage.periodStart)} -{" "}
                    {formatUsageDate(autocompleteUsage.periodEnd)}
                  </span>
                  <span className="ui-font ui-text-xs text-text-lighter/70">
                    Resets {formatUsageDate(autocompleteUsage.periodEnd)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="ui-font ui-text-xs text-text-lighter">Usage unavailable</div>
            )}
          </div>
        )}

        {isAuthenticated && (
          <SettingRow label="Plan" description="Manage your Athas subscription and billing.">
            <div className="flex items-center gap-2">
              {isPaidPlan ? (
                <Badge
                  variant="default"
                  size="compact"
                  className="border-accent/30 bg-accent/10 font-normal text-accent"
                >
                  {planLabel}
                </Badge>
              ) : null}
              <Button variant="default" onClick={handleManagePlan} className="ui-text-sm" compact>
                {isPaidPlan ? "Manage plan" : "Upgrade plan"}
              </Button>
            </div>
          </SettingRow>
        )}

        {isAuthenticated && (
          <SettingRow
            label="Cloud Settings Sync"
            description={
              settingsSyncError && settingsSyncStatus === "error"
                ? settingsSyncError
                : settingsSyncDescription
            }
          >
            {isPaidPlan ? (
              <Switch
                checked={settingsSyncHydrated ? settingsSyncEnabled : false}
                onChange={(checked) => void handleToggleSettingsSync(checked)}
                size="sm"
                disabled={!settingsSyncHydrated}
              />
            ) : (
              <Switch checked={false} onChange={() => undefined} size="sm" disabled />
            )}
          </SettingRow>
        )}

        {isPaidPlan && settingsSyncEnabled ? (
          <>
            <SettingRow
              label="Sync Now"
              description="Upload this device's current settings snapshot to the cloud."
            >
              <Button
                variant="default"
                onClick={() => void handleSyncNow()}
                className="ui-text-sm"
                disabled={settingsSyncIsSyncing}
              >
                {settingsSyncIsSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            </SettingRow>

            <SettingRow
              label="Restore From Cloud"
              description="Replace this device's non-sensitive settings with the cloud snapshot."
            >
              <Button
                variant="default"
                onClick={() => void handleRestoreFromCloud()}
                className="ui-text-sm"
                disabled={settingsSyncIsSyncing}
              >
                Restore
              </Button>
            </SettingRow>
          </>
        ) : null}

        {isAuthenticated && (
          <SettingRow
            label="Manage Account"
            description="Open your Athas dashboard to manage billing and subscription details."
          >
            <Button variant="default" onClick={handleManageAccount} className="ui-text-sm" compact>
              Open Dashboard
            </Button>
          </SettingRow>
        )}

        {isAuthenticated && (
          <SettingRow
            label="Sign Out"
            description="End your current Athas account session on this device."
          >
            <Button variant="default" onClick={() => void logout()} className="ui-text-sm">
              Sign Out
            </Button>
          </SettingRow>
        )}
      </Section>
    </div>
  );
};
