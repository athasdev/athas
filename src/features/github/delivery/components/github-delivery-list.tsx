import { writeSidebarResourceDragData } from "@/features/sidebar/utils/sidebar-resource-drag";
import { useDeferredValue, useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { GitHubSidebarRow } from "../../components/github-sidebar-row";
import { useGitHubStore } from "../../stores/github.store";
import { getSidebarTime } from "../../utils/github-viewer-utils";
import { SidebarScrollArea, SidebarSection } from "@/ui/sidebar";
import { EmptyState } from "@/ui/empty";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { TagIcon, RocketIcon, CopyIcon, OpenExternalIcon } from "@/ui/icons";
import { ContextMenuPopup, createContextMenuGroups } from "@/ui/context-menu";
import { useDropdownMenu, type MenuItem } from "@/ui/dropdown";
import { writeClipboardText } from "@/utils/clipboard";
import { useDeliveryList } from "../hooks/use-delivery-list";
import { loadDeliveryDetail } from "../services/github-delivery-service";
import type { DeliveryKind, DeliveryResource } from "../types/github-delivery.types";
import {
  deploymentState,
  groupDelivery,
  isRelease,
  matchesDelivery,
  releaseTitle,
  safeDeliveryUrl,
} from "../utils/github-delivery";

export default function GitHubDeliveryList({
  kind,
  repoPath,
  filter,
  searchQuery,
  refreshNonce,
}: {
  kind: DeliveryKind;
  repoPath: string;
  filter: string;
  searchQuery: string;
  refreshNonce: number;
}) {
  const authenticated = useGitHubStore.use.isAuthenticated();
  const { items, loading, error, hasMore, refresh, loadMore } = useDeliveryList(
    kind,
    repoPath,
    authenticated,
    refreshNonce,
  );
  const openContent = useBufferStore.use.actions().openContent;
  const activeId = useBufferStore((state) => {
    const buffer = state.buffers.find((item) => item.id === state.activeBufferId);
    return buffer?.type === "githubDelivery" && buffer.kind === kind && buffer.repoPath === repoPath
      ? buffer.resourceId
      : undefined;
  });
  const query = useDeferredValue(searchQuery);
  const groups = useMemo(
    () => groupDelivery(items.filter((item) => matchesDelivery(item, filter, query))),
    [items, filter, query],
  );
  const menu = useDropdownMenu<DeliveryResource>();
  const select = (item: DeliveryResource) =>
    openContent({
      type: "githubDelivery",
      kind,
      repoPath,
      resourceId: item.id,
      name: isRelease(item) ? releaseTitle(item) : `${item.environment} · ${item.ref}`,
    });
  const selected = menu.data;
  const selectedUrl =
    selected &&
    safeDeliveryUrl(
      isRelease(selected) ? selected.html_url : selected.statuses[0]?.environment_url,
    );
  const menuItems: MenuItem[] = selected
    ? [
        {
          id: "open",
          label: "Open Details",
          icon: kind === "releases" ? <TagIcon /> : <RocketIcon />,
          onClick: () => select(selected),
        },
        {
          id: "copy",
          label: isRelease(selected) ? "Copy Tag" : "Copy Commit SHA",
          icon: <CopyIcon />,
          onClick: () => {
            void writeClipboardText(isRelease(selected) ? selected.tag_name : selected.sha);
          },
        },
        ...(selectedUrl
          ? [
              {
                id: "browser",
                label: isRelease(selected) ? "Open on GitHub" : "Open Environment",
                icon: <OpenExternalIcon />,
                onClick: () => {
                  void openUrl(selectedUrl);
                },
              },
            ]
          : []),
      ]
    : [];
  return (
    <SidebarScrollArea className="min-h-0 flex-1">
      {error && (
        <EmptyState
          layout="sidebar"
          tone="error"
          role="alert"
          message={error}
          action={{ label: "Try again", onClick: refresh, disabled: loading }}
        />
      )}
      {loading && items.length === 0 ? (
        <EmptyState
          layout="sidebar"
          message={<Spinner label={`Loading ${kind}`} showLabel compact />}
        />
      ) : groups.length === 0 && !error ? (
        <EmptyState
          layout="sidebar"
          message={items.length ? `No matching ${kind}` : `No ${kind} yet`}
        />
      ) : (
        groups.map((group) => (
          <SidebarSection
            forceExpanded={searchQuery.trim().length > 0}
            key={group.title}
            title={group.title}
            count={group.items.length}
          >
            {group.items.map((item) => {
              const release = isRelease(item);
              const status = release
                ? {
                    label: item.draft ? "Draft" : item.prerelease ? "Prerelease" : "Published",
                    tone: item.draft
                      ? ("warning" as const)
                      : item.prerelease
                        ? ("accent" as const)
                        : ("success" as const),
                  }
                : deploymentState(item);
              const title = release ? releaseTitle(item) : item.ref;
              return (
                <GitHubSidebarRow
                  key={item.id}
                  draggable
                  onDragStart={(event) =>
                    writeSidebarResourceDragData(event.dataTransfer, {
                      type: "github-delivery",
                      kind,
                      repoPath,
                      resourceId: item.id,
                      name: title,
                    })
                  }
                  title={title}
                  description={
                    release
                      ? `${item.tag_name} · ${status.label}`
                      : `${status.label} · ${item.sha.slice(0, 7)}`
                  }
                  active={item.id === activeId}
                  onClick={() => select(item)}
                  onContextMenu={(event) => {
                    event.stopPropagation();
                    menu.open(event, item);
                  }}
                  onPrefetch={() => {
                    void loadDeliveryDetail(kind, repoPath, item.id).catch(() => undefined);
                  }}
                  leading={release ? <TagIcon /> : <RocketIcon />}
                  trailing={getSidebarTime(
                    release
                      ? (item.published_at ?? item.created_at)
                      : (item.statuses[0]?.created_at ?? item.created_at),
                  )}
                  preview={{
                    title,
                    subtitle: release ? item.tag_name : (item.description ?? item.environment),
                    badges: [{ label: status.label, tone: status.tone }],
                    details: release
                      ? [
                          { label: "Target", value: item.target_commitish, mono: true },
                          { label: "Assets", value: String(item.assets.length) },
                          {
                            label: "Downloads",
                            value: item.assets
                              .reduce((sum, asset) => sum + asset.download_count, 0)
                              .toLocaleString(),
                          },
                          { label: "Author", value: item.author?.login },
                        ]
                      : [
                          { label: "Environment", value: item.environment },
                          { label: "Commit", value: item.sha.slice(0, 7), mono: true },
                          { label: "Creator", value: item.creator?.login },
                          {
                            label: "Status",
                            value: item.status_error ?? item.statuses[0]?.description,
                          },
                        ],
                  }}
                />
              );
            })}
          </SidebarSection>
        ))
      )}
      {items.length > 0 && (
        <div className="flex justify-center p-2">
          {hasMore ? (
            <Button variant="ghost" disabled={loading} onClick={loadMore}>
              {loading ? <Spinner compact /> : null} Load More
            </Button>
          ) : null}
        </div>
      )}
      <ContextMenuPopup
        isOpen={menu.isOpen}
        point={menu.position}
        groups={createContextMenuGroups(menuItems)}
        onClose={menu.close}
      />
    </SidebarScrollArea>
  );
}
