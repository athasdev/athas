import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import Badge, { type BadgeTone } from "@/ui/badge";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/ui/field";
import { BroadcastIcon, CopyIcon, OpenExternalIcon, StopIcon } from "@/ui/icons";
import Input from "@/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/ui/item";
import { tryWriteClipboardText } from "@/utils/clipboard";
import { openExternalUrl } from "@/utils/external-url";
import { detectLocalPorts } from "../services/detect-local-ports";
import { listPreviews } from "../services/previews-api";
import { previewsStoreDependencies, usePreviewsStore } from "../stores/previews.store";
import type { Preview, PreviewTunnelStatus } from "../types/previews.types";
import { describePreview, parsePortInput } from "../services/preview-display";

const STATUS: Record<PreviewTunnelStatus, { label: string; tone: BadgeTone }> = {
  connecting: { label: "Connecting", tone: "info" },
  open: { label: "Live", tone: "success" },
  reconnecting: { label: "Reconnecting", tone: "warning" },
  ended: { label: "Stopped", tone: "neutral" },
};

const previewKeys = {
  list: ["previews", "list"] as const,
  ports: ["previews", "detected-ports"] as const,
};

async function copyLink(url: string) {
  if (await tryWriteClipboardText(url)) toast.success("Preview link copied");
  else toast.error("Could not copy the link");
}

function PreviewRow({
  preview,
  status,
  requests,
}: {
  preview: Preview;
  status: PreviewTunnelStatus | null;
  requests: number;
}) {
  const queryClient = useQueryClient();
  const stopPreview = usePreviewsStore.use.actions().stopPreview;
  const stop = useMutation({
    mutationFn: () => stopPreview(preview.id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: previewKeys.list }),
    onError: (error) => toast.error(error.message),
  });
  const host = new URL(preview.url).host;

  return (
    <Item variant="muted">
      <ItemContent>
        <ItemTitle>
          <span className="truncate">{host}</span>
          {status ? <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge> : null}
        </ItemTitle>
        <ItemDescription>{describePreview(preview, requests)}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="ghost"
          iconOnly
          aria-label={`Copy link to ${host}`}
          onClick={() => void copyLink(preview.url)}
        >
          <CopyIcon />
        </Button>
        <Button
          variant="ghost"
          iconOnly
          aria-label={`Open ${host} in your browser`}
          onClick={() => void openExternalUrl(preview.url)}
        >
          <OpenExternalIcon />
        </Button>
        <Button
          variant="ghost"
          tone="danger"
          iconOnly
          aria-label={`Stop sharing ${host}`}
          disabled={stop.isPending}
          onClick={() => stop.mutate()}
        >
          <StopIcon />
        </Button>
      </ItemActions>
    </Item>
  );
}

function SharePreviews() {
  const queryClient = useQueryClient();
  const shared = usePreviewsStore.use.shared();
  const { shareLocalServer } = usePreviewsStore.use.actions();
  const [portInput, setPortInput] = useState("");
  const port = parsePortInput(portInput);

  const detected = useQuery({
    queryKey: previewKeys.ports,
    queryFn: () => detectLocalPorts(previewsStoreDependencies.fetch),
    staleTime: 10_000,
  });
  const remote = useQuery({
    queryKey: previewKeys.list,
    queryFn: listPreviews,
    refetchInterval: 15_000,
  });

  const share = useMutation({
    mutationFn: (value: number) => shareLocalServer(value),
    onSuccess: async (preview) => {
      setPortInput("");
      void queryClient.invalidateQueries({ queryKey: previewKeys.list });
      await copyLink(preview.url);
    },
    onError: (error) => toast.error(error.message),
  });

  const sharedEntries = Object.values(shared);
  const others = (remote.data ?? []).filter((preview) => preview.active && !shared[preview.id]);

  return (
    <div className="space-y-4">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (port !== null) share.mutate(port);
        }}
      >
        <Field>
          <FieldLabel htmlFor="preview-port">Port on localhost</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="preview-port"
              autoFocus
              inputMode="numeric"
              placeholder="5173"
              value={portInput}
              onChange={(event) => setPortInput(event.target.value)}
            />
            <Button type="submit" variant="accent" disabled={port === null || share.isPending}>
              <BroadcastIcon />
              {share.isPending ? "Sharing…" : "Share"}
            </Button>
          </div>
          <FieldDescription>
            {detected.data?.length
              ? "Servers answering on common dev ports:"
              : detected.isPending
                ? "Looking for running dev servers…"
                : "Start your dev server, then enter the port it listens on."}
          </FieldDescription>
          {detected.data?.length ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Detected ports">
              {detected.data.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  data-active={port === value}
                  onClick={() => setPortInput(String(value))}
                >
                  {value}
                </Button>
              ))}
            </div>
          ) : null}
        </Field>
      </form>

      {sharedEntries.length || others.length ? (
        <section className="space-y-2" aria-label="Active previews">
          <h3 className="font-medium text-foreground ui-text-sm">Active previews</h3>
          <ItemGroup className="gap-1.5">
            {sharedEntries.map((entry) => (
              <PreviewRow
                key={entry.preview.id}
                preview={entry.preview}
                status={entry.status}
                requests={entry.requests}
              />
            ))}
            {others.map((preview) => (
              <PreviewRow
                key={preview.id}
                preview={preview}
                status={null}
                requests={preview.requests}
              />
            ))}
          </ItemGroup>
        </section>
      ) : null}

      <p className="text-subtle-foreground ui-text-sm">
        Anyone with a link can open the preview until it expires after 8 hours or you stop it.
        Visitors see a notice with your name first.
      </p>
    </div>
  );
}

export function ShareLocalServerDialog() {
  const { closeDialog } = usePreviewsStore.use.actions();
  const { hasPreviews } = useProFeature();

  return (
    <Dialog title="Share Local Server" icon={BroadcastIcon} onClose={closeDialog}>
      {hasPreviews ? (
        <SharePreviews />
      ) : (
        <div className="space-y-3">
          <p className="text-foreground ui-text-sm">
            Preview links are part of Athas Pro. Share a dev server running on your computer, or an
            app a cloud agent is running, with a temporary link.
          </p>
          <Button
            type="button"
            variant="accent"
            onClick={() => void openExternalUrl("https://athas.dev/pricing")}
          >
            See plans
            <OpenExternalIcon />
          </Button>
        </div>
      )}
    </Dialog>
  );
}
