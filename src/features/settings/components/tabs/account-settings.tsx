import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CreditCard,
  CloudArrowDown,
  CloudArrowUp,
  ArrowSquareOut as ExternalLink,
  SignIn as LogIn,
  SignOut as LogOut,
} from "@phosphor-icons/react";
import { useToast } from "@/features/layout/contexts/toast-context";
import {
  disableSettingsSync,
  enableSettingsSync,
  restoreSettingsFromCloud,
  syncSettingsNow,
} from "@/features/settings/lib/settings-sync";
import { useSettingsSyncStore } from "@/features/settings/stores/settings-sync-store";
import { useProFeature } from "@/extensions/ui/hooks/use-pro-feature";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { useAuthStore } from "@/features/window/stores/auth-store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Switch from "@/ui/switch";
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
  const isPaidPlan = isPro || isEnterprise;
  const planLabel =
    subscription?.subscription?.plan === "enterprise" ? "Enterprise" : isPro ? "Pro" : "Free";

  const handleManageAccount = async () => {
    await openUrl("https://athas.dev/dashboard");
  };

  const handleManagePlan = async () => {
    await openUrl(isPaidPlan ? "https://athas.dev/dashboard/billing" : "https://athas.dev/pricing");
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
            <span className="ui-font text-[length:var(--app-ui-control-font-size)] text-text-lighter">
              {user?.email}
            </span>
          ) : (
            <Button
              variant="default"
              size="xs"
              onClick={signIn}
              disabled={isSigningIn}
              className="ui-text-sm"
            >
              <LogIn />
              {isSigningIn ? "Signing In..." : "Sign In"}
            </Button>
          )}
        </SettingRow>

        {isAuthenticated && (
          <SettingRow label="Plan" description="Manage your Athas subscription and billing.">
            <div className="flex items-center gap-2">
              {isPaidPlan ? (
                <Badge
                  variant="default"
                  shape="pill"
                  size="compact"
                  className="border-accent/30 bg-accent/10 text-accent"
                >
                  {planLabel}
                </Badge>
              ) : null}
              <Button variant="default" size="xs" onClick={handleManagePlan} className="ui-text-sm">
                <CreditCard />
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
                size="xs"
                onClick={() => void handleSyncNow()}
                className="ui-text-sm"
                disabled={settingsSyncIsSyncing}
              >
                <CloudArrowUp />
                {settingsSyncIsSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            </SettingRow>

            <SettingRow
              label="Restore From Cloud"
              description="Replace this device's non-sensitive settings with the cloud snapshot."
            >
              <Button
                variant="default"
                size="xs"
                onClick={() => void handleRestoreFromCloud()}
                className="ui-text-sm"
                disabled={settingsSyncIsSyncing}
              >
                <CloudArrowDown />
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
            <Button
              variant="default"
              size="xs"
              onClick={handleManageAccount}
              className="ui-text-sm"
            >
              <ExternalLink />
              Open Dashboard
            </Button>
          </SettingRow>
        )}

        {isAuthenticated && (
          <SettingRow
            label="Sign Out"
            description="End your current Athas account session on this device."
          >
            <Button
              variant="default"
              size="xs"
              onClick={() => void logout()}
              className="ui-text-sm"
            >
              <LogOut />
              Sign Out
            </Button>
          </SettingRow>
        )}
      </Section>
    </div>
  );
};
