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

export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  weight?: IconWeight;
  mirrored?: boolean;
  alt?: string;
  title?: string;
};

export type Icon = ForwardRefExoticComponent<Omit<IconProps, "ref"> & RefAttributes<SVGSVGElement>>;

export const IconContext = createContext<Partial<IconProps>>({});

function getStrokeWidthForWeight(weight: IconProps["weight"]) {
  switch (weight) {
    case "thin":
      return 1;
    case "light":
      return 1.25;
    case "bold":
    case "fill":
      return 2;
    default:
      return undefined;
  }
}

function createIconComponent(IconComponent: ComponentType<any>, displayName: string): Icon {
  const Wrapped = forwardRef<SVGSVGElement, IconProps>(function AppIcon(props, ref) {
    const context = useContext(IconContext);
    const {
      alt,
      mirrored,
      size = "1em",
      strokeWidth,
      style,
      title,
      weight,
      ...iconProps
    } = { ...context, ...props };
    const nextStyle = mirrored
      ? ({
          ...style,
          transform: [style?.transform, "scaleX(-1)"].filter(Boolean).join(" "),
        } as CSSProperties)
      : style;

    return createElement(IconComponent, {
      ...iconProps,
      ref,
      size,
      strokeWidth: strokeWidth ?? getStrokeWidthForWeight(weight),
      style: nextStyle,
      title: title ?? alt,
    });
  });
  Wrapped.displayName = displayName;
  return Wrapped as Icon;
}

