import type { ReactElement, ReactNode } from "react";
import { getServiceUrls } from "@/config/services";
import { GithubMark } from "@/ui/brand-marks";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuTrigger,
  DropdownMenuViewport,
} from "@/ui/dropdown";
import { ChevronDownIcon, GitBranchIcon, LockIcon, OpenExternalIcon } from "@/ui/icons";
import { useMenuSearch } from "@/ui/menu-search";
import { SidebarListItem } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { openExternalUrl } from "@/utils/external-url";
import type { AgentEnvironment } from "../hooks/use-agent-environment";
import type { CloudTargets } from "../hooks/use-cloud-targets";
import { CloudAgentsError } from "../services/cloud-agents-api";

/** `pill`: a composer toolbar chip; `row`: a row of a session box. */
type PickerVariant = "pill" | "row";

interface PickerProps {
  environment: AgentEnvironment;
  targets: CloudTargets;
  variant: PickerVariant;
  disabled?: boolean;
  onBeforeOpen?: () => void;
}

function repoName(fullName: string) {
  return fullName.split("/")[1] ?? fullName;
}

function isGitHubNotConnected(error: unknown) {
  return error instanceof CloudAgentsError && error.code === "github_not_connected";
}

function pickerTrigger({
  variant,
  icon,
  label,
  caption,
  ariaLabel,
  tooltip,
  disabled,
}: {
  variant: PickerVariant;
  icon: ReactNode;
  label: string;
  caption: string;
  ariaLabel: string;
  tooltip: string;
  disabled?: boolean;
}): { render: ReactElement; children?: ReactNode } {
  if (variant === "row") {
    return {
      render: (
        <SidebarListItem
          density="compact"
          disabled={disabled}
          leading={icon}
          description={caption}
          trailing={disabled ? undefined : <ChevronDownIcon />}
          aria-label={ariaLabel}
        >
          {label}
        </SidebarListItem>
      ),
    };
  }
  return {
    render: (
      <Button
        type="button"
        variant="ghost"
        truncate
        disabled={disabled}
        aria-label={ariaLabel}
        tooltip={tooltip}
      />
    ),
    children: (
      <>
        {icon}
        <span className="min-w-0 truncate">{label}</span>
      </>
    ),
  };
}

/** A picker's value as a plain row, for a session whose repository and branch are settled. */
function StaticRow({ icon, label, caption }: { icon: ReactNode; label: string; caption: string }) {
  return (
    <SidebarListItem
      as="div"
      interactive={false}
      density="compact"
      leading={icon}
      description={caption}
    >
      {label}
    </SidebarListItem>
  );
}

function ConnectGitHubItem() {
  return (
    <DropdownMenuItem
      onClick={() => void openExternalUrl(getServiceUrls().dashboardIntegrationsUrl)}
    >
      <GithubMark />
      <span className="min-w-0 flex-1 truncate">Connect GitHub</span>
      <OpenExternalIcon className="text-subtle-foreground" />
    </DropdownMenuItem>
  );
}

