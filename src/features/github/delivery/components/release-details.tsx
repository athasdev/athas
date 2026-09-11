import type { ReactNode } from "react";
import { ReleaseAssets } from "./release-assets";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { TagIcon } from "@/ui/icons";
import { ResourceSection, ResourceSidebarLayout, ResourceSummary } from "@/ui/resource";
import GitHubMarkdown from "../../components/github-markdown";
import { GitHubMetaChip, GitHubUserChip } from "../../components/github-chips";
import { getTimeAgo } from "../../utils/github-viewer-utils";
import type { Release } from "../types/github-delivery.types";
import { releaseTitle, safeDeliveryUrl } from "../utils/github-delivery";

function openInBrowser(value: string | null) {
  const url = safeDeliveryUrl(value);
  if (url) void openUrl(url).catch((error) => toast.error(String(error)));
}

function repositoryUrlOf(release: Release) {
  return release.html_url.split("/releases")[0];
}

export function ReleaseSummary({ release, actions }: { release: Release; actions?: ReactNode }) {
  const repositoryUrl = repositoryUrlOf(release);
  const timestamp = release.published_at ?? release.created_at;
  return (
    <ResourceSummary
      actions={actions}
      icon={<TagIcon className="text-subtle-foreground" />}
      title={<span className="block truncate">{releaseTitle(release)}</span>}
      badges={
        <>
          <Badge variant={release.draft ? "warning" : release.prerelease ? "accent" : "success"}>
            {release.draft ? "Draft" : release.prerelease ? "Prerelease" : "Published"}
          </Badge>
          {release.immutable ? <Badge>Immutable</Badge> : null}
        </>
      }
      meta={
        <>
          <GitHubMetaChip
            mono
            icon={<TagIcon />}
            title={`Open tag ${release.tag_name} on GitHub`}
            onClick={() =>
              openInBrowser(`${repositoryUrl}/tree/${encodeURIComponent(release.tag_name)}`)
            }
          >
            {release.tag_name}
          </GitHubMetaChip>
          {release.author ? (
            <GitHubUserChip login={release.author.login} avatarUrl={release.author.avatar_url} />
          ) : null}
          <GitHubMetaChip title={new Date(timestamp).toLocaleString()}>
            {`${release.published_at ? "Published" : "Created"} ${getTimeAgo(timestamp)}`}
          </GitHubMetaChip>
        </>
      }
    />
  );
}

export function ReleaseDetails({
  release,
  repoPath,
  onBusyChange,
}: {
  release: Release;
  repoPath: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const repositoryUrl = repositoryUrlOf(release);
  const downloadCount = release.assets.reduce((total, asset) => total + asset.download_count, 0);
  return (
    <ResourceSidebarLayout
      sidebar={
        <>
          <ResourceSection title="Target">
            <span className="break-all font-mono">{release.target_commitish}</span>
          </ResourceSection>
          <ResourceSection title="Downloads">
            {`${downloadCount.toLocaleString()} across ${release.assets.length} assets`}
          </ResourceSection>
          {release.discussion_url ? (
            <ResourceSection title="Discussion">
              <Button variant="ghost" onClick={() => openInBrowser(release.discussion_url)}>
                Open Discussion
              </Button>
            </ResourceSection>
          ) : null}
        </>
      }
    >
      <div className="space-y-8">
        <ResourceSection title="Release notes">
          <GitHubMarkdown
            content={release.body || "No release notes provided."}
            repoPath={repoPath}
            repositoryUrl={repositoryUrl}
          />
        </ResourceSection>
        <ReleaseAssets release={release} repoPath={repoPath} onBusyChange={onBusyChange} />
      </div>
    </ResourceSidebarLayout>
  );
}
