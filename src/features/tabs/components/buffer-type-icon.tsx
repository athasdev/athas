import { useEffect, useState } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { BrowserTabIcon } from "./browser-tab-icon";
import { getTabDecoration } from "../services/tab-decoration-registry";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import type { GitDiff } from "@/features/git/types/git.types";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import {
  ActivityIcon,
  ArrowsClockwiseIcon,
  ArrowsLeftRightIcon,
  ChatBubbleTextIcon,
  DatabaseIcon,
  GitBranchIcon,
  GitDiffIcon,
  GitPullRequestIcon,
  GridIcon,
  PackageIcon,
  RocketIcon,
  SearchIcon,
  SettingsIcon,
  TagIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
} from "@/ui/icons";
import { getBaseName } from "@/utils/path-helpers";

function isMultiFileDiff(diffData: GitDiff | MultiFileDiff | undefined): diffData is MultiFileDiff {
  return Boolean(diffData && "files" in diffData);
}

function getDiffFileName(diff: GitDiff): string {
  const filePath = diff.new_path || diff.old_path || diff.file_path || "";
  return getBaseName(filePath, filePath || "diff");
}

/** The name whose file icon a buffer shows: the changed file for single-file diffs. */
function getIconFileName(buffer: PaneContent, displayName: string): string | null {
  if (buffer.type !== "diff") return buffer.name;
  if (buffer.path === "diff://working-tree/all-files") return null;
  const diffData = buffer.diffData;
  if (diffData && !isMultiFileDiff(diffData)) return getDiffFileName(diffData);
  return displayName;
}

interface BufferTypeIconProps {
  buffer: PaneContent;
  /** The name shown for the buffer, used for diffs that have no single file. */
  displayName?: string;
  /** Pixel size for icons that take one (contributed icons such as agent sessions, avatars). */
  size?: number;
}

/** The icon for a tab's content, shared by the tab bar and everything that lists open tabs. */
export function BufferTypeIcon({
  buffer,
  displayName = buffer.name,
  size = 12,
}: BufferTypeIconProps) {
  const [avatarError, setAvatarError] = useState(false);
  const authorAvatarUrl =
    buffer.type === "pullRequest" || buffer.type === "githubIssue"
      ? buffer.authorAvatarUrl
      : undefined;

  useEffect(() => {
    setAvatarError(false);
  }, [authorAvatarUrl]);

  const avatar =
    authorAvatarUrl && !avatarError ? (
      <img
        src={authorAvatarUrl}
        alt=""
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
        loading="lazy"
        onError={() => setAvatarError(true)}
      />
    ) : null;

  const ContributedIcon = getTabDecoration(buffer.type)?.icon;
  if (ContributedIcon) return <ContributedIcon buffer={buffer} size={size} />;

  switch (buffer.type) {
    case "extension":
      return <PackageIcon className="text-subtle-foreground" />;
    case "terminal":
      return <TerminalWindowIcon className="text-subtle-foreground" />;
    case "browser":
      return <BrowserTabIcon favicon={buffer.favicon} />;
    case "database":
      return <DatabaseIcon className="text-subtle-foreground" />;
    case "pullRequest":
      return avatar ?? <GitPullRequestIcon className="text-subtle-foreground" />;
    case "githubIssue":
      return avatar ?? <ChatBubbleTextIcon className="text-subtle-foreground" />;
    case "githubDelivery":
      return buffer.kind === "releases" ? <TagIcon /> : <RocketIcon />;
    case "githubAction":
      return <ActivityIcon className="text-subtle-foreground" />;
    case "githubForm":
      return buffer.formKind === "pull-request" ? (
        <GitPullRequestIcon className="text-subtle-foreground" />
      ) : buffer.formKind === "issue" ? (
        <ChatBubbleTextIcon className="text-subtle-foreground" />
      ) : (
        <ActivityIcon className="text-subtle-foreground" />
      );
    case "customView":
      return <GridIcon className="text-subtle-foreground" />;
    case "globalSearch":
    case "references":
      return <SearchIcon className="text-subtle-foreground" />;
    case "diagnostics":
      return <WarningCircleIcon className="text-subtle-foreground" />;
    case "continuousAgents":
      return <ArrowsClockwiseIcon className="text-subtle-foreground" />;
    case "acpInspector":
      return <ArrowsLeftRightIcon className="text-subtle-foreground" />;
    case "agentChanges":
      return <GitDiffIcon className="text-subtle-foreground" />;
    case "workspaces":
      return <GridIcon />;
    case "settings":
      return <SettingsIcon className="text-subtle-foreground" />;
    default:
      if (buffer.type === "diff" && isMultiFileDiff(buffer.diffData)) {
        return <GitBranchIcon className="text-subtle-foreground" />;
      }
      return (
        <ThemedFileIcon
          fileName={getIconFileName(buffer, displayName) ?? buffer.name}
          isDir={false}
          className="text-subtle-foreground"
        />
      );
  }
}
