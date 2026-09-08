import { openDeploymentLog } from "../services/open-deployment-log";
import { Checkbox } from "@/ui/checkbox";
import { Field, FieldLabel } from "@/ui/field";
import { FieldError } from "@/ui/field";
import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { GitHubDeliveryContent } from "@/features/panes/types/pane-content.types";
import { openCommitDiffBuffer } from "@/features/git/utils/open-commit-diff-buffer";
import { resolveProjectGitHubRepository } from "@/features/views/lib/view-github";
import { ViewerErrorState, ViewerLoadingState } from "@/features/viewer/components/viewer-state";
import { Button } from "@/ui/button";
import { ArrowClockwiseIcon, CopyIcon, OpenExternalIcon, RocketIcon, TagIcon } from "@/ui/icons";
import {
  ResourceViewer,
  ResourceViewerActionsMenu,
  ResourceViewerHeader,
  ResourceViewerTitle,
} from "@/ui/resource";
import { DropdownMenuItem } from "@/ui/dropdown";
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
import { Spinner } from "@/ui/spinner";
import { writeClipboardText } from "@/utils/clipboard";
import { useDeliveryDetail } from "../hooks/use-delivery-detail";
import { deliveryDetailCache, notifyDeliveryChanged } from "../services/github-delivery-service";
import {
  deliveryBufferPath,
  deliveryKey,
  isRelease,
  releaseTitle,
  safeDeliveryUrl,
} from "../utils/github-delivery";
import type { Release } from "../types/github-delivery.types";
import { ReleaseDetails } from "./release-details";
import { DeploymentDetails } from "./deployment-details";
import { ReleaseEditor } from "./release-editor";

type Confirmation = "publish" | "delete" | "deactivate";
const confirmationText = {
  publish: {
    title: "Publish release?",
    description:
      "This makes the draft and its assets available to the repository’s audience and may notify watchers.",
    action: "Publish Release",
  },
  delete: {
    title: "Delete release?",
    description: "The release and its uploaded assets will be deleted. The Git tag will remain.",
    action: "Delete Release",
  },
  deactivate: {
    title: "Mark deployment inactive?",
    description:
      "This changes its status on GitHub. It does not stop, roll back, or remove the running environment.",
    action: "Mark Inactive",
  },
};

