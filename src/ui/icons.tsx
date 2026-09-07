import {
  createContext,
  createElement,
  forwardRef,
  useContext,
  type ComponentType,
  type CSSProperties,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGProps,
} from "react";
import * as Nucleo from "nucleo-ui-outline-18";

/**
 * Optical stroke tiers.
 *
 * Nucleo draws every icon on an 18px grid with a stroke measured in grid units,
 * so the same icon renders a 0.83px stroke at 10px and a 2px stroke at 24px.
 * `src/styles/icons.css` pins the stroke to real pixels with
 * `vector-effect: non-scaling-stroke`, and these tiers choose the pixel weight
 * that matches the size the icon is actually rendered at.
 */
export type IconOptical = "sm" | "md" | "lg";

const OPTICAL_STROKE: Record<IconOptical, string> = {
  sm: "1.25px",
  md: "1.5px",
  lg: "2px",
};

const OPTICAL_MD_MIN_SIZE = 20;
const OPTICAL_LG_MIN_SIZE = 28;

export type IconProps = Omit<SVGProps<SVGSVGElement>, "strokeWidth"> & {
  size?: number | string;
  optical?: IconOptical;
  mirrored?: boolean;
  title?: string;
};

export type Icon = ForwardRefExoticComponent<Omit<IconProps, "ref"> & RefAttributes<SVGSVGElement>>;

export const IconContext = createContext<Partial<IconProps>>({});

function opticalForSize(size: IconProps["size"]): IconOptical {
  if (typeof size !== "number") return "sm";
  if (size >= OPTICAL_LG_MIN_SIZE) return "lg";
  if (size >= OPTICAL_MD_MIN_SIZE) return "md";
  return "sm";
}

function createIconComponent(IconComponent: ComponentType<any>, displayName: string): Icon {
  const Wrapped = forwardRef<SVGSVGElement, IconProps>(function AthasIcon(props, ref) {
    const context = useContext(IconContext);
    const {
      mirrored,
      optical,
      size = "1em",
      style,
      title,
      ...iconProps
    } = { ...context, ...props };
    const nextStyle = {
      ...style,
      "--icon-stroke": OPTICAL_STROKE[optical ?? opticalForSize(size)],
      ...(mirrored
        ? { transform: [style?.transform, "scaleX(-1)"].filter(Boolean).join(" ") }
        : null),
    } as CSSProperties;

    return createElement(IconComponent, {
      ...iconProps,
      "data-athas-icon": "",
      ref,
      size,
      style: nextStyle,
      title,
    });
  });
  Wrapped.displayName = displayName;
  return Wrapped as Icon;
}

