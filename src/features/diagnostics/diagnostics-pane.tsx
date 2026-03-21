import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Filter,
  Info,
  Search,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuItem } from "@/ui/context-menu";
import { ContextMenu } from "@/ui/context-menu";
import { PANE_CHIP_BASE, paneHeaderClassName, paneIconButtonClassName } from "@/ui/pane";
import { SearchPopover } from "@/ui/search-popover";
import { cn } from "@/utils/cn";
import type { Diagnostic, DiagnosticCodeAction } from "./types";

interface DiagnosticsPaneProps {
  diagnostics: Diagnostic[];
  isVisible: boolean;
  onClose: () => void;
  onDiagnosticClick?: (diagnostic: Diagnostic) => void;
  isEmbedded?: boolean;
}

type GroupBy = "severity" | "file" | "none";
type SortBy = "severity" | "file" | "position";

type FilterMenuType = "filters";

interface PanePreferences {
  groupBy: GroupBy;
  sortBy: SortBy;
  onlyCurrentFile: boolean;
  wrapMessages: boolean;
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

const CONTROL_PILL_BASE =
  "ui-font inline-flex h-6 shrink-0 items-center gap-1 rounded-lg border border-border/70 bg-primary-bg px-2.5 text-text-lighter text-xs transition-colors hover:bg-hover hover:text-text";

const CHIP_BASE = PANE_CHIP_BASE;

const getSeverityIcon = (severity: Diagnostic["severity"], size = 11) => {
  switch (severity) {
    case "error":
      return <AlertCircle size={size} className="text-error" />;
    case "warning":
      return <AlertTriangle size={size} className="text-warning" />;
    case "info":
      return <Info size={size} className="text-info" />;
    default:
      return <Info size={size} className="text-text-lighter" />;
  }
};

const getFileName = (filePath: string) => {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
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
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
};

const DiagnosticsPane = ({
  diagnostics,
  isVisible,
  onClose,
  onDiagnosticClick,
  isEmbedded = false,
}: DiagnosticsPaneProps) => {
  const { showToast } = useToast();
  const lspClient = useMemo(() => LspClient.getInstance(), []);

  const diagnosticContextMenu = useContextMenu<Diagnostic>();
  const filterContextMenu = useContextMenu<FilterMenuType>();

  const activeBufferId = useBufferStore.use.activeBufferId();
  const buffers = useBufferStore.use.buffers();

  const activeFilePath = useMemo(() => {
    const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId);
    if (!activeBuffer) return null;

    if (activeBuffer.type !== "editor" || activeBuffer.isVirtual) {
      return null;
    }

    return activeBuffer.path;
  }, [activeBufferId, buffers]);

  const [preferences, setPreferences] = useState<PanePreferences>(() => loadPreferences());
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Record<Diagnostic["severity"], boolean>>({
    error: true,
    warning: true,
    info: true,
  });
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

