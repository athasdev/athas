import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getServiceUrls } from "@/config/services";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import Switch from "@/ui/switch";
import Section, { SettingsView, SettingRow } from "@/features/settings/components/settings-section";
import { writeClipboardText } from "@/utils/clipboard";
import { fetchShareOptions, revokeShare, setSessionSync, updateShare } from "../services/share-api";
import { ShareAccessDialog } from "./share-access-dialog";
import type { SharedItem, ShareOptions } from "../types/share.types";

export function SharingSettings() {
  const [editing, setEditing] = useState<SharedItem | null>(null);
  const [options, setOptions] = useState<ShareOptions | null>(null);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => setOptions(await fetchShareOptions());
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update sharing");
    } finally {
      await refresh().catch(() => {});
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh().catch((reason) => setError(reason.message));
    const status = (event: Event) => setSyncError((event as CustomEvent).detail.error || "");
    window.addEventListener("athas:sharing-status", status);
    return () => window.removeEventListener("athas:sharing-status", status);
  }, []);
  const base = getServiceUrls().websiteBaseUrl;
  return (
    <SettingsView>
      {editing && options && (
        <ShareAccessDialog
          item={editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => void run(refresh)}
        />
      )}
      <Section
        title="Cloud Sessions"
        description="Keep your agent conversations available on the web. Synced sessions are private to your account."
      >
        <SettingRow
          label="Sync Agent Sessions"
          description="Upload existing conversations and keep new responses in sync while Athas runs. Turning this off keeps existing cloud copies."
        >
          <Switch
            aria-label="Sync agent sessions"
            checked={options?.sessionsEnabled ?? false}
            disabled={busy || !options}
            onChange={(enabled) => void run(() => setSessionSync(enabled))}
          />
        </SettingRow>
        <SettingRow
          label="Web Library"
          description="Read your private sessions and manage links on athas.dev"
        >
          <Button onClick={() => void openUrl(`${base}/dashboard/settings/sharing`)}>
            Open on web
          </Button>
        </SettingRow>
      </Section>
      <Section
        title="Shared Items"
        description="Manage access and pause live updates without changing the link"
      >
        {!options && (
          <EmptyState
            className="py-6"
            tone={error ? "error" : "neutral"}
            message={error || "Loading shared items…"}
          />
        )}
        {options?.items.filter((item) => item.visibility !== "private").length === 0 && (
          <EmptyState
            className="py-6"
            message="No shared links yet. Share a conversation, selection, or editor buffer to get started."
          />
        )}
        {options?.items
          .filter((item) => item.visibility !== "private")
          .map((item) => (
            <SettingRow
              key={item.id}
              label={item.title}
              description={`${item.visibility} · ${item.live ? "Live" : "Snapshot"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {item.sourceId && item.kind !== "snippet" && (
                  <Switch
                    aria-label={`Live updates for ${item.title}`}
                    checked={item.live}
                    disabled={busy}
                    onChange={(live) =>
                      void run(() => updateShare(item.id, item.revision, { live }))
                    }
                  />
                )}
                <Button
                  disabled={busy}
                  onClick={() => void run(() => writeClipboardText(`${base}/s/${item.id}`))}
                >
                  Copy link
                </Button>
                <Button disabled={busy} onClick={() => setEditing(item)}>
                  Access
                </Button>
                <Button onClick={() => void openUrl(`${base}/s/${item.id}`)}>Open</Button>
                <Button disabled={busy} onClick={() => void run(() => revokeShare(item.id))}>
                  Revoke
                </Button>
              </div>
            </SettingRow>
          ))}
      </Section>
      {((error && options) || syncError) && (
        <Alert tone="error">
          <AlertDescription>{syncError || error}</AlertDescription>
        </Alert>
      )}
    </SettingsView>
  );
}
