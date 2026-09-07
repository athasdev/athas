import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  CopyIcon,
  DotsIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitDiffIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  type Icon,
  InfoIcon,
  NodesIcon,
  OpenExternalIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  SettingsIcon,
  StopIcon,
  TrashIcon,
  WarningIcon,
  XCircleIcon,
  XIcon,
} from "@/ui/icons";

/**
 * One concept, one icon.
 *
 * These are the product ideas that surface in more than one feature and have
 * more than one plausible glyph, so the choice is pinned here once instead of
 * being re-decided on each screen. Reach for the concept when the meaning is
 * what matters, and for the icon directly when the glyph itself is the point
 * (a literal folder in a file tree, the letter shapes in a text control).
 *
 * Two concepts must never resolve to the same icon: that is what let a pull
 * request and a network graph share one drawing. `icon-contract.test.ts`
 * enforces it.
 */
export const ICON_CONCEPTS = {
  "action.add": PlusIcon,
  "action.close": XIcon,
  "action.copy": CopyIcon,
  "action.delete": TrashIcon,
  "action.more": DotsIcon,
  "action.open-external": OpenExternalIcon,
  "action.refresh": ArrowClockwiseIcon,
  "action.run": PlayIcon,
  "action.save": SaveIcon,
  "action.search": SearchIcon,
  "action.settings": SettingsIcon,
  "action.stop": StopIcon,

  "disclosure.collapsed": ChevronRightIcon,
  "disclosure.expanded": ChevronDownIcon,

  "fs.file": FileIcon,
  "fs.folder": FolderIcon,
  "fs.folder-open": FolderOpenIcon,

  "git.branch": GitBranchIcon,
  "git.commit": GitCommitIcon,
  "git.diff": GitDiffIcon,
  "git.merge": GitMergeIcon,
  "git.pull-request": GitPullRequestIcon,
  "git.remote": NodesIcon,

  "status.error": XCircleIcon,
  "status.info": InfoIcon,
  "status.pending": CircleDotIcon,
  "status.success": CheckCircleIcon,
  "status.warning": WarningIcon,
} as const satisfies Record<string, Icon>;

export type IconConcept = keyof typeof ICON_CONCEPTS;