  useEffect(() => {
    if (!isSearchVisible) return;

    const timeoutId = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 20);

    return () => window.clearTimeout(timeoutId);
  }, [isSearchVisible]);

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
    setPreferences(DEFAULT_PREFERENCES);
  }, []);

  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  }, []);

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

  const diagnosticContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const diagnostic = diagnosticContextMenu.data;
    if (!diagnostic) return [];

    const key = buildDiagnosticKey(diagnostic);
    const codeActions = codeActionsByDiagnostic[key] || [];
    const isLoading = loadingActionsKey === key;

    const items: ContextMenuItem[] = [];

    if (isLoading) {
      items.push({
        id: "loading-actions",
        label: "Loading quick fixes...",
        icon: <WandSparkles size={12} />,
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
          icon: <WandSparkles size={12} />,
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
        icon: <WandSparkles size={12} />,
        onClick: () => {},
        disabled: true,
      });
    }

    items.push({ id: "sep-actions", label: "", separator: true, onClick: () => {} });

    items.push(
      {
        id: "go-to-problem",
        label: "Go to Problem",
        onClick: () => onDiagnosticClick?.(diagnostic),
      },
      {
        id: "copy-message",
        label: "Copy Message",
        icon: <Copy size={12} />,
        onClick: () => {
          void copyDiagnosticMessage(diagnostic);
        },
      },
      {
        id: "copy-location",
        label: "Copy Location",
        icon: <Copy size={12} />,
        onClick: () => {
          void copyDiagnosticLocation(diagnostic);
        },
      },
      {
        id: "copy-details",
        label: "Copy Full Details",
        icon: <Copy size={12} />,
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
          icon: <Filter size={12} />,
          onClick: () => setSourceFilter(null),
        });
      } else {
        items.push({
          id: "filter-by-source",
          label: `Filter by Source: ${source}`,
          icon: <Filter size={12} />,
          onClick: () => setSourceFilter(source),
        });
      }
    }

    items.push({ id: "sep-view", label: "", separator: true, onClick: () => {} });

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

  const hasSearch = Boolean(searchQuery.trim());
  const visibleProblemCount = filteredDiagnostics.length;
  const problemSummary = `${visibleProblemCount} problem${visibleProblemCount === 1 ? "" : "s"}`;
  const problemSummaryTone =
    visibleBySeverity.error > 0
      ? "text-error"
      : visibleBySeverity.warning > 0
        ? "text-warning"
        : visibleBySeverity.info > 0
          ? "text-info"
          : "text-text-lighter";

  const filterContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!filterContextMenu.data) return [];

    const items: ContextMenuItem[] = [];

    items.push(
      ...GROUP_OPTIONS.map((option) => ({
        id: `group-${option.value}`,
        label: `Group by: ${option.label}`,
        icon: preferences.groupBy === option.value ? <Check size={12} /> : undefined,
        onClick: () => {
          setPreferences((prev) => ({
            ...prev,
            groupBy: option.value,
          }));
        },
      })),
    );

    items.push({ id: "sep-group", label: "", separator: true, onClick: () => {} });

    items.push(
      ...SORT_OPTIONS.map((option) => ({
        id: `sort-${option.value}`,
        label: `Sort by: ${option.label}`,
        icon: preferences.sortBy === option.value ? <Check size={12} /> : undefined,
        onClick: () => {
          setPreferences((prev) => ({
            ...prev,
            sortBy: option.value,
          }));
        },
      })),
    );

    items.push({ id: "sep-sort", label: "", separator: true, onClick: () => {} });

    for (const severity of ["error", "warning", "info"] as Diagnostic["severity"][]) {
      items.push({
        id: `severity-${severity}`,
        label: `${SEVERITY_LABEL[severity]} (${visibleBySeverity[severity]}/${totalBySeverity[severity]})`,
        icon: severityFilter[severity] ? <Check size={12} /> : undefined,
        onClick: () => toggleSeverity(severity),
      });
    }

    if (activeFilePath) {
      items.push({
        id: "only-current-file",
        label: "Only Current File",
        icon: preferences.onlyCurrentFile ? <Check size={12} /> : undefined,
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
      items.push({ id: "sep-reset", label: "", separator: true, onClick: () => {} });
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

  if (!isVisible) return null;

  const content = (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg">
      <div className={paneHeaderClassName()}>
        <div className="relative flex min-h-7 w-full items-center gap-1.5">
          <span className={cn("ui-font text-xs", problemSummaryTone)}>{problemSummary}</span>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setIsSearchVisible((visible) => {
                  if (visible && !searchQuery.trim()) {
                    return false;
                  }
                  return true;
                });
              }}
              className={cn(
                paneIconButtonClassName(),
                (isSearchVisible || hasSearch) && "border-border/70 bg-hover text-text",
              )}
              title="Search problems"
            >
              <Search size={12} />
            </button>

            <button
              type="button"
              onClick={(event) => {
                filterContextMenu.open(event, "filters");
              }}
              className={cn(
                "relative",
                paneIconButtonClassName(),
                hasFilterSettings && "text-accent",
              )}
              title="Filter problems"
            >
              <Filter size={12} />
              {activeFilterCount > 0 && (
                <span className="-top-1 -right-1 absolute inline-flex min-w-4 items-center justify-center rounded-full border border-accent/30 bg-accent/15 px-1 text-[9px] text-accent">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {!isEmbedded && (
              <button
                type="button"
                onClick={onClose}
                className={paneIconButtonClassName()}
                title="Close problems pane"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {isSearchVisible && (
            <div className="absolute top-full right-0 z-30 mt-1">
              <SearchPopover
                value={searchQuery}
                onChange={setSearchQuery}
                onClose={() => {
                  setIsSearchVisible(false);
                  if (!searchQuery.trim()) {
                    setSearchQuery("");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    if (searchQuery.trim()) {
                      setSearchQuery("");
                    } else {
                      setIsSearchVisible(false);
                    }
                  }
                }}
                placeholder="Search problems"
                inputRef={searchInputRef}
                extraActions={
                  <button
                    type="button"
                    onClick={(event) => {
                      filterContextMenu.open(event, "filters");
                    }}
                    className={cn(
                      "relative",
                      paneIconButtonClassName(),
                      hasFilterSettings && "text-accent",
                    )}
                    title="Filter problems"
                  >
                    <Filter size={12} />
                    {activeFilterCount > 0 && (
                      <span className="-top-1 -right-1 absolute inline-flex min-w-4 items-center justify-center rounded-full border border-accent/30 bg-accent/15 px-1 text-[9px] text-accent">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                }
              />
            </div>
          )}
        </div>
      </div>

      <div className="custom-scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {diagnostics.length === 0 ? (
          <div className="flex h-full items-center justify-center text-text-lighter text-xs">
            No problems detected
          </div>
        ) : filteredDiagnostics.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-text-lighter text-xs">
            <p>No problems match the current filters</p>
            {hasFilters && (
              <button type="button" onClick={resetFilters} className={CONTROL_PILL_BASE}>
                Reset filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {groupedDiagnostics.map((group) => {
              const isCollapsed = collapsedGroups[group.id] ?? false;
              const hasGroupHeader = preferences.groupBy !== "none";

              return (
                <section
                  key={group.id}
                  className="overflow-hidden rounded-xl border border-border/60 bg-secondary-bg/40"
                >
                  {hasGroupHeader && (
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapse(group.id)}
                      className="flex w-full items-center gap-1.5 border-border/60 border-b bg-primary-bg/70 px-2 py-1 text-left hover:bg-hover"
                    >
                      {isCollapsed ? (
                        <ChevronRight size={12} className="text-text-lighter" />
                      ) : (
                        <ChevronDown size={12} className="text-text-lighter" />
                      )}

                      {group.severity ? (
                        getSeverityIcon(group.severity)
                      ) : (
                        <Info size={10} className="text-text-lighter" />
                      )}

                      <span className="ui-font flex-1 truncate font-medium text-text text-xs">
                        {preferences.groupBy === "file" ? getFileName(group.label) : group.label}
                      </span>

                      <span className={CHIP_BASE}>{group.items.length}</span>
                    </button>
                  )}

                  {!isCollapsed && (
                    <div className="divide-y divide-border/40">
                      {group.items.map((diagnostic) => {
                        const rowKey = buildDiagnosticKey(diagnostic);
                        const { summary, description } = splitDiagnosticMessage(diagnostic.message);

                        return (
                          <div
                            key={rowKey}
                            role="button"
                            tabIndex={0}
                            onClick={() => onDiagnosticClick?.(diagnostic)}
                            onContextMenu={(event) => {
                              diagnosticContextMenu.open(event, diagnostic);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onDiagnosticClick?.(diagnostic);
                              }
                            }}
                            className="group cursor-pointer px-2 py-1.5 transition-colors hover:bg-hover"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="shrink-0">
                                {getSeverityIcon(diagnostic.severity, 11)}
                              </span>

                              <span
                                className={cn(
                                  "ui-font min-w-0 flex-1 text-xs",
                                  preferences.wrapMessages
                                    ? "whitespace-pre-wrap break-words leading-snug"
                                    : "truncate",
                                  diagnostic.severity === "error" && "text-error",
                                  diagnostic.severity === "warning" && "text-warning",
                                  diagnostic.severity === "info" && "text-info",
                                )}
                              >
                                {summary}
                              </span>

                              <span className={CHIP_BASE}>
                                {diagnostic.line + 1}:{diagnostic.column + 1}
                              </span>
                            </div>

                            <div className="mt-1 pl-5">
                              {description && (
                                <div
                                  className={cn(
                                    "mb-1 text-[11px] text-text-lighter/90 leading-snug",
                                    preferences.wrapMessages
                                      ? "whitespace-pre-wrap break-words"
                                      : "truncate",
                                  )}
                                >
                                  {description}
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="max-w-[420px] truncate text-[10px] text-text-lighter/75">
                                  {diagnostic.filePath}
                                </span>

                                {diagnostic.source && (
                                  <span className={CHIP_BASE}>{diagnostic.source}</span>
                                )}

                                {diagnostic.code && (
                                  <span className={CHIP_BASE}>{diagnostic.code}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <ContextMenu
        isOpen={diagnosticContextMenu.isOpen}
        position={diagnosticContextMenu.position}
        items={diagnosticContextMenuItems}
        onClose={diagnosticContextMenu.close}
      />

      <ContextMenu
        isOpen={filterContextMenu.isOpen}
        position={filterContextMenu.position}
        items={filterContextMenuItems}
        onClose={filterContextMenu.close}
      />
    </div>
  );

  if (isEmbedded) {
    return content;
  }

  return <div className="flex h-44 flex-col border-border border-t bg-primary-bg">{content}</div>;
};

export default DiagnosticsPane;
