import { openUrl } from "@tauri-apps/plugin-opener";
import { GitBranchIcon, GitCommitIcon } from "@/ui/icons";
import type { ReactNode } from "react";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import {
  getGitHubBranchUrl,
  getGitHubCommitUrl,
  getGitHubUserUrl,
} from "../utils/github-link-utils";
import { GitHubAvatar } from "./github-avatar";

interface GitHubMetaChipProps {
  icon?: ReactNode;
  children: ReactNode;
  mono?: boolean;
  title?: string;
  className?: string;
  /** Runs on click. Takes precedence over `href`. */
  onClick?: () => void;
  /** Opened in the system browser on click. */
  href?: string | null;
}

/**
 * A compact metadata chip used in every GitHub viewer header. It renders as a
 * button when it has somewhere to go and as plain text otherwise, so callers
 * never need two code paths.
 */
export function GitHubMetaChip({
  icon,
  children,
  mono,
  title,
  className,
  onClick,
  href,
}: GitHubMetaChipProps) {
  const interactive = Boolean(onClick || href);
  const content = (
    <>
      {icon ? <span className="flex shrink-0 items-center [&_svg]:size-3.5">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </>
  );
  const baseClassName = cn(
    "inline-flex min-w-0 items-center gap-1 text-subtle-foreground ui-text-sm",
    mono && "font-mono",
    className,
  );

  const element = interactive ? (
    <button
      type="button"
      aria-label={title}
      onClick={() => {
        if (onClick) onClick();
        else if (href) void openUrl(href);
      }}
      className={cn(
        baseClassName,
        "-mx-1 rounded-chrome px-1 transition-colors duration-fast hover:bg-accent/70 hover:text-foreground focus-visible:bg-accent/70 focus-visible:text-foreground focus-visible:outline-none",
      )}
    >
      {content}
    </button>
  ) : (
    <span className={baseClassName}>{content}</span>
  );

  return title ? <Tooltip content={title}>{element}</Tooltip> : element;
}

interface GitHubUserChipProps {
  login: string;
  avatarUrl?: string | null;
  title?: string;
  prefix?: ReactNode;
  className?: string;
  avatarSize?: "xs" | "sm" | "md";
}

export function GitHubUserChip({
  login,
  avatarUrl,
  title,
  prefix,
  className,
  avatarSize = "xs",
}: GitHubUserChipProps) {
  return (
    <GitHubMetaChip
      title={title ?? `Open ${login} on GitHub`}
      href={getGitHubUserUrl(login)}
      className={className}
      icon={<GitHubAvatar login={login} avatarUrl={avatarUrl} size={32} displaySize={avatarSize} />}
    >
      {prefix}
      {login}
    </GitHubMetaChip>
  );
}

interface GitHubBranchChipProps {
  name: string;
  repositoryUrl: string | null;
  title?: string;
  className?: string;
}

export function GitHubBranchChip({ name, repositoryUrl, title, className }: GitHubBranchChipProps) {
  return (
    <GitHubMetaChip
      mono
      icon={<GitBranchIcon />}
      title={title ?? (repositoryUrl ? `Open branch ${name} on GitHub` : name)}
      href={repositoryUrl ? getGitHubBranchUrl(repositoryUrl, name) : null}
      className={className}
    >
      {name}
    </GitHubMetaChip>
  );
}

interface GitHubCommitChipProps {
  sha: string;
  repositoryUrl: string | null;
  onOpen?: () => void;
  className?: string;
}

export function GitHubCommitChip({ sha, repositoryUrl, onOpen, className }: GitHubCommitChipProps) {
  return (
    <GitHubMetaChip
      mono
      icon={<GitCommitIcon />}
      title={onOpen ? `Open commit ${sha.slice(0, 7)}` : `Open commit ${sha.slice(0, 7)} on GitHub`}
      onClick={onOpen}
      href={repositoryUrl ? getGitHubCommitUrl(repositoryUrl, sha) : null}
      className={className}
    >
      {sha.slice(0, 7)}
    </GitHubMetaChip>
  );
}