export const Icon = createIconComponent(Nucleo.IconCircleQuestionOutline18, "Icon");
export const AiLoadingIcon = createIconComponent(Nucleo.IconAiLoadingOutline18, "AiLoadingIcon");
export const ArchiveIcon = createIconComponent(Nucleo.IconArchiveOutline18, "ArchiveIcon");
export const ArrowBendDownLeftIcon = createIconComponent(
  Nucleo.IconArrowCornerBottomLeftOutline18,
  "ArrowBendDownLeftIcon",
);
export const ArrowClockwiseIcon = createIconComponent(
  Nucleo.IconArrowRotateClockwiseOutline18,
  "ArrowClockwiseIcon",
);
export const ArrowCounterClockwiseIcon = createIconComponent(
  Nucleo.IconArrowRotateAnticlockwiseOutline18,
  "ArrowCounterClockwiseIcon",
);
export const ArrowDownIcon = createIconComponent(Nucleo.IconArrowDownOutline18, "ArrowDownIcon");
export const ArrowFatLineDownIcon = createIconComponent(
  Nucleo.IconArrowBoldDownToLineOutline18,
  "ArrowFatLineDownIcon",
);
export const ArrowLeftIcon = createIconComponent(Nucleo.IconArrowLeftOutline18, "ArrowLeftIcon");
export const ArrowRightIcon = createIconComponent(Nucleo.IconArrowRightOutline18, "ArrowRightIcon");
export const ArrowsClockwiseIcon = createIconComponent(
  Nucleo.IconArrowsRotateCenterOutline18,
  "ArrowsClockwiseIcon",
);
export const ArrowsInIcon = createIconComponent(
  Nucleo.IconArrowsReduceDiagonalOutline18,
  "ArrowsInIcon",
);
export const ArrowsInLineVerticalIcon = createIconComponent(
  Nucleo.IconArrowsToLineYOutline18,
  "ArrowsInLineVerticalIcon",
);
export const ArrowsLeftRightIcon = createIconComponent(
  Nucleo.IconArrowsOppositeDirectionXOutline18,
  "ArrowsLeftRightIcon",
);
export const ArrowsOutIcon = createIconComponent(
  Nucleo.IconArrowsExpandDiagonalOutline18,
  "ArrowsOutIcon",
);
export const ArrowSquareOutIcon = createIconComponent(
  Nucleo.IconOpenExternalOutline18,
  "ArrowSquareOutIcon",
);
export const ArrowSquareUpIcon = createIconComponent(
  Nucleo.IconSquareArrowUpOutline18,
  "ArrowSquareUpIcon",
);
export const ArrowUpIcon = createIconComponent(Nucleo.IconArrowUpOutline18, "ArrowUpIcon");
export const BookmarkIcon = createIconComponent(Nucleo.IconBookmarkOutline18, "BookmarkIcon");
export const BookOpenIcon = createIconComponent(Nucleo.IconBookOpenOutline18, "BookOpenIcon");
export const BracketsCurlyIcon = createIconComponent(
  Nucleo.IconBracketsCurlyOutline18,
  "BracketsCurlyIcon",
);
export const BrainIcon = createIconComponent(Nucleo.IconBrainOutline18, "BrainIcon");
export const BroomIcon = createIconComponent(Nucleo.IconBroomOutline18, "BroomIcon");
export const BugBeetleIcon = createIconComponent(Nucleo.IconBugOutline18, "BugBeetleIcon");
export const BugIcon = createIconComponent(Nucleo.IconBugOutline18, "BugIcon");
export const CalendarIcon = createIconComponent(Nucleo.IconCalendarOutline18, "CalendarIcon");
export const CaretDoubleLeftIcon = createIconComponent(
  Nucleo.IconDoubleChevronLeftOutline18,
  "CaretDoubleLeftIcon",
);
export const CaretDoubleRightIcon = createIconComponent(
  Nucleo.IconDoubleChevronRightOutline18,
  "CaretDoubleRightIcon",
);
export const CaretDoubleUpIcon = createIconComponent(
  Nucleo.IconDoubleChevronUpOutline18,
  "CaretDoubleUpIcon",
);
export const CaretDownIcon = createIconComponent(Nucleo.IconChevronDownOutline18, "CaretDownIcon");
export const CaretLeftIcon = createIconComponent(Nucleo.IconChevronLeftOutline18, "CaretLeftIcon");
export const CaretRightIcon = createIconComponent(
  Nucleo.IconChevronRightOutline18,
  "CaretRightIcon",
);
export const CaretUpIcon = createIconComponent(Nucleo.IconChevronUpOutline18, "CaretUpIcon");
export const ChevronDownIcon = createIconComponent(
  Nucleo.IconChevronDownOutline18,
  "ChevronDownIcon",
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
export const ChatCircleIcon = createIconComponent(Nucleo.IconChatBubbleOutline18, "ChatCircleIcon");
export const ChatCircleTextIcon = createIconComponent(
  Nucleo.IconChatBubbleContentOutline18,
  "ChatCircleTextIcon",
);
export const CheckCircleIcon = createIconComponent(
  Nucleo.IconCircleCheckOutline18,
  "CheckCircleIcon",
);
export const CheckIcon = createIconComponent(Nucleo.IconCheckOutline18, "CheckIcon");
export const CircleIcon = createIconComponent(Nucleo.IconCircleDottedOutline18, "CircleIcon");
export const CirclesThreeIcon = createIconComponent(
  Nucleo.IconCirclesOutline18,
  "CirclesThreeIcon",
);
export const ClipboardIcon = createIconComponent(Nucleo.IconClipboardOutline18, "ClipboardIcon");
export const ClipboardTextIcon = createIconComponent(
  Nucleo.IconClipboardContentOutline18,
  "ClipboardTextIcon",
);
export const ClockCounterClockwiseIcon = createIconComponent(
  Nucleo.IconClockRotateAnticlockwiseOutline18,
  "ClockCounterClockwiseIcon",
);
export const ClockIcon = createIconComponent(Nucleo.IconClockOutline18, "ClockIcon");
export const CloudArrowDownIcon = createIconComponent(
  Nucleo.IconCloudDownloadOutline18,
  "CloudArrowDownIcon",
);
export const CloudCheckIcon = createIconComponent(Nucleo.IconCloudOutline18, "CloudCheckIcon");
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
export const CopySimpleIcon = createIconComponent(Nucleo.IconCopyOutline18, "CopySimpleIcon");
export const CornersInIcon = createIconComponent(
  Nucleo.IconArrowsReduceDiagonalOutline18,
  "CornersInIcon",
);
export const CornersOutIcon = createIconComponent(
  Nucleo.IconArrowsExpandDiagonalOutline18,
  "CornersOutIcon",
);
export const CubeIcon = createIconComponent(Nucleo.IconCubeOutline18, "CubeIcon");
export const CursorClickIcon = createIconComponent(
  Nucleo.IconTouchClickOutline18,
  "CursorClickIcon",
);
export const DatabaseIcon = createIconComponent(Nucleo.IconDatabaseOutline18, "DatabaseIcon");
export const DotOutlineIcon = createIconComponent(Nucleo.IconCircleDotsOutline18, "DotOutlineIcon");
export const DotsThreeIcon = createIconComponent(Nucleo.IconDotsOutline18, "DotsThreeIcon");
export const DownloadIcon = createIconComponent(Nucleo.IconDownloadOutline18, "DownloadIcon");
export const DownloadSimpleIcon = createIconComponent(
  Nucleo.IconDownloadOutline18,
  "DownloadSimpleIcon",
);
export const EyeIcon = createIconComponent(Nucleo.IconEyeOutline18, "EyeIcon");
export const EyeSlashIcon = createIconComponent(Nucleo.IconEyeSlashOutline18, "EyeSlashIcon");
export const FadersHorizontalIcon = createIconComponent(
  Nucleo.IconSlidersOutline18,
  "FadersHorizontalIcon",
);
export const FileCodeIcon = createIconComponent(Nucleo.IconFileSettingsOutline18, "FileCodeIcon");
export const FileIcon = createIconComponent(Nucleo.IconFileOutline18, "FileIcon");
export const FilePlusIcon = createIconComponent(Nucleo.IconFilePlusOutline18, "FilePlusIcon");
export const FileTextIcon = createIconComponent(Nucleo.IconFileContentOutline18, "FileTextIcon");
export const FlipHorizontalIcon = createIconComponent(
  Nucleo.IconFlipHorizontalOutline18,
  "FlipHorizontalIcon",
);
export const FlipVerticalIcon = createIconComponent(
  Nucleo.IconFlipVerticalOutline18,
  "FlipVerticalIcon",
);
export const FloppyDiskIcon = createIconComponent(Nucleo.IconFloppyDiskOutline18, "FloppyDiskIcon");
export const FolderIcon = createIconComponent(Nucleo.IconFolderOutline18, "FolderIcon");
export const FolderOpenIcon = createIconComponent(Nucleo.IconFolderOpenOutline18, "FolderOpenIcon");
export const FolderPlusIcon = createIconComponent(Nucleo.IconFolderPlusOutline18, "FolderPlusIcon");
export const FolderSimpleStarIcon = createIconComponent(
  Nucleo.IconFolderStarOutline18,
  "FolderSimpleStarIcon",
);
export const FunctionIcon = createIconComponent(Nucleo.IconMathFunctionOutline18, "FunctionIcon");
export const FunnelIcon = createIconComponent(Nucleo.IconFilterOutline18, "FunnelIcon");
export const GearIcon = createIconComponent(Nucleo.IconGearOutline18, "GearIcon");
export const GearSixIcon = createIconComponent(Nucleo.IconGear2Outline18, "GearSixIcon");
export const GitBranchIcon = createIconComponent(Nucleo.IconCodeBranchOutline18, "GitBranchIcon");
export const GitCommitIcon = createIconComponent(Nucleo.IconCircleDotsOutline18, "GitCommitIcon");
export const GitDiffIcon = createIconComponent(Nucleo.IconBranchMergeOutline18, "GitDiffIcon");
export const GithubLogoIcon = createIconComponent(Nucleo.IconCodeBranchOutline18, "GithubLogoIcon");
export const GitMergeIcon = createIconComponent(Nucleo.IconBranchMergeOutline18, "GitMergeIcon");
export const GitPullRequestIcon = createIconComponent(
  Nucleo.IconNodesOutline18,
  "GitPullRequestIcon",
);
export const GlobeHemisphereWestIcon = createIconComponent(
  Nucleo.IconGlobeOutline18,
  "GlobeHemisphereWestIcon",
);
export const GlobeIcon = createIconComponent(Nucleo.IconGlobeOutline18, "GlobeIcon");
export const HardDrivesIcon = createIconComponent(Nucleo.IconHardDriveOutline18, "HardDrivesIcon");
export const HashIcon = createIconComponent(Nucleo.IconCircleHashtagOutline18, "HashIcon");
export const HouseIcon = createIconComponent(Nucleo.IconHouseOutline18, "HouseIcon");
export const ImageIcon = createIconComponent(Nucleo.IconImageOutline18, "ImageIcon");
export const InfoIcon = createIconComponent(Nucleo.IconCircleInfoOutline18, "InfoIcon");
export const KeyboardIcon = createIconComponent(Nucleo.IconKeyboardOutline18, "KeyboardIcon");
export const KeyIcon = createIconComponent(Nucleo.IconKeyOutline18, "KeyIcon");
export const LaptopIcon = createIconComponent(Nucleo.IconLaptopOutline18, "LaptopIcon");
export const LightbulbIcon = createIconComponent(Nucleo.IconLightbulbOutline18, "LightbulbIcon");
export const LightningIcon = createIconComponent(
  Nucleo.IconBoltLightningOutline18,
  "LightningIcon",
);
export const LightningSlashIcon = createIconComponent(
  Nucleo.IconBoltLightningSlashOutline18,
  "LightningSlashIcon",
);
export const LinkIcon = createIconComponent(Nucleo.IconLinkOutline18, "LinkIcon");
export const LinkSimpleIcon = createIconComponent(Nucleo.IconLinkOutline18, "LinkSimpleIcon");
export const ListBulletsIcon = createIconComponent(
  Nucleo.IconUnorderedListOutline18,
  "ListBulletsIcon",
);
export const ListChecksIcon = createIconComponent(Nucleo.IconCheckListOutline18, "ListChecksIcon");
export const ListIcon = createIconComponent(Nucleo.IconUnorderedListOutline18, "ListIcon");
export const LockIcon = createIconComponent(Nucleo.IconLockOutline18, "LockIcon");
export const LockKeyIcon = createIconComponent(Nucleo.IconLockKeyOutline18, "LockKeyIcon");
export const LockOpenIcon = createIconComponent(Nucleo.IconLockOpenOutline18, "LockOpenIcon");
export const MagicWandIcon = createIconComponent(Nucleo.IconMagicWandOutline18, "MagicWandIcon");
export const MagnifyingGlassIcon = createIconComponent(
  Nucleo.IconMagnifierOutline18,
  "MagnifyingGlassIcon",
);
export const MagnifyingGlassMinusIcon = createIconComponent(
  Nucleo.IconMagnifierMinusOutline18,
  "MagnifyingGlassMinusIcon",
);
export const MagnifyingGlassPlusIcon = createIconComponent(
  Nucleo.IconMagnifierPlusOutline18,
  "MagnifyingGlassPlusIcon",
);
export const MegaphoneIcon = createIconComponent(Nucleo.IconMegaphoneOutline18, "MegaphoneIcon");
export const MicrophoneIcon = createIconComponent(Nucleo.IconMicrophoneOutline18, "MicrophoneIcon");
export const MinusCircleIcon = createIconComponent(
  Nucleo.IconCircleMinusOutline18,
  "MinusCircleIcon",
);
export const MinusIcon = createIconComponent(Nucleo.IconMinusOutline18, "MinusIcon");
export const MonitorIcon = createIconComponent(Nucleo.IconMonitorOutline18, "MonitorIcon");
export const MoonIcon = createIconComponent(Nucleo.IconMoonOutline18, "MoonIcon");
export const NavigationArrowIcon = createIconComponent(
  Nucleo.IconArrowUpRightOutline18,
  "NavigationArrowIcon",
);
export const NetworkIcon = createIconComponent(Nucleo.IconNodesOutline18, "NetworkIcon");
export const PackageIcon = createIconComponent(Nucleo.IconBoxOutline18, "PackageIcon");
export const PaintBrushIcon = createIconComponent(Nucleo.IconBrushOutline18, "PaintBrushIcon");
export const PaletteIcon = createIconComponent(Nucleo.IconPaletteOutline18, "PaletteIcon");
export const PaperPlaneTiltIcon = createIconComponent(
  Nucleo.IconPaperPlane2Outline18,
  "PaperPlaneTiltIcon",
);
export const PauseIcon = createIconComponent(
  Nucleo.IconCircleHalfDashedPauseOutline18,
  "PauseIcon",
);
export const PencilIcon = createIconComponent(Nucleo.IconPencilOutline18, "PencilIcon");
export const PencilLineIcon = createIconComponent(
  Nucleo.IconPenWriting4Outline18,
  "PencilLineIcon",
);
export const PencilSimpleIcon = createIconComponent(Nucleo.IconPen3Outline18, "PencilSimpleIcon");
export const PencilSimpleLineIcon = createIconComponent(
  Nucleo.IconPenWriting4Outline18,
  "PencilSimpleLineIcon",
);
export const PlayCircleIcon = createIconComponent(Nucleo.IconCirclePlayOutline18, "PlayCircleIcon");
export const PlayIcon = createIconComponent(Nucleo.IconMediaPlayOutline18, "PlayIcon");
export const PlugsConnectedIcon = createIconComponent(
  Nucleo.IconPlug2Outline18,
  "PlugsConnectedIcon",
);
export const PlusCircleIcon = createIconComponent(Nucleo.IconCirclePlusOutline18, "PlusCircleIcon");
export const PlusIcon = createIconComponent(Nucleo.IconPlusOutline18, "PlusIcon");
export const PulseIcon = createIconComponent(Nucleo.IconChartActivityOutline18, "PulseIcon");
export const PushPinIcon = createIconComponent(Nucleo.IconPinTackOutline18, "PushPinIcon");
export const PushPinSlashIcon = createIconComponent(
  Nucleo.IconPinSlashOutline18,
  "PushPinSlashIcon",
);
export const PuzzlePieceIcon = createIconComponent(
  Nucleo.IconPuzzlePieceOutline18,
  "PuzzlePieceIcon",
);
export const QuestionIcon = createIconComponent(Nucleo.IconCircleQuestionOutline18, "QuestionIcon");
export const RadioButtonIcon = createIconComponent(Nucleo.IconRadioOutline18, "RadioButtonIcon");
export const RobotIcon = createIconComponent(Nucleo.IconRobotOutline18, "RobotIcon");
export const RocketLaunchIcon = createIconComponent(Nucleo.IconRocketOutline18, "RocketLaunchIcon");
export const RowsIcon = createIconComponent(Nucleo.IconTableRowsOutline18, "RowsIcon");
export const RowsPlusTopIcon = createIconComponent(
  Nucleo.IconTableRowNewTopOutline18,
  "RowsPlusTopIcon",
);
export const ScissorsIcon = createIconComponent(Nucleo.IconScissorsOutline18, "ScissorsIcon");
export const ShieldCheckIcon = createIconComponent(
  Nucleo.IconShieldCheckOutline18,
  "ShieldCheckIcon",
);
export const ShieldIcon = createIconComponent(Nucleo.IconShieldOutline18, "ShieldIcon");
export const ShieldWarningIcon = createIconComponent(
  Nucleo.IconShieldAlertOutline18,
  "ShieldWarningIcon",
);
export const SidebarSimpleIcon = createIconComponent(
  Nucleo.IconSidebarLeftShowOutline18,
  "SidebarSimpleIcon",
);
export const SignInIcon = createIconComponent(Nucleo.IconArrowDoorInOutline18, "SignInIcon");
export const SlidersHorizontalIcon = createIconComponent(
  Nucleo.IconSlidersOutline18,
  "SlidersHorizontalIcon",
);
export const SlidersIcon = createIconComponent(Nucleo.IconSlidersOutline18, "SlidersIcon");
export const SparkleIcon = createIconComponent(Nucleo.IconSparkleOutline18, "SparkleIcon");
export const SquareIcon = createIconComponent(Nucleo.IconShapeSquareOutline18, "SquareIcon");
export const SquaresFourIcon = createIconComponent(
  Nucleo.IconSquareGrid2Outline18,
  "SquaresFourIcon",
);
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
export const TextAaIcon = createIconComponent(Nucleo.IconTextAOutline18, "TextAaIcon");
export const TextAlignCenterIcon = createIconComponent(
  Nucleo.IconTextAlignCenterOutline18,
  "TextAlignCenterIcon",
);
export const TextAlignJustifyIcon = createIconComponent(
  Nucleo.IconTextAlignJustifyOutline18,
  "TextAlignJustifyIcon",
);
export const TextAlignLeftIcon = createIconComponent(
  Nucleo.IconTextAlignLeftOutline18,
  "TextAlignLeftIcon",
);
export const TextIndentIcon = createIconComponent(
  Nucleo.IconIndentIncreaseOutline18,
  "TextIndentIcon",
);
export const TextOutdentIcon = createIconComponent(
  Nucleo.IconIndentDecreaseOutline18,
  "TextOutdentIcon",
);
export const TextTIcon = createIconComponent(Nucleo.IconTextOutline18, "TextTIcon");
export const TranslateIcon = createIconComponent(Nucleo.IconLanguageOutline18, "TranslateIcon");
export const TrashIcon = createIconComponent(Nucleo.IconTrashOutline18, "TrashIcon");
export const TreeStructureIcon = createIconComponent(
  Nucleo.IconSitemapOutline18,
  "TreeStructureIcon",
);
export const UploadIcon = createIconComponent(Nucleo.IconUploadOutline18, "UploadIcon");
export const UploadSimpleIcon = createIconComponent(Nucleo.IconUploadOutline18, "UploadSimpleIcon");
export const UserCircleIcon = createIconComponent(Nucleo.IconCircleUserOutline18, "UserCircleIcon");
export const UserIcon = createIconComponent(Nucleo.IconUserOutline18, "UserIcon");
export const UsersThreeIcon = createIconComponent(Nucleo.IconUsersOutline18, "UsersThreeIcon");
export const WarningCircleIcon = createIconComponent(
  Nucleo.IconCircleWarningOutline18,
  "WarningCircleIcon",
);
export const WarningIcon = createIconComponent(Nucleo.IconTriangleWarningOutline18, "WarningIcon");
export const WifiHighIcon = createIconComponent(Nucleo.IconWifiOutline18, "WifiHighIcon");
export const WifiSlashIcon = createIconComponent(Nucleo.IconWifiOffOutline18, "WifiSlashIcon");
export const WrenchIcon = createIconComponent(Nucleo.IconWrenchOutline18, "WrenchIcon");
export const XCircleIcon = createIconComponent(Nucleo.IconCircleXmarkOutline18, "XCircleIcon");
export const XIcon = createIconComponent(Nucleo.IconXmarkOutline18, "XIcon");

export const BellIcon = createIconComponent(Nucleo.IconBellOutline18, "BellIcon");
export const BoxIcon = createIconComponent(Nucleo.IconBoxOutline18, "BoxIcon");
export const ChevronExpandYIcon = createIconComponent(
  Nucleo.IconChevronExpandYOutline18,
  "ChevronExpandYIcon",
);
export const CreditCardIcon = createIconComponent(Nucleo.IconCreditCardOutline18, "CreditCardIcon");
export const ExtensionsIcon = createIconComponent(Nucleo.IconAppStackOutline18, "ExtensionsIcon");
export const FilesIcon = createIconComponent(Nucleo.IconFiles2Outline18, "FilesIcon");
export const MoneyIcon = createIconComponent(Nucleo.IconMoneyBillCoinOutline18, "MoneyIcon");
export const NodesIcon = createIconComponent(Nucleo.IconNodesOutline18, "NodesIcon");
export const OpenExternalIcon = createIconComponent(
  Nucleo.IconOpenExternalOutline18,
  "OpenExternalIcon",
);
export const PenIcon = createIconComponent(Nucleo.IconPen3Outline18, "PenIcon");
export const RefreshIcon = createIconComponent(Nucleo.IconRefresh2Outline18, "RefreshIcon");
export const RemoteIcon = createIconComponent(Nucleo.IconComputerOutline18, "RemoteIcon");
export const SignOutIcon = createIconComponent(Nucleo.IconArrowDoorOut3Outline18, "SignOutIcon");
export const WindowExpandIcon = createIconComponent(
  Nucleo.IconOpenInNewWindowOutline18,
  "WindowExpandIcon",
);