export default function GitHubDeliveryViewer({ buffer }: { buffer: GitHubDeliveryContent }) {
  const { kind, repoPath, resourceId } = buffer;
  const active = useBufferStore((state) => state.activeBufferId === buffer.id);
  const { updateBuffer, closeBuffer } = useBufferStore.use.actions();
  const { data, loading, error, refresh } = useDeliveryDetail(kind, repoPath, resourceId, active);
  const [editing, setEditing] = useState(resourceId === undefined && kind === "releases");
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const latestId = useId();
  const [makeLatest, setMakeLatest] = useState(false);
  const [assetBusy, setAssetBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [repositoryUrl, setRepositoryUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void resolveProjectGitHubRepository(repoPath)
      .then((repository) => {
        if (!cancelled)
          setRepositoryUrl(
            repository ? `https://github.com/${repository.owner}/${repository.repo}` : null,
          );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repoPath]);
  useEffect(() => {
    if (
      data &&
      buffer.name !== (isRelease(data) ? releaseTitle(data) : `${data.environment} · ${data.ref}`)
    )
      updateBuffer({
        ...buffer,
        name: isRelease(data) ? releaseTitle(data) : `${data.environment} · ${data.ref}`,
      });
  }, [buffer, data, updateBuffer]);
  const open = (value?: string | null) => {
    const url = safeDeliveryUrl(value);
    if (url) void openUrl(url).catch((error) => toast.error(String(error)));
  };
  const onSaved = (release: Release) => {
    notifyDeliveryChanged("releases", repoPath, release.id);
    deliveryDetailCache.set(deliveryKey("releases", repoPath, release.id), release);
    updateBuffer({
      ...buffer,
      resourceId: release.id,
      path: deliveryBufferPath("releases", repoPath, release.id),
      name: releaseTitle(release),
    });
    setEditing(false);
    refresh();
    toast.success(release.draft ? "Release draft saved" : "Release updated");
  };
  const mutate = async () => {
    if (!confirm || !data || busy.current) return;
    busy.current = true;
    setPending(true);
    setActionError(null);
    try {
      await invoke(
        confirm === "publish"
          ? "github_publish_release"
          : confirm === "delete"
            ? "github_delete_release"
            : "github_deactivate_deployment",
        {
          repoPath,
          id: data.id,
          ...(confirm === "publish"
            ? { makeLatest: makeLatest && isRelease(data) && !data.prerelease }
            : {}),
        },
      );
      notifyDeliveryChanged(kind, repoPath, data.id);
      if (confirm === "delete") closeBuffer(buffer.id);
      toast.success(
        confirm === "publish"
          ? "Release published"
          : confirm === "delete"
            ? "Release deleted"
            : "Deployment marked inactive",
      );
      setConfirm(null);
    } catch (error) {
      setActionError(String(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  if (!editing && !data) {
    return error ? (
      <ViewerErrorState message={error} actionLabel="Try again" onAction={refresh} />
    ) : resourceId === undefined ? (
      <ViewerErrorState message="No deployment selected." />
    ) : (
      <ViewerLoadingState label={`Loading ${kind === "releases" ? "release" : "deployment"}`} />
    );
  }
  const release = data && isRelease(data) ? data : undefined;
  const deployment = data && !isRelease(data) ? data : undefined;
  const title = editing
    ? release
      ? "Edit Release"
      : "New Release"
    : release
      ? releaseTitle(release)
      : (deployment?.environment ?? "Deployment");
  const browserUrl = release?.html_url ?? (repositoryUrl ? `${repositoryUrl}/deployments` : null);
  const environmentUrl = safeDeliveryUrl(deployment?.statuses[0]?.environment_url);
  const logUrl = safeDeliveryUrl(deployment?.statuses[0]?.log_url);
  return (
    <ResourceViewer
      header={
        <ResourceViewerHeader
          title={
            <ResourceViewerTitle
              kind={kind === "releases" ? "Release" : "Deployment"}
              title={title}
            />
          }
          leading={kind === "releases" ? <TagIcon /> : <RocketIcon />}
          actions={
            !editing && (
              <>
                {environmentUrl && (
                  <Button variant="accent" onClick={() => open(environmentUrl)}>
                    <OpenExternalIcon /> Open Environment
                  </Button>
                )}
                {logUrl && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void openDeploymentLog(logUrl).catch((error) => toast.error(String(error)));
                    }}
                  >
                    Logs
                  </Button>
                )}
                {release?.draft && (
                  <Button
                    variant="accent"
                    disabled={pending || assetBusy}
                    onClick={() => {
                      setActionError(null);
                      setConfirm("publish");
                    }}
                  >
                    Publish
                  </Button>
                )}
                {release && !release.immutable && (
                  <Button
                    variant="ghost"
                    disabled={pending || assetBusy}
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  variant="ghost"
                  iconOnly
                  tooltip="Refresh"
                  disabled={loading || pending || assetBusy}
                  onClick={refresh}
                >
                  {loading ? <Spinner compact /> : <ArrowClockwiseIcon />}
                </Button>
                <ResourceViewerActionsMenu label="More actions">
                  <DropdownMenuItem disabled={!browserUrl} onClick={() => open(browserUrl)}>
                    <OpenExternalIcon /> Open on GitHub
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      void writeClipboardText(release?.tag_name ?? deployment?.sha ?? "");
                    }}
                  >
                    <CopyIcon /> {release ? "Copy Tag" : "Copy Commit SHA"}
                  </DropdownMenuItem>
                  {deployment && (
                    <DropdownMenuItem
                      onClick={() => {
                        void openCommitDiffBuffer({
                          repoPath,
                          commitHash: deployment.sha,
                          message: deployment.description ?? undefined,
                        })
                          .then((id) => {
                            if (!id)
                              toast.info(
                                "No local changes found for this commit. Fetch the repository to inspect it.",
                              );
                          })
                          .catch((error) => toast.error(String(error)));
                      }}
                    >
                      View Commit Changes
                    </DropdownMenuItem>
                  )}
                  {deployment && repositoryUrl && (
                    <DropdownMenuItem
                      onClick={() =>
                        open(`${repositoryUrl}/commit/${encodeURIComponent(deployment.sha)}`)
                      }
                    >
                      Open Commit on GitHub
                    </DropdownMenuItem>
                  )}
                  {deployment && deployment.statuses[0]?.state !== "inactive" && (
                    <DropdownMenuItem
                      disabled={pending || assetBusy}
                      onClick={() => {
                        setActionError(null);
                        setConfirm("deactivate");
                      }}
                    >
                      Mark Inactive
                    </DropdownMenuItem>
                  )}
                  {release && !release.immutable && (
                    <DropdownMenuItem
                      disabled={pending || assetBusy}
                      onClick={() => {
                        setActionError(null);
                        setConfirm("delete");
                      }}
                    >
                      Delete Release…
                    </DropdownMenuItem>
                  )}
                </ResourceViewerActionsMenu>
              </>
            )
          }
        />
      }
    >
      {error && data && (
        <ViewerErrorState
          layout="section"
          message={`Could not refresh. Showing previously loaded data. ${error}`}
          actionLabel="Try again"
          onAction={refresh}
        />
      )}
      {editing ? (
        <ReleaseEditor
          key={release?.id ?? "new"}
          repoPath={repoPath}
          release={release}
          onSave={onSaved}
          onCancel={release ? () => setEditing(false) : undefined}
        />
      ) : release ? (
        <ReleaseDetails release={release} repoPath={repoPath} onBusyChange={setAssetBusy} />
      ) : deployment ? (
        <DeploymentDetails deployment={deployment} />
      ) : null}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm && confirmationText[confirm].title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && confirmationText[confirm].description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirm === "publish" && release && !release.prerelease && (
            <Field orientation="horizontal">
              <Checkbox
                id={latestId}
                checked={makeLatest}
                disabled={pending}
                onCheckedChange={setMakeLatest}
              />
              <FieldLabel htmlFor={latestId}>Set as latest release</FieldLabel>
            </Field>
          )}
          {actionError && <FieldError className="break-words">{actionError}</FieldError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending || assetBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "delete" ? "danger" : "accent"}
              disabled={pending || assetBusy}
              onClick={() => void mutate()}
            >
              {pending && <Spinner compact />}
              {confirm && confirmationText[confirm].action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ResourceViewer>
  );
}
