import { useEffect, useMemo, useState } from "react";
import type {
  GithubRepository,
  RepositoryBranches,
  WebsiteAccount,
} from "@/features/web-workbench/services/website-api";
import type { CloudWorkspaceState } from "@/features/web-workbench/services/cloud-workspace-controller";
import {
  goToSignIn,
  openWebsitePage,
  WEBSITE_PAGES,
} from "@/features/web-workbench/services/website-links";
import { getWebsiteApi, useWebAppStore } from "@/features/web-workbench/stores/web-app.store";
import { GithubMark } from "@/ui/brand-marks";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandHeader,
  CommandHeaderAction,
  CommandInput,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
  useCommandListNavigation,
} from "@/ui/command";
import { EmptyState } from "@/ui/empty";
import {
  ArrowLeftIcon,
  CreditCardIcon,
  GitBranchIcon,
  LockIcon,
  SearchIcon,
  SignInIcon,
  StopIcon,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";

interface GithubRepositoryContentProps {
  onBack: () => void;
  onClose: () => void;
}

const PRICING_NOTE =
  "$0.40 an hour from your credit. Stops after 30 idle minutes, at most 4 hours.";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function phaseText(cloud: CloudWorkspaceState) {
  switch (cloud.phase) {
    case "opening":
    case "starting":
      return "Starting the cloud workspace and cloning the repository.";
    case "connecting":
      return "Connecting to the cloud workspace.";
    case "connected":
      return "Running in a cloud workspace.";
    case "stopping":
      return "Stopping the cloud workspace.";
    default:
      return "";
  }
}

function AccountGate({ account }: { account: WebsiteAccount | null }) {
  if (!account) {
    return (
      <CommandEmpty>
        <Spinner label="Checking your account" showLabel />
      </CommandEmpty>
    );
  }
  if (account.status === "signed-out") {
    return (
      <EmptyState
        icon={<GithubMark />}
        title="Open your GitHub repositories"
        message="Sign in to Athas to open your repositories in a cloud workspace with a terminal, search and Git."
        action={{ label: "Sign In", icon: <SignInIcon />, onClick: goToSignIn }}
      />
    );
  }
  if (!account.cloudEditor) {
    return (
      <EmptyState
        icon={<GithubMark />}
        title="Cloud workspaces are part of Athas Pro"
        message={`With Pro, Athas opens any of your GitHub repositories in a cloud workspace. ${PRICING_NOTE}`}
        action={{
          label: "Upgrade to Pro",
          icon: <CreditCardIcon />,
          onClick: () => openWebsitePage(WEBSITE_PAGES.billing),
        }}
      />
    );
  }
  return (
    <EmptyState
      icon={<GithubMark />}
      title="Connect GitHub"
      message="Connect your GitHub account on athas.dev to open your repositories here."
      action={{
        label: "Connect GitHub",
        icon: <GithubMark />,
        onClick: () => openWebsitePage(WEBSITE_PAGES.integrations),
      }}
    />
  );
}

/**
 * The project picker's "GitHub Repository" step in the web app: picks a repository and branch
 * from the user's GitHub account and opens them in a cloud workspace.
 */
export default function GithubRepositoryContent({ onBack, onClose }: GithubRepositoryContentProps) {
  const account = useWebAppStore.use.account();
  const cloud = useWebAppStore.use.cloud();
  const { openRepository, stopWorkspace } = useWebAppStore.use.actions();
  const ready = account?.status === "signed-in" && account.cloudEditor && account.githubConnected;
  const picking = ready && cloud.phase === "idle";

  const [repos, setRepos] = useState<GithubRepository[] | null>(null);
  const [branches, setBranches] = useState<RepositoryBranches | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!picking || repos) return;
    let cancelled = false;
    getWebsiteApi()
      .listRepositories()
      .then((next) => {
        if (!cancelled) setRepos(next);
      })
      .catch((loadError) => {
        if (!cancelled) setError(errorText(loadError, "Your repositories could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [picking, repos]);

  useEffect(() => {
    setBranches(null);
    if (!repo) return;
    let cancelled = false;
    getWebsiteApi()
      .listBranches(repo)
      .then((next) => {
        if (!cancelled) setBranches(next);
      })
      .catch((loadError) => {
        if (!cancelled) setError(errorText(loadError, "The branches could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const normalizedQuery = query.trim().toLowerCase();
  const entries = useMemo(() => {
    if (repo) {
      const names = branches
        ? [
            ...(branches.defaultBranch ? [branches.defaultBranch] : []),
            ...branches.branches.filter((name) => name !== branches.defaultBranch),
          ]
        : [];
      return names
        .filter((name) => name.toLowerCase().includes(normalizedQuery))
        .map((name) => ({
          id: `branch:${name}`,
          name,
          onSelect: () => {
            onClose();
            void openRepository(repo, name);
          },
        }));
    }
    return (repos ?? [])
      .filter((option) => option.fullName.toLowerCase().includes(normalizedQuery))
      .map((option) => ({
        id: `repo:${option.fullName}`,
        name: option.fullName,
        onSelect: () => {
          setError(null);
          setQuery("");
          setRepo(option.fullName);
        },
      }));
  }, [branches, normalizedQuery, onClose, openRepository, repo, repos]);

  const { selectedIndex, setSelectedIndex, onInputKeyDown } = useCommandListNavigation({
    itemCount: entries.length,
    resetKey: `${repo ?? ""}:${normalizedQuery}`,
    onSelect: (index) => entries[index]?.onSelect(),
  });

  const handleBack = () => {
    if (repo) {
      setRepo(null);
      setQuery("");
      setError(null);
      return;
    }
    onBack();
  };

  const loading = repo ? branches === null : repos === null;
  const repoByName = new Map((repos ?? []).map((option) => [option.fullName, option]));

  return (
    <>
      <CommandHeader onClose={onClose}>
        <CommandHeaderAction
          aria-label={repo ? "Back to repositories" : "Back to projects"}
          onClick={handleBack}
        >
          <ArrowLeftIcon />
        </CommandHeaderAction>
        {picking ? (
          <>
            <SearchIcon className="size-4 shrink-0 text-subtle-foreground" />
            <CommandInput
              value={query}
              onChange={setQuery}
              onKeyDown={onInputKeyDown}
              placeholder={repo ? `Branch of ${repo}` : "Search your GitHub repositories"}
              autoFocus
            />
          </>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <GithubMark className="shrink-0 text-subtle-foreground" />
            <span className="min-w-0 truncate font-sans ui-text-base font-medium text-foreground">
              Open GitHub Repository
            </span>
          </div>
        )}
      </CommandHeader>

      <CommandList>
        {!ready ? (
          <AccountGate account={account} />
        ) : cloud.phase !== "idle" ? (
          <EmptyState
            icon={<GithubMark />}
            title={
              cloud.workspace
                ? `${cloud.workspace.repo} on ${cloud.workspace.branch}`
                : "Opening the repository"
            }
            message={phaseText(cloud)}
          />
        ) : error ? (
          <CommandEmpty role="alert">{error}</CommandEmpty>
        ) : loading ? (
          <CommandEmpty>
            <Spinner label={repo ? "Loading branches" : "Loading repositories"} showLabel />
          </CommandEmpty>
        ) : entries.length === 0 ? (
          <CommandEmpty>
            {normalizedQuery
              ? `Nothing matches "${query}".`
              : repo
                ? "This repository has no branches."
                : "No repositories found on your GitHub account."}
          </CommandEmpty>
        ) : (
          <div className="space-y-0.5">
            {entries.map((entry, index) => {
              const option = repo ? null : repoByName.get(entry.name);
              return (
                <CommandItemRow
                  key={entry.id}
                  isSelected={selectedIndex === index}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={entry.onSelect}
                  icon={
                    repo ? (
                      <GitBranchIcon className="text-subtle-foreground" />
                    ) : option?.private ? (
                      <LockIcon className="text-subtle-foreground" />
                    ) : (
                      <GithubMark className="text-subtle-foreground" />
                    )
                  }
                  title={entry.name}
                  description={option?.description ?? undefined}
                  accessory={
                    repo && entry.name === branches?.defaultBranch ? (
                      <CommandItemBadge>Default</CommandItemBadge>
                    ) : null
                  }
                />
              );
            })}
          </div>
        )}
      </CommandList>

      {ready ? (
        <CommandFooter>
          {cloud.phase !== "idle" ? (
            <CommandFooterAction
              onClick={() => void stopWorkspace()}
              disabled={cloud.phase === "stopping"}
            >
              <StopIcon />
              Stop Workspace
            </CommandFooterAction>
          ) : null}
          <span className="ml-auto ui-text-sm text-muted-foreground">{PRICING_NOTE}</span>
        </CommandFooter>
      ) : null}
    </>
  );
}
