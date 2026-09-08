import { ReleaseAssets } from "./release-assets";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { TagIcon } from "@/ui/icons";
import {
  ResourceContentSection,
  ResourceDetailLayout,
  ResourceDetailSection,
  ResourceDetailSidebar,
} from "@/ui/resource";
import GitHubMarkdown from "../../components/github-markdown";
import {
  GitHubMetaChip,
  GitHubResourceSummary,
  GitHubUserChip,
} from "../../components/github-resource-chips";
import type { Release } from "../types/github-delivery.types";
import { releaseTitle, safeDeliveryUrl } from "../utils/github-delivery";

export function ReleaseDetails({
  release,
  repoPath,
  onBusyChange,
}: {
  release: Release;
  repoPath: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const repositoryUrl = release.html_url.split("/releases")[0];
  const open = (value: string | null) => {
    const url = safeDeliveryUrl(value);
    if (url) void openUrl(url).catch((error) => toast.error(String(error)));
  };
  return (
    <ResourceDetailLayout
      sidebar={
        <ResourceDetailSidebar>
          <ResourceDetailSection label="Release">
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={release.draft ? "warning" : release.prerelease ? "accent" : "success"}
              >
                {release.draft ? "Draft" : release.prerelease ? "Prerelease" : "Published"}
              </Badge>
              {release.immutable && <Badge>Immutable</Badge>}
            </div>
          </ResourceDetailSection>
          <ResourceDetailSection label="Tag">
            <GitHubMetaChip
              mono
              onClick={() => open(`${repositoryUrl}/tree/${encodeURIComponent(release.tag_name)}`)}
            >
              {release.tag_name}
            </GitHubMetaChip>
          </ResourceDetailSection>
          <ResourceDetailSection label="Target">
            <span className="break-all font-mono">{release.target_commitish}</span>
          </ResourceDetailSection>
          {release.author && (
            <ResourceDetailSection label="Author">
              <GitHubUserChip login={release.author.login} avatarUrl={release.author.avatar_url} />
            </ResourceDetailSection>
          )}
          <ResourceDetailSection label={release.published_at ? "Published" : "Created"}>
            <time dateTime={release.published_at ?? release.created_at}>
              {new Date(release.published_at ?? release.created_at).toLocaleString()}
            </time>
          </ResourceDetailSection>
          <ResourceDetailSection label="Downloads">
            {release.assets
              .reduce((total, asset) => total + asset.download_count, 0)
              .toLocaleString()}{" "}
            across {release.assets.length} assets
          </ResourceDetailSection>
          {release.discussion_url && (
            <ResourceDetailSection label="Discussion">
              <Button variant="ghost" onClick={() => open(release.discussion_url)}>
                Open Discussion
              </Button>
            </ResourceDetailSection>
          )}
        </ResourceDetailSidebar>
      }
    >
      <div className="space-y-8">
        <GitHubResourceSummary
          title={releaseTitle(release)}
          icon={<TagIcon className="text-subtle-foreground" />}
          description={release.tag_name}
        />
        <ResourceContentSection title="Release notes">
          <GitHubMarkdown
            content={release.body || "No release notes provided."}
            repoPath={repoPath}
            repositoryUrl={repositoryUrl}
          />
        </ResourceContentSection>
        <ReleaseAssets release={release} repoPath={repoPath} onBusyChange={onBusyChange} />
      </div>
    </ResourceDetailLayout>
  );
}
