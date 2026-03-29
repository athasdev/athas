import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import Tooltip from "@/ui/tooltip";
import type { PullRequestDetails } from "../types/github";

interface PRViewerHeaderProps {
  pr: PullRequestDetails;
  activeView: "activity" | "files";
  changesSummary: string;
  checksSummary: string;
  reviewerLogins: string[];
  reviewSummary: string | null;
  metaItems: string[];
  isRefreshingDetails: boolean;
  onRefresh: () => void;
  onCheckout: () => void;
  onOpenInBrowser: () => void;
  onCopyPRLink: () => void;
  onCopyBranchName: () => void;
  onToggleFilesView: () => void;
}

interface OverviewFieldProps {
  icon?: ReactNode;
  children: ReactNode;
}

function OverviewField({ icon, children }: OverviewFieldProps) {
  return (
    <div className="ui-font ui-text-sm flex min-w-0 items-center gap-2 text-text-lighter">
      {icon ? <span className="shrink-0 text-text-lighter">{icon}</span> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function PRViewerHeader({
  pr,
  activeView,
  changesSummary,
  checksSummary,
  reviewerLogins,
  reviewSummary,
  metaItems,
  isRefreshingDetails,
  onRefresh,
  onCheckout,
  onOpenInBrowser,
  onCopyPRLink,
  onCopyBranchName,
  onToggleFilesView,
}: PRViewerHeaderProps) {
  return (
    <div className="shrink-0 px-3 py-4 @sm:px-5">
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start @3xl:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="ui-font ui-text-lg leading-tight font-medium text-text">{pr.title}</h1>
            <div className="ui-font ui-text-sm mt-1 flex flex-wrap items-center gap-x-2 text-text-lighter">
              <span>{`athas#${pr.number}`}</span>
              <span>&middot;</span>
              <span className="inline-flex min-w-0 max-w-full items-center rounded-md bg-secondary-bg/80 px-1.5 py-0.5 font-mono text-text-lighter">
                <span className="min-w-0 truncate">{pr.baseRef}</span>
                <span className="shrink-0 px-1">&larr;</span>
                <span className="min-w-0 truncate">{pr.headRef}</span>
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Tooltip content="Refresh PR data" side="bottom">
              <Button
                onClick={onRefresh}
                disabled={isRefreshingDetails}
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh PR data"
              >
                <RefreshCw className={isRefreshingDetails ? "animate-spin" : ""} />
              </Button>
            </Tooltip>
            <Tooltip content="Checkout PR branch" side="bottom">
              <Button
                onClick={onCheckout}
                variant="ghost"
                size="icon-sm"
                aria-label="Checkout PR branch"
              >
                <GitBranch />
              </Button>
            </Tooltip>
            <Tooltip content="Open on GitHub" side="bottom">
              <Button
                onClick={onOpenInBrowser}
                variant="ghost"
                size="icon-sm"
                aria-label="Open pull request in browser"
              >
                <ExternalLink />
              </Button>
            </Tooltip>
            <Tooltip content="Copy PR link" side="bottom">
              <Button
                onClick={onCopyPRLink}
                variant="ghost"
                size="icon-sm"
                aria-label="Copy PR link"
              >
                <Copy />
              </Button>
            </Tooltip>
            <Tooltip content="Copy branch name" side="bottom">
              <Button
                onClick={onCopyBranchName}
                variant="ghost"
                size="icon-sm"
                aria-label="Copy branch name"
              >
                <GitBranch />
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <OverviewField>
            <span className="inline-flex min-w-0 items-center gap-2">
              <img
                src={
                  pr.author.avatarUrl ||
                  `https://github.com/${encodeURIComponent(pr.author.login || "github")}.png?size=32`
                }
                alt={pr.author.login}
                className="size-4 shrink-0 rounded-full bg-secondary-bg"
                loading="lazy"
              />
              <span className="truncate text-text-light">{pr.author.login}</span>
            </span>
          </OverviewField>

          <Button
            type="button"
            onClick={onToggleFilesView}
            variant="ghost"
            size="sm"
            active={activeView === "files"}
            className="h-auto min-w-0 rounded-md px-1.5 py-1 text-left"
          >
            <span className="shrink-0 text-text-lighter">
              <FileCode2 />
            </span>
            <span className="text-text-lighter">Changes</span>
            <span className="text-text-light">{changesSummary}</span>
          </Button>

          <OverviewField icon={<Check />}>
            {pr.statusChecks?.length > 0 && <CheckCircle2 className="mr-1 inline text-green-500" />}
            <span className="text-text-light">{checksSummary}</span>
          </OverviewField>

          <OverviewField icon={<GitPullRequest />}>
            {pr.reviewRequests?.length > 0 ? (
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="text-text-lighter">
                  {reviewSummary ? `${reviewSummary} · reviewers` : "Reviewers"}
                </span>
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  {pr.reviewRequests.slice(0, 3).map((reviewer) => (
                    <img
                      key={reviewer.login}
                      src={
                        reviewer.avatarUrl ||
                        `https://github.com/${encodeURIComponent(reviewer.login || "github")}.png?size=32`
                      }
                      alt={reviewer.login}
                      className="size-4 shrink-0 rounded-full bg-secondary-bg"
                      loading="lazy"
                    />
                  ))}
                  <span className="truncate text-text-light">{reviewerLogins.join(", ")}</span>
                </span>
              </span>
            ) : (
              <span className="text-text-light">
                {reviewSummary ? reviewSummary : "No reviewers"}
              </span>
            )}
          </OverviewField>
        </div>

        {metaItems.length > 0 && (
          <div className="ui-font ui-text-sm flex flex-wrap items-center gap-x-2 text-text-lighter">
            {metaItems.map((item, index) => (
              <span key={`${item}-${index}`} className="inline-flex items-center gap-x-2">
                {index > 0 ? <span>&middot;</span> : null}
                <span>{item}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