/** The repository a cloud run clones, from the user's GitHub repositories. */
export function CloudRepoPicker({
  environment,
  targets,
  variant,
  disabled,
  onBeforeOpen,
}: PickerProps) {
  const search = useMenuSearch();
  const repos = search.filter(targets.repos, (repo) => [repo.fullName]);
  const repo = environment.repo;
  if (variant === "row" && disabled)
    return <StaticRow icon={<GithubMark />} label={repo ?? "No repository"} caption="Repository" />;
  const trigger = pickerTrigger({
    variant,
    icon: <GithubMark />,
    label: repo ? (variant === "pill" ? repoName(repo) : repo) : "Choose repository",
    caption: "Repository",
    ariaLabel: repo ? `Repository: ${repo}` : "Choose repository",
    tooltip: repo ?? "Choose the repository to clone",
    disabled,
  });

  return (
    <DropdownMenu
      {...search.menuProps}
      onOpenChange={(open) => {
        search.menuProps.onOpenChange(open);
        if (open) onBeforeOpen?.();
      }}
    >
      <DropdownMenuTrigger render={trigger.render}>{trigger.children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" size="wide" viewport="searchable">
        <DropdownMenuSearch
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          placeholder="Search repositories"
          autoFocus
        />
        <DropdownMenuViewport>
          {isGitHubNotConnected(targets.reposError) ? (
            <>
              <DropdownMenuEmpty>Connect GitHub to list your repositories.</DropdownMenuEmpty>
              <ConnectGitHubItem />
            </>
          ) : null}
          <DropdownMenuRadioGroup
            value={repo ?? ""}
            onValueChange={(value: string) => environment.setRepo(value)}
          >
            {repos.map((candidate) => (
              <DropdownMenuRadioItem
                key={candidate.fullName}
                value={candidate.fullName}
                closeOnClick
              >
                {candidate.private ? (
                  <LockIcon className="text-subtle-foreground" />
                ) : (
                  <GithubMark />
                )}
                <span className="min-w-0 flex-1 truncate">{candidate.fullName}</span>
                {candidate.fullName.toLowerCase() === targets.projectRepo?.toLowerCase() ? (
                  <span className="shrink-0 text-subtle-foreground ui-text-caption">
                    This project
                  </span>
                ) : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {targets.reposLoading ? (
            <DropdownMenuEmpty>
              <Spinner compact label="Loading repositories" />
              Loading repositories…
            </DropdownMenuEmpty>
          ) : repos.length === 0 && !isGitHubNotConnected(targets.reposError) ? (
            <DropdownMenuEmpty>
              {search.isSearching ? "No matching repositories" : "No repositories found"}
            </DropdownMenuEmpty>
          ) : targets.reposError && !isGitHubNotConnected(targets.reposError) ? (
            <DropdownMenuEmpty>Your other repositories could not be loaded.</DropdownMenuEmpty>
          ) : null}
        </DropdownMenuViewport>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The branch a cloud run starts from, from the repository's branches on GitHub. */
export function CloudBranchPicker({
  environment,
  targets,
  variant,
  disabled,
  onBeforeOpen,
}: PickerProps) {
  const search = useMenuSearch();
  const branches = search.filter(targets.branches, (branch) => [branch]);
  const branch = environment.branch;
  if (variant === "row" && disabled)
    return (
      <StaticRow icon={<GitBranchIcon />} label={branch ?? "No branch"} caption="Starts from" />
    );
  const trigger = pickerTrigger({
    variant,
    icon: <GitBranchIcon />,
    label: branch ?? (targets.branchesLoading ? "Loading…" : "Choose branch"),
    caption: "Starts from",
    ariaLabel: branch ? `Branch: ${branch}` : "Choose branch",
    tooltip: branch ? `Starts from ${branch}` : "Choose the branch to start from",
    disabled: disabled || !environment.repo,
  });

  return (
    <DropdownMenu
      {...search.menuProps}
      onOpenChange={(open) => {
        search.menuProps.onOpenChange(open);
        if (open) onBeforeOpen?.();
      }}
    >
      <DropdownMenuTrigger render={trigger.render}>{trigger.children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" size="default" viewport="searchable">
        <DropdownMenuSearch
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          placeholder="Search branches"
          autoFocus
        />
        <DropdownMenuViewport>
          <DropdownMenuRadioGroup
            value={branch ?? ""}
            onValueChange={(value: string) => environment.setBranch(value)}
          >
            {branches.map((name) => (
              <DropdownMenuRadioItem key={name} value={name} closeOnClick>
                <GitBranchIcon />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {name === targets.defaultBranch ? (
                  <span className="shrink-0 text-subtle-foreground ui-text-caption">default</span>
                ) : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {targets.branchesLoading ? (
            <DropdownMenuEmpty>
              <Spinner compact label="Loading branches" />
              Loading branches…
            </DropdownMenuEmpty>
          ) : branches.length === 0 ? (
            <DropdownMenuEmpty>
              {search.isSearching ? "No matching branches" : "No branches found"}
            </DropdownMenuEmpty>
          ) : null}
        </DropdownMenuViewport>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
