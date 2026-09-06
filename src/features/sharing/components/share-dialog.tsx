import Switch from "@/ui/switch";
import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { SharePreview } from "./share-preview";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import { writeClipboardText } from "@/utils/clipboard";
import { OPEN_SHARE_EVENT } from "../services/open-share";
import { createShare, fetchShareOptions, revokeShare } from "../services/share-api";
import type { ShareDraft, ShareInput, ShareOptions } from "../types/share.types";

function ShareSnapshotDialog({ draft, onClose }: { draft: ShareDraft; onClose: () => void }) {
  const [live, setLive] = useState(false);
  const [visibility, setVisibility] = useState<ShareInput["visibility"]>("public");
  const [emails, setEmails] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [options, setOptions] = useState<ShareOptions | null>(null);
  const [result, setResult] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void fetchShareOptions()
      .then((value) => {
        if (!cancelled) setOptions(value);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "Could not load sharing options.");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const restricted = visibility !== "public";
  const canCreate = Boolean(
    draft.content &&
    draft.content.length <= 500_000 &&
    (!restricted || options?.pro) &&
    (visibility !== "email" || emails.trim()) &&
    (visibility !== "organization" || workspaceId),
  );
  const copy = async (url: string) => {
    try {
      await writeClipboardText(url);
      setCopied(true);
    } catch {
      setError("Link created. Copy the URL below manually.");
    }
  };
  const create = async () => {
    if (inFlight.current || !canCreate) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const share = await createShare({
        ...draft,
        live,
        requestId: requestId.current,
        visibility,
        emails: visibility === "email" ? emails.split(/[,;\s]+/).filter(Boolean) : [],
        workspaceId: visibility === "organization" ? Number(workspaceId) : null,
      });
      setResult(share);
      await copy(share.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create link.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!result || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await revokeShare(result.id);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke link.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Share to web"
      onClose={() => {
        if (!busy) onClose();
      }}
      size="lg"
      footer={
        result ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => void revoke()}>
              Revoke link
            </Button>
            <Button onClick={() => void openUrl(result.url)}>Open in browser</Button>
            <Button onClick={() => void copy(result.url)}>{copied ? "Copied" : "Copy link"}</Button>
          </>
        ) : (
          <Button disabled={busy || !canCreate} onClick={() => void create()}>
            {busy ? "Creating link…" : "Create link"}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <FieldDescription>Share a read-only view on athas.dev.</FieldDescription>
        <Field>
          <FieldLabel>Content</FieldLabel>
          <p className="font-medium ui-text-sm">{draft.title}</p>
          <SharePreview draft={draft} />
        </Field>
        {!draft.content && <FieldDescription>There is no text to share.</FieldDescription>}
        {draft.content.length > 500_000 && (
          <FieldDescription>
            Select less text. Snapshots support up to 500,000 characters.
          </FieldDescription>
        )}
        {!result ? (
          <>
            {draft.kind !== "snippet" && draft.sourceId && (
              <Field>
                <div className="flex items-center justify-between gap-4">
                  <FieldLabel htmlFor="share-live">Keep this link up to date</FieldLabel>
                  <Switch
                    id="share-live"
                    checked={live}
                    disabled={busy}
                    onChange={(value) => {
                      setLive(value);
                      requestId.current = crypto.randomUUID();
                    }}
                  />
                </div>
                <FieldDescription>
                  New responses and edits appear here while Athas is running. You can pause this in
                  Settings.
                </FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel>Visibility</FieldLabel>
              <Select
                aria-label="Visibility"
                width="full"
                variant="default"
                value={visibility}
                disabled={busy}
                onChange={(value) => {
                  setVisibility(value as ShareInput["visibility"]);
                  requestId.current = crypto.randomUUID();
                }}
                options={[
                  { value: "public", label: "Public — anyone with the link" },
                  { value: "email", label: "Specific emails · Pro" },
                  { value: "organization", label: "Organization · Pro" },
                ]}
              />
            </Field>
            {restricted && !options?.pro ? (
              <Field>
                <FieldDescription>
                  Email and organization restrictions require Athas Pro.
                </FieldDescription>
                <Button onClick={() => void openUrl("https://athas.dev/pricing")}>
                  View Pro plan
                </Button>
              </Field>
            ) : null}
            {visibility === "email" && options?.pro ? (
              <Field>
                <FieldLabel htmlFor="share-emails">Allowed emails</FieldLabel>
                <Input
                  id="share-emails"
                  value={emails}
                  disabled={busy}
                  onChange={(event) => {
                    setEmails(event.target.value);
                    requestId.current = crypto.randomUUID();
                  }}
                  placeholder="alex@example.com, sam@example.com"
                />
                <FieldDescription>
                  Recipients sign in with Google or GitHub to verify their email.
                </FieldDescription>
              </Field>
            ) : null}
            {visibility === "organization" && options?.pro ? (
              <Field>
                <FieldLabel>Organization</FieldLabel>
                <Select
                  aria-label="Organization"
                  width="full"
                  variant="default"
                  value={workspaceId}
                  disabled={busy}
                  onChange={(value) => {
                    setWorkspaceId(value);
                    requestId.current = crypto.randomUUID();
                  }}
                  options={options.organizations.map((organization) => ({
                    value: String(organization.id),
                    label: organization.name,
                  }))}
                />
                <FieldDescription>
                  {options.organizations.length
                    ? "Only active members can view this snapshot."
                    : "Join an organization to use this visibility."}
                </FieldDescription>
              </Field>
            ) : null}
          </>
        ) : (
          <Field>
            <FieldLabel htmlFor="share-url">Share link</FieldLabel>
            <Input
              id="share-url"
              value={result.url}
              readOnly
              onFocus={(event) => event.target.select()}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-destructive ui-text-sm">
            {error === "Not authenticated"
              ? "Sign in to your Athas account in Settings, then reopen Share."
              : error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function ShareDialog() {
  const [draft, setDraft] = useState<ShareDraft | null>(null);
  useEffect(() => {
    const open = (event: Event) => setDraft((event as CustomEvent<ShareDraft>).detail);
    window.addEventListener(OPEN_SHARE_EVENT, open);
    return () => window.removeEventListener(OPEN_SHARE_EVENT, open);
  }, []);
  return draft ? <ShareSnapshotDialog draft={draft} onClose={() => setDraft(null)} /> : null;
}
