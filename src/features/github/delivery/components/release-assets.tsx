import { FieldError } from "@/ui/field";
import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { CopyIcon, DownloadIcon, UploadIcon, TrashIcon } from "@/ui/icons";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/ui/item";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { ResourceContentSection } from "@/ui/resource";
import { Spinner } from "@/ui/spinner";
import { writeClipboardText } from "@/utils/clipboard";
import type { Release, ReleaseAsset } from "../types/github-delivery.types";
import { formatAssetSize, safeDeliveryUrl } from "../utils/github-delivery";
import { notifyDeliveryChanged } from "../services/github-delivery-service";

export function ReleaseAssets({
  release,
  repoPath,
  onBusyChange,
}: {
  release: Release;
  repoPath: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ReleaseAsset | null>(null);
  const assets = release.assets.filter((asset) =>
    `${asset.name} ${asset.label ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  const begin = () => {
    inFlight.current = true;
    onBusyChange(true);
    setError(null);
  };
  const end = () => {
    inFlight.current = false;
    onBusyChange(false);
    setBusy(null);
  };
  const upload = async () => {
    if (inFlight.current) return;
    begin();
    setBusy("Choose assets");
    let uploaded = 0;
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: "Upload release assets",
      });
      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];
      for (const [index, filePath] of files.entries()) {
        setBusy(`Uploading ${index + 1} of ${files.length} · ${filePath.split(/[\\/]/).pop()}`);
        await invoke("github_upload_release_asset", { repoPath, id: release.id, filePath });
        uploaded++;
      }
      toast.success(`${uploaded} ${uploaded === 1 ? "asset" : "assets"} uploaded`);
    } catch (error) {
      setError(`${uploaded ? `${uploaded} uploaded before the error. ` : ""}${String(error)}`);
    } finally {
      if (uploaded) notifyDeliveryChanged("releases", repoPath, release.id);
      end();
    }
  };
  const remove = async () => {
    if (!deleting || inFlight.current) return;
    begin();
    setBusy("Deleting asset");
    try {
      await invoke("github_delete_release_asset", { repoPath, assetId: deleting.id });
      notifyDeliveryChanged("releases", repoPath, release.id);
      toast.success("Asset deleted");
      setDeleting(null);
    } catch (error) {
      setError(String(error));
    } finally {
      end();
    }
  };
  const browse = (value: string | null) => {
    const url = safeDeliveryUrl(value);
    if (url) void openUrl(url).catch((error) => toast.error(String(error)));
  };
  return (
    <ResourceContentSection title={`Assets (${release.assets.length})`}>
      <div className="flex flex-wrap items-center gap-2">
        {release.assets.length > 5 && (
          <Input
            aria-label="Filter release assets"
            placeholder="Filter assets…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        {!release.immutable && (
          <Button disabled={Boolean(busy)} onClick={() => void upload()}>
            <UploadIcon /> Upload Assets
          </Button>
        )}
        {busy && (
          <span
            role="status"
            className="ui-text-sm flex min-w-0 items-center gap-2 text-subtle-foreground"
          >
            <Spinner compact />
            <span className="truncate">{busy}</span>
          </span>
        )}
      </div>
      {error && !deleting && <FieldError className="break-words">{error}</FieldError>}
      <ItemGroup>
        {assets.map((asset) => (
          <Item role="listitem" key={asset.id}>
            <ItemMedia>
              <DownloadIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle title={asset.name}>{asset.name}</ItemTitle>
              <ItemDescription>
                {formatAssetSize(asset.size)} · {asset.download_count.toLocaleString()} downloads
                {asset.state !== "uploaded" ? ` · ${asset.state}` : ""}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              {asset.digest && (
                <Button
                  variant="ghost"
                  iconOnly
                  tooltip="Copy asset digest"
                  onClick={() => {
                    void writeClipboardText(asset.digest!);
                  }}
                >
                  <CopyIcon />
                </Button>
              )}
              <Button
                variant="ghost"
                iconOnly
                tooltip={`Copy link to ${asset.name}`}
                onClick={() => {
                  void writeClipboardText(asset.browser_download_url);
                }}
              >
                <CopyIcon />
              </Button>
              <Button
                variant="ghost"
                iconOnly
                tooltip={`Download ${asset.name} in browser`}
                disabled={
                  asset.state !== "uploaded" || !safeDeliveryUrl(asset.browser_download_url)
                }
                onClick={() => browse(asset.browser_download_url)}
              >
                <DownloadIcon />
              </Button>
              {!release.immutable && (
                <Button
                  variant="danger"
                  iconOnly
                  tooltip={`Delete ${asset.name}`}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setError(null);
                    setDeleting(asset);
                  }}
                >
                  <TrashIcon />
                </Button>
              )}
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {assets.length === 0 && (
        <Item>
          <ItemDescription>
            {release.assets.length ? "No matching assets." : "No uploaded assets."}
          </ItemDescription>
        </Item>
      )}
      <div className="flex flex-wrap gap-2">
        {release.zipball_url && (
          <Button variant="ghost" onClick={() => browse(release.zipball_url)}>
            <DownloadIcon /> Source ZIP
          </Button>
        )}
        {release.tarball_url && (
          <Button variant="ghost" onClick={() => browse(release.tarball_url)}>
            <DownloadIcon /> Source tar.gz
          </Button>
        )}
      </div>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete asset?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} will be permanently removed from this release.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <FieldError className="break-words">{error}</FieldError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busy)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={Boolean(busy)}
              onClick={() => void remove()}
            >
              {busy && <Spinner compact />}Delete Asset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ResourceContentSection>
  );
}