export const ActivityIcon = createIconComponent(Nucleo.IconChartActivityOutline18, "ActivityIcon");
export const AiLoadingIcon = createIconComponent(Nucleo.IconAiLoadingOutline18, "AiLoadingIcon");
export const ArchiveIcon = createIconComponent(Nucleo.IconArchiveOutline18, "ArchiveIcon");
export const ArrowClockwiseIcon = createIconComponent(
  Nucleo.IconArrowRotateClockwiseOutline18,
  "ArrowClockwiseIcon",
);
export const ArrowCornerDownLeftIcon = createIconComponent(
  Nucleo.IconArrowCornerBottomLeftOutline18,
  "ArrowCornerDownLeftIcon",
);
export const ArrowCounterClockwiseIcon = createIconComponent(
  Nucleo.IconArrowRotateAnticlockwiseOutline18,
  "ArrowCounterClockwiseIcon",
);
export const ArrowDownIcon = createIconComponent(Nucleo.IconArrowDownOutline18, "ArrowDownIcon");
export const ArrowDownToLineIcon = createIconComponent(
  Nucleo.IconArrowBoldDownToLineOutline18,
  "ArrowDownToLineIcon",
);
export const ArrowLeftIcon = createIconComponent(Nucleo.IconArrowLeftOutline18, "ArrowLeftIcon");
export const ArrowRightIcon = createIconComponent(Nucleo.IconArrowRightOutline18, "ArrowRightIcon");
export const ArrowUpIcon = createIconComponent(Nucleo.IconArrowUpOutline18, "ArrowUpIcon");
export const ArrowUpRightIcon = createIconComponent(
  Nucleo.IconArrowUpRightOutline18,
  "ArrowUpRightIcon",
);
export const ArrowsClockwiseIcon = createIconComponent(
  Nucleo.IconArrowsRotateCenterOutline18,
  "ArrowsClockwiseIcon",
);
export const ArrowsInIcon = createIconComponent(
  Nucleo.IconArrowsReduceDiagonalOutline18,
  "ArrowsInIcon",
);
export const ArrowsLeftRightIcon = createIconComponent(
  Nucleo.IconArrowsOppositeDirectionXOutline18,
  "ArrowsLeftRightIcon",
);
export const ArrowsOutIcon = createIconComponent(
  Nucleo.IconArrowsExpandDiagonalOutline18,
  "ArrowsOutIcon",
);
export const BellIcon = createIconComponent(Nucleo.IconBellOutline18, "BellIcon");
export const BoltIcon = createIconComponent(Nucleo.IconBoltLightningOutline18, "BoltIcon");
export const BoltSlashIcon = createIconComponent(
  Nucleo.IconBoltLightningSlashOutline18,
  "BoltSlashIcon",
);
export const BookOpenIcon = createIconComponent(Nucleo.IconBookOpenOutline18, "BookOpenIcon");
export const BracketsCurlyIcon = createIconComponent(
  Nucleo.IconBracketsCurlyOutline18,
  "BracketsCurlyIcon",
);
export const BrainIcon = createIconComponent(Nucleo.IconBrainOutline18, "BrainIcon");
export const BroadcastIcon = createIconComponent(Nucleo.IconRadioOutline18, "BroadcastIcon");
export const BugIcon = createIconComponent(Nucleo.IconBugOutline18, "BugIcon");
export const CalendarIcon = createIconComponent(Nucleo.IconCalendarOutline18, "CalendarIcon");
export const CaseSensitiveIcon = createIconComponent(
  Nucleo.IconTextAOutline18,
  "CaseSensitiveIcon",
);
export const ChatBubbleTextIcon = createIconComponent(
  Nucleo.IconChatBubbleContentOutline18,
  "ChatBubbleTextIcon",
);
export const CheckCircleIcon = createIconComponent(
  Nucleo.IconCircleCheckOutline18,
  "CheckCircleIcon",
);
export const CheckIcon = createIconComponent(Nucleo.IconCheckOutline18, "CheckIcon");
export const ChevronDoubleLeftIcon = createIconComponent(
  Nucleo.IconDoubleChevronLeftOutline18,
  "ChevronDoubleLeftIcon",
);
export const ChevronDoubleRightIcon = createIconComponent(
  Nucleo.IconDoubleChevronRightOutline18,
  "ChevronDoubleRightIcon",
);
export const ChevronDoubleUpIcon = createIconComponent(
  Nucleo.IconDoubleChevronUpOutline18,
  "ChevronDoubleUpIcon",
);
export const ChevronDownIcon = createIconComponent(
  Nucleo.IconChevronDownOutline18,
  "ChevronDownIcon",
);
export const ChevronExpandYIcon = createIconComponent(
  Nucleo.IconChevronExpandYOutline18,
  "ChevronExpandYIcon",
);
export const ChevronLeftIcon = createIconComponent(
  Nucleo.IconChevronLeftOutline18,
  "ChevronLeftIcon",
);
export const ChevronRightIcon = createIconComponent(
  Nucleo.IconChevronRightOutline18,
  "ChevronRightIcon",
);
export const ChevronUpIcon = createIconComponent(Nucleo.IconChevronUpOutline18, "ChevronUpIcon");
export const CircleDotIcon = createIconComponent(Nucleo.IconRecordOutline18, "CircleDotIcon");
export const CircleDottedIcon = createIconComponent(
  Nucleo.IconCircleDottedOutline18,
  "CircleDottedIcon",
);
export const CirclesIcon = createIconComponent(Nucleo.IconCirclesOutline18, "CirclesIcon");
export const ClickIcon = createIconComponent(Nucleo.IconTouchClickOutline18, "ClickIcon");
export const ClipboardIcon = createIconComponent(Nucleo.IconClipboardOutline18, "ClipboardIcon");
export const BroomIcon = createIconComponent(Nucleo.IconBroomOutline18, "BroomIcon");
export const ClipboardTextIcon = createIconComponent(
  Nucleo.IconClipboardContentOutline18,
  "ClipboardTextIcon",
);
export const ClockIcon = createIconComponent(Nucleo.IconClockOutline18, "ClockIcon");
export const CloudArrowDownIcon = createIconComponent(
  Nucleo.IconCloudDownloadOutline18,
  "CloudArrowDownIcon",
);
export const CloudIcon = createIconComponent(Nucleo.IconCloudOutline18, "CloudIcon");
export const CloudSlashIcon = createIconComponent(Nucleo.IconCloudSlashOutline18, "CloudSlashIcon");
export const CloudWarningIcon = createIconComponent(
  Nucleo.IconCloudBoltOutline18,
  "CloudWarningIcon",
);
export const CodeBlockIcon = createIconComponent(Nucleo.IconSquareCodeOutline18, "CodeBlockIcon");
export const CodeIcon = createIconComponent(Nucleo.IconCodeOutline18, "CodeIcon");
export const ColumnsIcon = createIconComponent(Nucleo.IconTableColsOutline18, "ColumnsIcon");
export const CommandIcon = createIconComponent(Nucleo.IconCommandOutline18, "CommandIcon");
export const CopyIcon = createIconComponent(Nucleo.IconCopyOutline18, "CopyIcon");
export const CreditCardIcon = createIconComponent(Nucleo.IconCreditCardOutline18, "CreditCardIcon");
export const CubeIcon = createIconComponent(Nucleo.IconCubeOutline18, "CubeIcon");
export const DatabaseIcon = createIconComponent(Nucleo.IconDatabaseOutline18, "DatabaseIcon");
export const DotsIcon = createIconComponent(Nucleo.IconDotsOutline18, "DotsIcon");
export const DownloadIcon = createIconComponent(Nucleo.IconDownloadOutline18, "DownloadIcon");
export const ExtensionsIcon = createIconComponent(Nucleo.IconAppStackOutline18, "ExtensionsIcon");
export const EyeIcon = createIconComponent(Nucleo.IconEyeOutline18, "EyeIcon");
export const EyeSlashIcon = createIconComponent(Nucleo.IconEyeSlashOutline18, "EyeSlashIcon");
export const FileCodeIcon = createIconComponent(Nucleo.IconFileSettingsOutline18, "FileCodeIcon");
export const FileIcon = createIconComponent(Nucleo.IconFileOutline18, "FileIcon");
export const FilePlusIcon = createIconComponent(Nucleo.IconFilePlusOutline18, "FilePlusIcon");
export const FileTextIcon = createIconComponent(Nucleo.IconFileContentOutline18, "FileTextIcon");
export const FilesIcon = createIconComponent(Nucleo.IconFiles2Outline18, "FilesIcon");
export const FilterIcon = createIconComponent(Nucleo.IconFilterOutline18, "FilterIcon");
export const FlipHorizontalIcon = createIconComponent(
  Nucleo.IconFlipHorizontalOutline18,
  "FlipHorizontalIcon",
);
export const FlipVerticalIcon = createIconComponent(
  Nucleo.IconFlipVerticalOutline18,
  "FlipVerticalIcon",
);
export const FolderIcon = createIconComponent(Nucleo.IconFolderOutline18, "FolderIcon");
export const FolderOpenIcon = createIconComponent(Nucleo.IconFolderOpenOutline18, "FolderOpenIcon");
export const FolderPlusIcon = createIconComponent(Nucleo.IconFolderPlusOutline18, "FolderPlusIcon");
export const FolderStarIcon = createIconComponent(Nucleo.IconFolderStarOutline18, "FolderStarIcon");
export const FunctionIcon = createIconComponent(Nucleo.IconMathFunctionOutline18, "FunctionIcon");
export const GearIcon = createIconComponent(Nucleo.IconGearOutline18, "GearIcon");
export const GitBranchIcon = createIconComponent(Nucleo.IconCodeBranchOutline18, "GitBranchIcon");
export const GitCommitIcon = createIconComponent(Nucleo.IconCodeCommitOutline18, "GitCommitIcon");
export const GitDiffIcon = createIconComponent(Nucleo.IconCodeCompareOutline18, "GitDiffIcon");
export const GitMergeIcon = createIconComponent(Nucleo.IconCodeMergeOutline18, "GitMergeIcon");
export const GitPullRequestIcon = createIconComponent(
  Nucleo.IconCodePullRequestOutline18,
  "GitPullRequestIcon",
);
export const GlobeIcon = createIconComponent(Nucleo.IconGlobeOutline18, "GlobeIcon");
export const GridIcon = createIconComponent(Nucleo.IconSquareGrid2Outline18, "GridIcon");
export const HardDrivesIcon = createIconComponent(Nucleo.IconHardDriveOutline18, "HardDrivesIcon");
export const HashIcon = createIconComponent(Nucleo.IconHashtagOutline18, "HashIcon");
export const HistoryIcon = createIconComponent(
  Nucleo.IconClockRotateAnticlockwiseOutline18,
  "HistoryIcon",
);
export const HouseIcon = createIconComponent(Nucleo.IconHouseOutline18, "HouseIcon");
export const ImageIcon = createIconComponent(Nucleo.IconImageOutline18, "ImageIcon");
export const InfoIcon = createIconComponent(Nucleo.IconCircleInfoOutline18, "InfoIcon");
export const KeyIcon = createIconComponent(Nucleo.IconKeyOutline18, "KeyIcon");
export const KeyboardIcon = createIconComponent(Nucleo.IconKeyboardOutline18, "KeyboardIcon");
export const LaptopIcon = createIconComponent(Nucleo.IconLaptopOutline18, "LaptopIcon");
export const LightbulbIcon = createIconComponent(Nucleo.IconLightbulbOutline18, "LightbulbIcon");
export const LinkIcon = createIconComponent(Nucleo.IconLinkOutline18, "LinkIcon");
export const ListChecksIcon = createIconComponent(Nucleo.IconCheckListOutline18, "ListChecksIcon");
export const ListIcon = createIconComponent(Nucleo.IconUnorderedListOutline18, "ListIcon");
export const LockIcon = createIconComponent(Nucleo.IconLockOutline18, "LockIcon");
export const LockKeyIcon = createIconComponent(Nucleo.IconLockKeyOutline18, "LockKeyIcon");
export const LockOpenIcon = createIconComponent(Nucleo.IconLockOpenOutline18, "LockOpenIcon");
export const MagicWandIcon = createIconComponent(Nucleo.IconMagicWandOutline18, "MagicWandIcon");
export const MegaphoneIcon = createIconComponent(Nucleo.IconMegaphoneOutline18, "MegaphoneIcon");
export const MicrophoneIcon = createIconComponent(Nucleo.IconMicrophoneOutline18, "MicrophoneIcon");
export const MinusCircleIcon = createIconComponent(
  Nucleo.IconCircleMinusOutline18,
  "MinusCircleIcon",
);
export const MinusIcon = createIconComponent(Nucleo.IconMinusOutline18, "MinusIcon");
export const MonitorIcon = createIconComponent(Nucleo.IconMonitorOutline18, "MonitorIcon");
export const MoonIcon = createIconComponent(Nucleo.IconMoonOutline18, "MoonIcon");
export const NodesIcon = createIconComponent(Nucleo.IconNodesOutline18, "NodesIcon");
export const OpenExternalIcon = createIconComponent(
  Nucleo.IconOpenExternalOutline18,
  "OpenExternalIcon",
);
export const PackageIcon = createIconComponent(Nucleo.IconBoxOutline18, "PackageIcon");
export const PaintBrushIcon = createIconComponent(Nucleo.IconBrushOutline18, "PaintBrushIcon");
export const PaletteIcon = createIconComponent(Nucleo.IconPaletteOutline18, "PaletteIcon");
export const PaperPlaneIcon = createIconComponent(
  Nucleo.IconPaperPlane2Outline18,
  "PaperPlaneIcon",
);
export const PauseIcon = createIconComponent(
  Nucleo.IconCircleHalfDashedPauseOutline18,
  "PauseIcon",
);
export const PenIcon = createIconComponent(Nucleo.IconPen3Outline18, "PenIcon");
export const PencilIcon = createIconComponent(Nucleo.IconPencilOutline18, "PencilIcon");
export const PencilLineIcon = createIconComponent(
  Nucleo.IconPenWriting4Outline18,
  "PencilLineIcon",
);
export const PinIcon = createIconComponent(Nucleo.IconPinTackOutline18, "PinIcon");
export const PinSlashIcon = createIconComponent(Nucleo.IconPinSlashOutline18, "PinSlashIcon");
export const PlayCircleIcon = createIconComponent(Nucleo.IconCirclePlayOutline18, "PlayCircleIcon");
export const PlayIcon = createIconComponent(Nucleo.IconMediaPlayOutline18, "PlayIcon");
export const PlugsConnectedIcon = createIconComponent(
  Nucleo.IconPlug2Outline18,
  "PlugsConnectedIcon",
);
export const PlusCircleIcon = createIconComponent(Nucleo.IconCirclePlusOutline18, "PlusCircleIcon");
export const PlusIcon = createIconComponent(Nucleo.IconPlusOutline18, "PlusIcon");
export const PuzzlePieceIcon = createIconComponent(
  Nucleo.IconPuzzlePieceOutline18,
  "PuzzlePieceIcon",
);
export const QuestionIcon = createIconComponent(Nucleo.IconCircleQuestionOutline18, "QuestionIcon");
export const RemoteIcon = createIconComponent(Nucleo.IconComputerOutline18, "RemoteIcon");
export const RobotIcon = createIconComponent(Nucleo.IconRobotOutline18, "RobotIcon");
export const RocketIcon = createIconComponent(Nucleo.IconRocketOutline18, "RocketIcon");
export const RowsIcon = createIconComponent(Nucleo.IconTableRowsOutline18, "RowsIcon");
export const RowsPlusTopIcon = createIconComponent(
  Nucleo.IconTableRowNewTopOutline18,
  "RowsPlusTopIcon",
);
export const SaveIcon = createIconComponent(Nucleo.IconFloppyDiskOutline18, "SaveIcon");
export const ScissorsIcon = createIconComponent(Nucleo.IconScissorsOutline18, "ScissorsIcon");
export const SearchIcon = createIconComponent(Nucleo.IconMagnifierOutline18, "SearchIcon");
export const SettingsIcon = createIconComponent(Nucleo.IconGear2Outline18, "SettingsIcon");
export const ShieldCheckIcon = createIconComponent(
  Nucleo.IconShieldCheckOutline18,
  "ShieldCheckIcon",
);
export const ShieldIcon = createIconComponent(Nucleo.IconShieldOutline18, "ShieldIcon");
export const ShieldWarningIcon = createIconComponent(
  Nucleo.IconShieldAlertOutline18,
  "ShieldWarningIcon",
);
export const SidebarIcon = createIconComponent(Nucleo.IconSidebarLeftShowOutline18, "SidebarIcon");
export const SignInIcon = createIconComponent(Nucleo.IconArrowDoorInOutline18, "SignInIcon");
export const SignOutIcon = createIconComponent(Nucleo.IconArrowDoorOut3Outline18, "SignOutIcon");
export const SitemapIcon = createIconComponent(Nucleo.IconSitemapOutline18, "SitemapIcon");
export const SlidersIcon = createIconComponent(Nucleo.IconSlidersOutline18, "SlidersIcon");
export const SparkleIcon = createIconComponent(Nucleo.IconSparkleOutline18, "SparkleIcon");
export const SquareArrowUpIcon = createIconComponent(
  Nucleo.IconSquareArrowUpOutline18,
  "SquareArrowUpIcon",
);
export const SquareIcon = createIconComponent(Nucleo.IconShapeSquareOutline18, "SquareIcon");
export const StackIcon = createIconComponent(Nucleo.IconStackOutline18, "StackIcon");
export const StopIcon = createIconComponent(Nucleo.IconCircleHalfDashedStopOutline18, "StopIcon");
export const SunIcon = createIconComponent(Nucleo.IconSunOutline18, "SunIcon");
export const TableIcon = createIconComponent(Nucleo.IconTableOutline18, "TableIcon");
export const TagIcon = createIconComponent(Nucleo.IconTagOutline18, "TagIcon");
export const TerminalIcon = createIconComponent(Nucleo.IconTerminalOutline18, "TerminalIcon");
export const TerminalWindowIcon = createIconComponent(
  Nucleo.IconSquareTerminalOutline18,
  "TerminalWindowIcon",
);
export const TextAlignJustifyIcon = createIconComponent(
  Nucleo.IconTextAlignJustifyOutline18,
  "TextAlignJustifyIcon",
);
export const TextAlignLeftIcon = createIconComponent(
  Nucleo.IconTextAlignLeftOutline18,
  "TextAlignLeftIcon",
);
export const SelectAllIcon = createIconComponent(Nucleo.IconSelectOutline18, "SelectAllIcon");
export const TextIcon = createIconComponent(Nucleo.IconTextOutline18, "TextIcon");
export const TextIndentIcon = createIconComponent(
  Nucleo.IconIndentIncreaseOutline18,
  "TextIndentIcon",
);
export const TranslateIcon = createIconComponent(Nucleo.IconLanguageOutline18, "TranslateIcon");
export const TrashIcon = createIconComponent(Nucleo.IconTrashOutline18, "TrashIcon");
export const UploadIcon = createIconComponent(Nucleo.IconUploadOutline18, "UploadIcon");
export const UserCircleIcon = createIconComponent(Nucleo.IconCircleUserOutline18, "UserCircleIcon");
export const UserIcon = createIconComponent(Nucleo.IconUserOutline18, "UserIcon");
export const UsersIcon = createIconComponent(Nucleo.IconUsersOutline18, "UsersIcon");
export const WarningCircleIcon = createIconComponent(
  Nucleo.IconCircleWarningOutline18,
  "WarningCircleIcon",
);
export const WarningIcon = createIconComponent(Nucleo.IconTriangleWarningOutline18, "WarningIcon");
export const WindowExpandIcon = createIconComponent(
  Nucleo.IconOpenInNewWindowOutline18,
  "WindowExpandIcon",
);
export const WrenchIcon = createIconComponent(Nucleo.IconWrenchOutline18, "WrenchIcon");
export const XCircleIcon = createIconComponent(Nucleo.IconCircleXmarkOutline18, "XCircleIcon");
export const XIcon = createIconComponent(Nucleo.IconXmarkOutline18, "XIcon");
export const ZoomInIcon = createIconComponent(Nucleo.IconMagnifierPlusOutline18, "ZoomInIcon");
export const ZoomOutIcon = createIconComponent(Nucleo.IconMagnifierMinusOutline18, "ZoomOutIcon");
