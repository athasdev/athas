import { openUrl } from "@tauri-apps/plugin-opener";
import { getServiceUrls } from "@/config/services";
import { useToast } from "@/features/layout/contexts/toast-context";
import {
  disableSettingsSync,
  enableSettingsSync,
  restoreSettingsFromCloud,
  syncSettingsNow,
} from "@/features/settings/lib/settings-sync";
import { useSettingsSyncStore } from "@/features/settings/stores/settings-sync.store";
import { useProFeature } from "@/features/window/hooks/use-pro-feature";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { getAccountPlanLabel } from "@/features/window/lib/account-usage";
import { useAuthStore } from "@/features/window/stores/auth.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Switch from "@/ui/switch";
import Section, { SettingsView, SettingRow } from "../settings-section";

export const AccountSettings = () => {
  const services = getServiceUrls();
  const user = useAuthStore((state) => state.user);
  const subscription = useAuthStore((state) => state.subscription);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.actions.logout);
  const { isPro, hasIntelligence, hasSettingsSync } = useProFeature();
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

  const handleManageAccount = async () => {
    await openUrl(services.dashboardUrl);
  };

  const handleManagePlan = async () => {
    await openUrl(isPaidPlan ? services.dashboardBillingUrl : services.pricingUrl);
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
    : !hasSettingsSync
      ? "Cloud settings sync is included with Pro."
      : settingsSyncLastSyncedAt
        ? `Last synced ${new Date(settingsSyncLastSyncedAt).toLocaleString()}${settingsSyncLastSource ? ` from ${settingsSyncLastSource}` : ""}.`
        : "Keep non-sensitive settings synced across your devices.";

  return (
    <SettingsView>
      <Section title="Account">
        <SettingRow
          label="Account"
          description="Sign in to access account and subscription features."
        >
          {isAuthenticated ? (
            <span className="font-sans ui-text-base text-subtle-foreground">{user?.email}</span>
          ) : (
            <Button variant="default" onClick={signIn} disabled={isSigningIn}>
              {isSigningIn ? "Signing In..." : "Sign In"}
            </Button>
          )}
        </SettingRow>

        {isAuthenticated && (
          <div
            role="group"
            aria-labelledby="account-intelligence-label"
            aria-describedby="account-intelligence-description"
            className="rounded-lg px-1 py-2"
          >
            <div className="mb-3">
              <div className="min-w-0">
                <div
                  id="account-intelligence-label"
                  className="font-sans ui-text-base text-foreground"
                >
                  Athas Intelligence
                </div>
                <div
                  id="account-intelligence-description"
                  className="font-sans ui-text-base text-subtle-foreground"
                >
                  Focused editor features including commit messages, inline edits, autocomplete,
                  drafts, and extension generation. Athas Agent uses your configured provider.
                </div>
              </div>
            </div>
            <Badge variant={hasIntelligence ? "default" : "muted"}>
              {hasIntelligence ? "Included in Pro" : "Pro required"}
            </Badge>
          </div>
        )}

        {isAuthenticated && (
          <SettingRow label="Plan" description="Manage your Athas subscription and billing.">
            <div className="flex items-center gap-2">
              {isPaidPlan ? (
                <Badge variant="default" className="bg-primary/10 font-normal text-primary">
                  {planLabel}
                </Badge>
              ) : null}
              <Button variant="default" onClick={handleManagePlan}>
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
            {hasSettingsSync ? (
              <Switch
                checked={settingsSyncHydrated ? settingsSyncEnabled : false}
                onChange={(checked) => void handleToggleSettingsSync(checked)}
                disabled={!settingsSyncHydrated}
              />
            ) : (
              <Switch checked={false} onChange={() => undefined} disabled />
            )}
          </SettingRow>
        )}

        {hasSettingsSync && settingsSyncEnabled ? (
          <>
            <SettingRow
              label="Sync Now"
              description="Upload this device's current settings snapshot to the cloud."
            >
              <Button
                variant="default"
                onClick={() => void handleSyncNow()}
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
            <Button variant="default" onClick={handleManageAccount}>
              Open Dashboard
            </Button>
          </SettingRow>
        )}

        {isAuthenticated && (
          <SettingRow
            label="Sign Out"
            description="End your current Athas account session on this device."
          >
            <Button variant="default" onClick={() => void logout()}>
              Sign Out
            </Button>
          </SettingRow>
        )}
      </Section>
    </SettingsView>
  );
};
