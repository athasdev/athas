import { openExternalUrl } from "@/utils/external-url";
import { getServiceUrls } from "@/config/services";
import { useToast } from "@/utils/toast";
import {
  disableSettingsSync,
  enableSettingsSync,
  restoreSettingsFromCloud,
  syncSettingsNow,
} from "@/features/settings/lib/settings-sync";
import { useSettingsSyncStore } from "@/features/settings/stores/settings-sync.store";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import { useDesktopSignIn } from "@/features/auth/hooks/use-desktop-sign-in";
import { getAccountPlanLabel } from "@/features/auth/utils/account-usage";
import { useAuthStore } from "@/features/auth/stores/auth.store";
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
  const { isPro, hasSettingsSync } = useProFeature();
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
    await openExternalUrl(services.dashboardUrl);
  };

  const handleManagePlan = async () => {
    await openExternalUrl(isPaidPlan ? services.dashboardBillingUrl : services.pricingUrl);
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

  const settingsSyncDescription = !hasSettingsSync
    ? "Included with Pro"
    : settingsSyncLastSyncedAt
      ? `Last synced ${new Date(settingsSyncLastSyncedAt).toLocaleString()}${settingsSyncLastSource ? ` from ${settingsSyncLastSource}` : ""}`
      : "Sync settings across your devices";

  return (
    <SettingsView>
      <Section title="Account">
        {isAuthenticated ? (
          <SettingRow label="Signed In" description={user?.email} activateOnClick={false}>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleManageAccount}>
                Dashboard
              </Button>
              <Button variant="outline" onClick={() => void logout()}>
                Sign Out
              </Button>
            </div>
          </SettingRow>
        ) : (
          <SettingRow label="Account" description="Sign in for Pro, Athas AI, and settings sync">
            <Button
              variant="accent"
              onClick={() => void signIn().catch(() => undefined)}
              disabled={isSigningIn}
            >
              {isSigningIn ? "Signing In..." : "Sign In"}
            </Button>
          </SettingRow>
        )}
        {isAuthenticated ? (
          <SettingRow
            label="Plan"
            labelAccessory={isPaidPlan ? <Badge tone="accent">{planLabel}</Badge> : null}
          >
            <Button variant={isPaidPlan ? "outline" : "accent"} onClick={handleManagePlan}>
              {isPaidPlan ? "Manage Plan" : "Upgrade"}
            </Button>
          </SettingRow>
        ) : null}
      </Section>
      {isAuthenticated ? (
        <Section title="Settings Sync">
          <SettingRow
            label="Cloud Settings Sync"
            description={
              settingsSyncError && settingsSyncStatus === "error"
                ? settingsSyncError
                : settingsSyncDescription
            }
          >
            <div className="flex items-center gap-2">
              {hasSettingsSync && settingsSyncEnabled ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void handleSyncNow()}
                    disabled={settingsSyncIsSyncing}
                  >
                    {settingsSyncIsSyncing ? "Syncing..." : "Sync Now"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleRestoreFromCloud()}
                    disabled={settingsSyncIsSyncing}
                    tooltip="Replace this device's settings with the cloud copy"
                  >
                    Restore
                  </Button>
                </>
              ) : null}
              <Switch
                checked={hasSettingsSync && settingsSyncHydrated ? settingsSyncEnabled : false}
                onChange={(checked) => void handleToggleSettingsSync(checked)}
                disabled={!hasSettingsSync || !settingsSyncHydrated}
              />
            </div>
          </SettingRow>
        </Section>
      ) : null}
    </SettingsView>
  );
};
