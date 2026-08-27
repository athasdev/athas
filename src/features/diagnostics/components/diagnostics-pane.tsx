import {
  WarningCircleIcon as AlertCircle,
  WarningIcon as AlertTriangle,
  CheckIcon as Check,
  CopyIcon as Copy,
  FunnelIcon as Filter,
  InfoIcon as Info,
  MagicWandIcon as WandSparkles,
} from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { MultibufferFileHeader } from "@/features/editor/components/multibuffer/multibuffer-file-header";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { FileResultsWorkspace } from "@/features/file-explorer/components/file-results-workspace";
import {
  type FileNavigatorItem,
  type FileNavigatorViewMode,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import { useToast } from "@/features/layout/contexts/toast-context";
import { writeClipboardText } from "@/utils/clipboard";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui/accordion";
import Badge from "@/ui/badge";
import { ContextMenuPopup, createContextMenuGroups } from "@/ui/context-menu";
import { Dropdown, useDropdownMenu, type MenuItem } from "@/ui/dropdown";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyState,
  EmptyTitle,
} from "@/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/ui/item";
import { cn } from "@/utils/cn";
import { getBaseName, getDirName, getRelativePath, normalizePath } from "@/utils/path-helpers";
import type { Diagnostic, DiagnosticCodeAction } from "../types/diagnostics.types";
import { DiagnosticsToolbar } from "./diagnostics-toolbar";

interface DiagnosticsPaneProps {
  diagnostics: Diagnostic[];
  onDiagnosticClick?: (diagnostic: Diagnostic) => void;
}

type GroupBy = "severity" | "file" | "none";
type SortBy = "severity" | "file" | "position";

type FilterMenuType = "filters";

interface PanePreferences {
  groupBy: GroupBy;
  sortBy: SortBy;
  onlyCurrentFile: boolean;
  wrapMessages: boolean;
  fileNavigatorViewMode: FileNavigatorViewMode;
}

interface DiagnosticGroup {
  id: string;
  label: string;
  items: Diagnostic[];
  severity?: Diagnostic["severity"];
}

const PREFS_STORAGE_KEY = "diagnostics-pane-prefs";

const DEFAULT_PREFERENCES: PanePreferences = {
  groupBy: "file",
  sortBy: "severity",
  onlyCurrentFile: false,
  wrapMessages: true,
  fileNavigatorViewMode: "flat",
};

const GROUP_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: "file", label: "File" },
  { value: "severity", label: "Severity" },
  { value: "none", label: "None" },
];

const SORT_OPTIONS: Array<{ value: SortBy; label: string }> = [
  { value: "severity", label: "Severity" },
  { value: "file", label: "File" },
  { value: "position", label: "Position" },
];

const SEVERITY_ORDER: Record<Diagnostic["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const SEVERITY_LABEL: Record<Diagnostic["severity"], string> = {
  error: "Errors",
  warning: "Warnings",
  info: "Info",
};

const getSeverityIcon = (severity: Diagnostic["severity"], size = 11) => {
  switch (severity) {
    case "error":
      return <AlertCircle size={size} className="text-destructive" />;
    case "warning":
      return <AlertTriangle size={size} className="text-warning" />;
    case "info":
      return <Info size={size} className="text-info" />;
    default:
      return <Info size={size} className="text-subtle-foreground" />;
  }
};

const isAbsolutePath = (filePath: string) => {
  return filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath);
};

const getDiagnosticNavigatorPath = (filePath: string, rootFolderPath: string | undefined) => {
  const relativePath = getRelativePath(filePath, rootFolderPath);
  if (relativePath && relativePath !== filePath) return relativePath;
  if (isAbsolutePath(filePath)) return getBaseName(filePath, filePath);
  return normalizePath(filePath);
};

const getHighestSeverity = (
  counts: Record<Diagnostic["severity"], number>,
): Diagnostic["severity"] => {
  if (counts.error > 0) return "error";
  if (counts.warning > 0) return "warning";
  return "info";
};

