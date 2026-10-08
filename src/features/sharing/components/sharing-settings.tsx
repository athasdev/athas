import { useEffect, useRef, useState } from "react";
import { useToast } from "@/utils/toast";
import { openExternalUrl } from "@/utils/external-url";
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
import { onAppEvent } from "@/utils/app-events";

function sharingErrorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function SharingSettings() {
  const { showToast } = useToast();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const actionPending = useRef(false);
  const [editing, setEditing] = useState<SharedItem | null>(null);
  const [options, setOptions] = useState<ShareOptions | null>(null);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => setOptions(await fetchShareOptions());
  const run = async (action?: () => Promise<unknown>) => {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setError("");
    try {
      await action?.();
    } catch (reason) {
      setError(sharingErrorMessage(reason, "Could not update sharing"));
    } finally {
      await refresh().catch((reason) => {
        setError(
          (current) => current || sharingErrorMessage(reason, "Could not load sharing settings"),
        );
      });
      actionPending.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    setError("");
    void fetchShareOptions().then(
      (next) => {
        if (!cancelled) setOptions(next);
      },
      (reason) => {
        if (!cancelled) setError(sharingErrorMessage(reason, "Could not load sharing settings"));
      },
    );
    const unsubscribeStatus = onAppEvent("sharing:status", (status) =>
      setSyncError(status.error || ""),
    );
    return () => {
      cancelled = true;
      unsubscribeStatus();
    };
  }, [loadAttempt]);
  const copyLink = async (id: string) => {
    try {
      await writeClipboardText(`${base}/s/${id}`);
      showToast({ message: "Link copied", type: "success" });
    } catch (reason) {
      showToast({
        message: sharingErrorMessage(reason, "Could not copy link"),
        type: "error",
      });
    }
  };
  const base = getServiceUrls().websiteBaseUrl;
  return (
    <SettingsView>
      {editing && options && (
        <ShareAccessDialog
          item={editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => void run()}
        />
      )}
      <Section title="Cloud Sessions">
        <SettingRow label="Sync Agent Sessions">
          <Switch
            aria-label="Sync agent sessions"
            checked={options?.sessionsEnabled ?? false}
            disabled={busy || !options}
            onChange={(enabled) => void run(() => setSessionSync(enabled))}
          />
        </SettingRow>
        <SettingRow label="Web Library">
          <Button
            variant="outline"
            onClick={() => void openExternalUrl(`${base}/dashboard/settings/sharing`)}
          >
            Open on web
          </Button>
        </SettingRow>
      </Section>
      <Section title="Shared Items">
        {!options && (
          <EmptyState
            variant="section"
            tone={error ? "error" : "neutral"}
            message={error || "Loading shared items…"}
            role={error ? "alert" : "status"}
            action={
              error
                ? { label: "Retry", onClick: () => setLoadAttempt((attempt) => attempt + 1) }
                : undefined
            }
          />
        )}
        {options?.items.filter((item) => item.visibility !== "private").length === 0 && (
          <EmptyState variant="section" message="No shared links" />
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
                <Button variant="outline" disabled={busy} onClick={() => void copyLink(item.id)}>
                  Copy link
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setEditing(item)}>
                  Access
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void openExternalUrl(`${base}/s/${item.id}`)}
                >
                  Open
                </Button>
                <Button
                  variant="outline"
                  tone="danger"
                  disabled={busy}
                  onClick={() => void run(() => revokeShare(item.id))}
                >
                  Revoke
                </Button>
              </div>
            </SettingRow>
          ))}
      </Section>
      {((error && options) || syncError) && (
        <Alert tone="error">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{error || syncError}</span>
            {error && (
              <Button variant="outline" disabled={busy} onClick={() => void run()}>
                Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </SettingsView>
  );
}