const buildDiagnosticKey = (diagnostic: Diagnostic) => {
  return [
    diagnostic.filePath,
    diagnostic.line,
    diagnostic.column,
    diagnostic.endLine,
    diagnostic.endColumn,
    diagnostic.message,
    diagnostic.code || "",
    diagnostic.source || "",
  ].join("::");
};

const splitDiagnosticMessage = (
  message: string,
): { summary: string; description: string | null } => {
  const normalized = message.replace(/\r\n/g, "\n").trim();
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { summary: "Diagnostic", description: null };
  }

  const [summary, ...rest] = lines;
  const description = rest.join(" ").trim();

  return {
    summary,
    description: description.length > 0 ? description : null,
  };
};

const loadPreferences = (): PanePreferences => {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;

  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;

    const parsed = JSON.parse(raw) as Partial<PanePreferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
};

const copyToClipboard = async (text: string) => {
  await writeClipboardText(text);
};

const DiagnosticsPane = ({ diagnostics, onDiagnosticClick }: DiagnosticsPaneProps) => {
  const { showToast } = useToast();
  const lspClient = useMemo(() => LspClient.getInstance(), []);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);

  const diagnosticContextMenu = useDropdownMenu<Diagnostic>();
  const filterContextMenu = useDropdownMenu<FilterMenuType>();

  const activeFilePath = useBufferStore((state) => {
    const activeBuffer = state.activeBufferId
      ? state.buffers.find((buffer) => buffer.id === state.activeBufferId)
      : null;
    if (!activeBuffer) return null;

    if (activeBuffer.type !== "editor" || activeBuffer.isVirtual) {
      return null;
    }

    return activeBuffer.path;
  });

  const [preferences, setPreferences] = useState<PanePreferences>(() => loadPreferences());
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Record<Diagnostic["severity"], boolean>>({
    error: true,
    warning: true,
    info: true,
  });
  const [isFileNavigatorVisible, setIsFileNavigatorVisible] = useState(false);
  const [selectedDiagnosticFilePath, setSelectedDiagnosticFilePath] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const [codeActionsByDiagnostic, setCodeActionsByDiagnostic] = useState<
    Record<string, DiagnosticCodeAction[]>
  >({});
  const [loadingActionsKey, setLoadingActionsKey] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  // Fetch quick-fix actions lazily only when a diagnostic is right-clicked.
  useEffect(() => {
    if (!diagnosticContextMenu.isOpen || !diagnosticContextMenu.data) return;

    const diagnostic = diagnosticContextMenu.data;
    const key = buildDiagnosticKey(diagnostic);

    if (codeActionsByDiagnostic[key]) return;

    let cancelled = false;
    setLoadingActionsKey(key);

    lspClient
      .getCodeActions(diagnostic.filePath, diagnostic)
      .then((actions) => {
        if (cancelled) return;
        setCodeActionsByDiagnostic((prev) => ({
          ...prev,
          [key]: actions,
        }));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingActionsKey((prev) => (prev === key ? null : prev));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    codeActionsByDiagnostic,
    diagnosticContextMenu.data,
    diagnosticContextMenu.isOpen,
    lspClient,
  ]);

  const filteredDiagnostics = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const normalizedSourceFilter = sourceFilter?.toLowerCase() ?? null;

    const filtered = diagnostics.filter((diagnostic) => {
      if (!severityFilter[diagnostic.severity]) return false;

      if (
        preferences.onlyCurrentFile &&
        activeFilePath &&
        diagnostic.filePath.toLowerCase() !== activeFilePath.toLowerCase()
      ) {
        return false;
      }

      if (normalizedSourceFilter) {
        const source = diagnostic.source?.toLowerCase() || "";
        if (source !== normalizedSourceFilter) {
          return false;
        }
      }

      if (!normalizedQuery) return true;

      const haystack = [
        diagnostic.message,
        diagnostic.source || "",
        diagnostic.code || "",
        diagnostic.filePath,
        `${diagnostic.line + 1}:${diagnostic.column + 1}`,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });

    return filtered.sort((left, right) => {
      if (preferences.sortBy === "severity") {
        const severityDiff = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
        if (severityDiff !== 0) return severityDiff;
      }

      if (preferences.sortBy === "file" || preferences.sortBy === "severity") {
        const fileDiff = left.filePath.localeCompare(right.filePath);
        if (fileDiff !== 0) return fileDiff;
      }

      const lineDiff = left.line - right.line;
      if (lineDiff !== 0) return lineDiff;

      return left.column - right.column;
    });
  }, [activeFilePath, diagnostics, preferences, searchQuery, severityFilter, sourceFilter]);

  const groupedDiagnostics = useMemo<DiagnosticGroup[]>(() => {
    if (preferences.groupBy === "none") {
      return [
        {
          id: "all",
          label: "All Diagnostics",
          items: filteredDiagnostics,
        },
      ];
    }

    if (preferences.groupBy === "severity") {
      return ["error", "warning", "info"]
        .map((severity) => {
          const items = filteredDiagnostics.filter(
            (diagnostic) => diagnostic.severity === severity,
          );
          return {
            id: `severity-${severity}`,
            label: SEVERITY_LABEL[severity as Diagnostic["severity"]],
            items,
            severity: severity as Diagnostic["severity"],
          };
        })
        .filter((group) => group.items.length > 0);
    }

    const byFile = new Map<string, Diagnostic[]>();
    for (const diagnostic of filteredDiagnostics) {
      const current = byFile.get(diagnostic.filePath) || [];
      current.push(diagnostic);
      byFile.set(diagnostic.filePath, current);
    }

    return Array.from(byFile.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, items]) => ({
        id: `file-${filePath}`,
        label: filePath,
        items,
      }));
  }, [filteredDiagnostics, preferences.groupBy]);

  const expandedGroupIds = useMemo(
    () => groupedDiagnostics.filter((group) => !collapsedGroups[group.id]).map((group) => group.id),
    [collapsedGroups, groupedDiagnostics],
  );

  const totalBySeverity = useMemo(() => {
    return diagnostics.reduce(
      (acc, diagnostic) => {
        acc[diagnostic.severity] += 1;
        return acc;
      },
      { error: 0, warning: 0, info: 0 },
    );
  }, [diagnostics]);

  const visibleBySeverity = useMemo(() => {
    return filteredDiagnostics.reduce(
      (acc, diagnostic) => {
        acc[diagnostic.severity] += 1;
        return acc;
      },
      { error: 0, warning: 0, info: 0 },
    );
  }, [filteredDiagnostics]);

  const diagnosticFileItems = useMemo<FileNavigatorItem[]>(() => {
    const byFile = new Map<
      string,
      {
        total: number;
        counts: Record<Diagnostic["severity"], number>;
      }
    >();

    for (const diagnostic of filteredDiagnostics) {
      const current =
        byFile.get(diagnostic.filePath) ??
        ({
          total: 0,
          counts: { error: 0, warning: 0, info: 0 },
        } satisfies {
          total: number;
          counts: Record<Diagnostic["severity"], number>;
        });

      current.total += 1;
      current.counts[diagnostic.severity] += 1;
      byFile.set(diagnostic.filePath, current);
    }

    return Array.from(byFile.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, summary]) => {
        const severity = getHighestSeverity(summary.counts);
        const navigatorPath = getDiagnosticNavigatorPath(filePath, rootFolderPath);

        return {
          key: filePath,
          path: navigatorPath,
          label: navigatorPath,
          iconPath: filePath,
          iconTone: severity,
          metadata: [
            {
              label: summary.total,
              tone: severity,
            },
          ],
        };
      });
  }, [filteredDiagnostics, rootFolderPath]);

  const selectedFileNavigatorKey = useMemo(() => {
    if (
      selectedDiagnosticFilePath &&
      diagnosticFileItems.some((item) => item.key === selectedDiagnosticFilePath)
    ) {
      return selectedDiagnosticFilePath;
    }

    if (activeFilePath && diagnosticFileItems.some((item) => item.key === activeFilePath)) {
      return activeFilePath;
    }

    return null;
  }, [activeFilePath, diagnosticFileItems, selectedDiagnosticFilePath]);

  const toggleSeverity = useCallback((severity: Diagnostic["severity"]) => {
    setSeverityFilter((prev) => ({
      ...prev,
      [severity]: !prev[severity],
    }));
  }, []);

  const togglePreference = useCallback(<K extends keyof PanePreferences>(key: K) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: typeof prev[key] === "boolean" ? !prev[key] : prev[key],
    }));
  }, []);

  const resetFilters = useCallback(() => {
    setSearchQuery("");
    setSourceFilter(null);
    setSeverityFilter({
      error: true,
      warning: true,
      info: true,
    });
    setPreferences((prev) => ({
      ...DEFAULT_PREFERENCES,
      fileNavigatorViewMode: prev.fileNavigatorViewMode,
    }));
  }, []);

  const setExpandedGroupIds = useCallback(
    (expandedIds: string[]) => {
      const expanded = new Set(expandedIds);
      setCollapsedGroups(
        Object.fromEntries(groupedDiagnostics.map((group) => [group.id, !expanded.has(group.id)])),
      );
    },
    [groupedDiagnostics],
  );

  const selectDiagnosticFile = useCallback(
    (filePath: string) => {
      setSelectedDiagnosticFilePath(filePath);
      setCollapsedGroups((prev) => ({
        ...prev,
        [`file-${filePath}`]: false,
      }));

      const diagnostic = filteredDiagnostics.find((item) => item.filePath === filePath);
      if (diagnostic) {
        onDiagnosticClick?.(diagnostic);
      }
    },
    [filteredDiagnostics, onDiagnosticClick],
  );

  const applyCodeAction = useCallback(
    async (diagnostic: Diagnostic, action: DiagnosticCodeAction) => {
      const result = await lspClient.applyCodeAction(diagnostic.filePath, action.payload);

      if (result.applied) {
        showToast({
          message: `Applied: ${action.title}`,
          type: "success",
        });
        return;
      }

      showToast({
        message: result.reason || `Unable to apply action: ${action.title}`,
        type: "warning",
      });
    },
    [lspClient, showToast],
  );

  const copyDiagnosticMessage = useCallback(
    async (diagnostic: Diagnostic) => {
      await copyToClipboard(diagnostic.message);
      showToast({ message: "Diagnostic message copied", type: "success" });
    },
    [showToast],
  );

  const copyDiagnosticLocation = useCallback(
    async (diagnostic: Diagnostic) => {
      const text = `${diagnostic.filePath}:${diagnostic.line + 1}:${diagnostic.column + 1}`;
      await copyToClipboard(text);
      showToast({ message: "Diagnostic location copied", type: "success" });
    },
    [showToast],
  );

  const copyDiagnosticDetails = useCallback(
    async (diagnostic: Diagnostic) => {
      const details = [
        `${diagnostic.filePath}:${diagnostic.line + 1}:${diagnostic.column + 1}`,
        diagnostic.severity.toUpperCase(),
        diagnostic.message,
        diagnostic.source ? `source: ${diagnostic.source}` : "",
        diagnostic.code ? `code: ${diagnostic.code}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      await copyToClipboard(details);
      showToast({ message: "Diagnostic details copied", type: "success" });
    },
    [showToast],
  );

  const diagnosticContextMenuItems = useMemo<MenuItem[]>(() => {
    const diagnostic = diagnosticContextMenu.data;
    if (!diagnostic) return [];

    const key = buildDiagnosticKey(diagnostic);
    const codeActions = codeActionsByDiagnostic[key] || [];
    const isLoading = loadingActionsKey === key;

    const items: MenuItem[] = [];

    if (isLoading) {
      items.push({
        id: "loading-actions",
        label: "Loading quick fixes...",
        icon: <WandSparkles />,
        onClick: () => {},
        disabled: true,
      });
    } else if (codeActions.length > 0) {
      codeActions.slice(0, 8).forEach((action) => {
        const unsupportedEditOnly = action.hasEdit && !action.hasCommand;
        const disabledReason = action.disabledReason || (unsupportedEditOnly ? "Unsupported" : "");

        items.push({
          id: `quick-fix-${action.id}`,
          label: action.title,
          icon: <WandSparkles />,
          onClick: () => {
            void applyCodeAction(diagnostic, action);
          },
          disabled: Boolean(disabledReason),
        });
      });
    } else {
      items.push({
        id: "no-actions",
        label: "No quick fixes available",
        icon: <WandSparkles />,
        onClick: () => {},
        disabled: true,
      });
    }

    items.push({ id: "sep-actions", separator: true });

    items.push(
      {
        id: "go-to-problem",
        label: "Go to Problem",
        onClick: () => onDiagnosticClick?.(diagnostic),
      },
      {
        id: "copy-message",
        label: "Copy Message",
        icon: <Copy />,
        onClick: () => {
          void copyDiagnosticMessage(diagnostic);
        },
      },
      {
        id: "copy-location",
        label: "Copy Location",
        icon: <Copy />,
        onClick: () => {
          void copyDiagnosticLocation(diagnostic);
        },
      },
      {
        id: "copy-details",
        label: "Copy Full Details",
        icon: <Copy />,
        onClick: () => {
          void copyDiagnosticDetails(diagnostic);
        },
      },
    );

    if (diagnostic.source) {
      const source = diagnostic.source;
      if (sourceFilter?.toLowerCase() === source.toLowerCase()) {
        items.push({
          id: "clear-source-filter",
          label: "Clear Source Filter",
          icon: <Filter />,
          onClick: () => setSourceFilter(null),
        });
      } else {
        items.push({
          id: "filter-by-source",
          label: `Filter by Source: ${source}`,
          icon: <Filter />,
          onClick: () => setSourceFilter(source),
        });
      }
    }

    items.push({ id: "sep-view", separator: true });

    items.push({
      id: "toggle-wrap",
      label: preferences.wrapMessages ? "Disable Message Wrap" : "Enable Message Wrap",
      onClick: () => togglePreference("wrapMessages"),
    });

    return items;
  }, [
    applyCodeAction,
    codeActionsByDiagnostic,
    copyDiagnosticDetails,
    copyDiagnosticLocation,
    copyDiagnosticMessage,
    diagnosticContextMenu.data,
    loadingActionsKey,
    onDiagnosticClick,
    preferences.wrapMessages,
    sourceFilter,
    togglePreference,
  ]);

  const hasNonDefaultPreferences =
    preferences.groupBy !== DEFAULT_PREFERENCES.groupBy ||
    preferences.sortBy !== DEFAULT_PREFERENCES.sortBy ||
    preferences.onlyCurrentFile !== DEFAULT_PREFERENCES.onlyCurrentFile;

  const hasFilterSettings =
    Boolean(sourceFilter) ||
    !severityFilter.error ||
    !severityFilter.warning ||
    !severityFilter.info ||
    hasNonDefaultPreferences;

  const hasFilters = Boolean(searchQuery.trim()) || hasFilterSettings;

  const activeFilterCount =
    Number(Boolean(sourceFilter)) +
    Number(!severityFilter.error) +
    Number(!severityFilter.warning) +
    Number(!severityFilter.info) +
    Number(preferences.groupBy !== DEFAULT_PREFERENCES.groupBy) +
    Number(preferences.sortBy !== DEFAULT_PREFERENCES.sortBy) +
    Number(preferences.onlyCurrentFile !== DEFAULT_PREFERENCES.onlyCurrentFile);

  const visibleProblemCount = filteredDiagnostics.length;
  const hasDiagnosticFiles = diagnosticFileItems.length > 0;
  const resultLabel = hasFilters
    ? `${visibleProblemCount} of ${diagnostics.length} problems`
    : `${visibleProblemCount} ${visibleProblemCount === 1 ? "problem" : "problems"}`;
  const resultSummary = [
    visibleBySeverity.error > 0 ? `${visibleBySeverity.error} errors` : null,
    visibleBySeverity.warning > 0 ? `${visibleBySeverity.warning} warnings` : null,
    visibleBySeverity.info > 0 ? `${visibleBySeverity.info} info` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const filterContextMenuItems = useMemo<MenuItem[]>(() => {
    if (!filterContextMenu.data) return [];

    const items: MenuItem[] = [];

    items.push(
      ...GROUP_OPTIONS.map((option) => ({
        id: `group-${option.value}`,
        label: `Group by: ${option.label}`,
        icon: preferences.groupBy === option.value ? <Check /> : undefined,
        onClick: () => {
          setPreferences((prev) => ({
            ...prev,
            groupBy: option.value,
          }));
        },
      })),
    );

    items.push({ id: "sep-group", separator: true });

    items.push(
      ...SORT_OPTIONS.map((option) => ({
        id: `sort-${option.value}`,
        label: `Sort by: ${option.label}`,
        icon: preferences.sortBy === option.value ? <Check /> : undefined,
        onClick: () => {
          setPreferences((prev) => ({
            ...prev,
            sortBy: option.value,
          }));
        },
      })),
    );

    items.push({ id: "sep-sort", separator: true });

    for (const severity of ["error", "warning", "info"] as Diagnostic["severity"][]) {
      items.push({
        id: `severity-${severity}`,
        label: `${SEVERITY_LABEL[severity]} (${visibleBySeverity[severity]}/${totalBySeverity[severity]})`,
        icon: severityFilter[severity] ? <Check /> : undefined,
        onClick: () => toggleSeverity(severity),
      });
    }

    if (activeFilePath) {
      items.push({
        id: "only-current-file",
        label: "Only Current File",
        icon: preferences.onlyCurrentFile ? <Check /> : undefined,
        onClick: () => togglePreference("onlyCurrentFile"),
      });
    }

    if (sourceFilter) {
      items.push({
        id: "clear-source-filter",
        label: `Clear Source Filter (${sourceFilter})`,
        onClick: () => setSourceFilter(null),
      });
    }

    if (hasFilters) {
      items.push({
        id: "reset-filters",
        label: "Reset All Filters",
        onClick: resetFilters,
      });
    }

    return items;
  }, [
    activeFilePath,
    hasFilters,
    preferences.groupBy,
    preferences.onlyCurrentFile,
    preferences.sortBy,
    resetFilters,
    filterContextMenu.data,
    severityFilter,
    sourceFilter,
    togglePreference,
    toggleSeverity,
    totalBySeverity,
    visibleBySeverity,
  ]);

  const renderDiagnosticItems = (items: Diagnostic[]) => (
    <ItemGroup className="gap-0.5">
      {items.map((diagnostic) => {
        const rowKey = buildDiagnosticKey(diagnostic);
        const { summary, description } = splitDiagnosticMessage(diagnostic.message);
        const displayPath = getDiagnosticNavigatorPath(diagnostic.filePath, rootFolderPath);

        return (
          <Item
            key={rowKey}
            render={<button type="button" />}
            size="sm"
            onClick={() => onDiagnosticClick?.(diagnostic)}
            onContextMenu={(event) => {
              diagnosticContextMenu.open(event, diagnostic);
            }}
            className="flex-nowrap text-left"
          >
            <ItemMedia variant="icon" className="self-start pt-0.5">
              {getSeverityIcon(diagnostic.severity, 13)}
            </ItemMedia>

            <ItemContent>
              <ItemTitle
                className={cn(
                  "w-full font-normal",
                  preferences.wrapMessages
                    ? "line-clamp-none whitespace-pre-wrap wrap-break-word"
                    : "block truncate",
                )}
              >
                {summary}
              </ItemTitle>

              {description ? (
                <ItemDescription
                  className={cn(
                    preferences.wrapMessages
                      ? "line-clamp-none whitespace-pre-wrap wrap-break-word"
                      : "truncate",
                  )}
                >
                  {description}
                </ItemDescription>
              ) : null}

              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="ui-text-sm max-w-full truncate text-subtle-foreground">
                  {displayPath}
                </span>
                {diagnostic.source ? (
                  <span className="ui-text-sm text-subtle-foreground">{diagnostic.source}</span>
                ) : null}
                {diagnostic.code ? (
                  <span className="font-mono ui-text-sm text-subtle-foreground">
                    {diagnostic.code}
                  </span>
                ) : null}
              </div>
            </ItemContent>

            <ItemActions className="self-start">
              <span className="ui-text-sm tabular-nums text-subtle-foreground">
                {diagnostic.line + 1}:{diagnostic.column + 1}
              </span>
            </ItemActions>
          </Item>
        );
      })}
    </ItemGroup>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <DiagnosticsToolbar
        inputRef={searchInputRef}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onOpenFilters={(event) => filterContextMenu.open(event, "filters")}
        activeFilterCount={activeFilterCount}
        resultLabel={resultLabel}
        resultSummary={resultSummary}
        fileNavigatorAvailable={hasDiagnosticFiles}
        fileNavigatorVisible={isFileNavigatorVisible}
        onFileNavigatorVisibleChange={setIsFileNavigatorVisible}
      />

      <div className="min-h-0 flex-1">
        <FileResultsWorkspace
          items={diagnosticFileItems}
          selectedKey={selectedFileNavigatorKey}
          onSelect={selectDiagnosticFile}
          ariaLabel="Diagnostic files"
          viewMode={preferences.fileNavigatorViewMode}
          onViewModeChange={(fileNavigatorViewMode) =>
            setPreferences((prev) => ({
              ...prev,
              fileNavigatorViewMode,
            }))
          }
          showNavigator={isFileNavigatorVisible && hasDiagnosticFiles}
          navigatorPosition="right"
          navigatorResponsiveOverlay
          navigatorAppearance="panel"
          contentInset={false}
          scrollbarVisibility="always"
          reserveScrollbarGutter
        >
          {diagnostics.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Check />
                </EmptyMedia>
                <EmptyTitle>No problems detected</EmptyTitle>
                <EmptyDescription>
                  Diagnostics will appear here when a language service finds an issue.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : filteredDiagnostics.length === 0 ? (
            <EmptyState
              message="No problems match the current filters"
              action={hasFilters ? { label: "Reset filters", onClick: resetFilters } : undefined}
            />
          ) : preferences.groupBy === "none" ? (
            <div className="px-2 py-1">
              {renderDiagnosticItems(groupedDiagnostics[0]?.items ?? [])}
            </div>
          ) : preferences.groupBy === "file" ? (
            <div className="min-w-0 max-w-full">
              {groupedDiagnostics.map((group) => {
                const relativePath = getDiagnosticNavigatorPath(group.label, rootFolderPath);
                const fileName = getBaseName(relativePath, relativePath);
                const directoryPath = getDirName(relativePath);
                const expanded = !collapsedGroups[group.id];
                const firstDiagnostic = group.items[0];

                return (
                  <section key={group.id} className="border-border/60 border-b">
                    <MultibufferFileHeader
                      filePath={group.label}
                      fileName={fileName}
                      directoryPath={directoryPath}
                      expanded={expanded}
                      onToggle={() =>
                        setCollapsedGroups((current) => ({
                          ...current,
                          [group.id]: !current[group.id],
                        }))
                      }
                      onOpen={() => {
                        if (firstDiagnostic) onDiagnosticClick?.(firstDiagnostic);
                      }}
                      trailing={`${group.items.length} ${group.items.length === 1 ? "problem" : "problems"}`}
                      surface="section"
                    />
                    {expanded ? (
                      <div className="px-2 py-1">{renderDiagnosticItems(group.items)}</div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <Accordion
              multiple
              value={expandedGroupIds}
              onValueChange={(value) => setExpandedGroupIds(value)}
              className="gap-2 px-2 py-2"
            >
              {groupedDiagnostics.map((group) => (
                <AccordionItem key={group.id} value={group.id}>
                  <AccordionTrigger>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      {group.severity ? getSeverityIcon(group.severity, 13) : null}
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                      <Badge variant="muted" size="compact" className="shrink-0">
                        {group.items.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>{renderDiagnosticItems(group.items)}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </FileResultsWorkspace>
      </div>

      <ContextMenuPopup
        isOpen={diagnosticContextMenu.isOpen}
        point={diagnosticContextMenu.position}
        groups={createContextMenuGroups(diagnosticContextMenuItems)}
        onClose={diagnosticContextMenu.close}
      />

      <Dropdown
        isOpen={filterContextMenu.isOpen}
        point={filterContextMenu.position}
        items={filterContextMenuItems}
        onClose={filterContextMenu.close}
      />
    </div>
  );
};

export default DiagnosticsPane;
