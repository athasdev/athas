import {
  Code,
  Copy,
  Database,
  Download,
  Info,
  Plus,
  RefreshCw,
  Settings,
  Table,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Type,
} from "lucide-react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import type {
  DatabaseInfo,
  DatabaseObjectKind,
  PostgresSubscriptionInfo,
  ViewMode,
} from "../sqlite-types";

interface TableToolbarProps {
  fileName: string;
  dbInfo: DatabaseInfo | null;
  selectedObjectKind?: DatabaseObjectKind;
  subscriptionInfo?: PostgresSubscriptionInfo | null;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  isCustomQuery: boolean;
  showColumnTypes: boolean;
  setShowColumnTypes: (show: boolean) => void;
  setIsCustomQuery: (is: boolean) => void;
  hasData: boolean;
  exportAsCSV: () => void;
  copyAsJSON: () => void;
  onCreateSubscription?: () => void;
  onToggleSubscription?: () => void;
  onRefreshSubscription?: () => void;
  onDropSubscription?: () => void;
}

const VIEW_TABS: { mode: ViewMode; icon: typeof Table; label: string }[] = [
  { mode: "data", icon: Table, label: "Data" },
  { mode: "schema", icon: Settings, label: "Schema" },
  { mode: "info", icon: Info, label: "Info" },
];

export default function TableToolbar({
  fileName,
  dbInfo,
  selectedObjectKind = "table",
  subscriptionInfo,
  viewMode,
  setViewMode,
  isCustomQuery,
  showColumnTypes,
  setShowColumnTypes,
  setIsCustomQuery,
  hasData,
  exportAsCSV,
  copyAsJSON,
  onCreateSubscription,
  onToggleSubscription,
  onRefreshSubscription,
  onDropSubscription,
}: TableToolbarProps) {
  const isSubscription = selectedObjectKind === "subscription";

  return (
    <div className="mx-2 mt-2 rounded-2xl bg-primary-bg/85 px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full bg-secondary-bg/70 px-2.5 py-1">
            <Database className="text-text-lighter" />
            <span className="text-sm">{fileName}</span>
            {dbInfo && (
              <span className="text-text-lighter text-xs">
                {dbInfo.tables}t {dbInfo.indexes}i
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-secondary-bg/60 p-0.5">
            {VIEW_TABS.map(({ mode, icon: Icon, label }) => (
              <Button
                key={mode}
                onClick={() => setViewMode(mode)}
                variant={viewMode === mode ? "secondary" : "ghost"}
                size="xs"
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs",
                  viewMode === mode ? "text-text" : "text-text-lighter",
                )}
                aria-label={`Switch to ${label} view`}
              >
                <Icon />
                {label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {viewMode === "data" && !isCustomQuery && !isSubscription && (
            <Button
              onClick={() => setShowColumnTypes(!showColumnTypes)}
              variant="ghost"
              size="xs"
              className="rounded-full px-2 py-1 text-text-lighter"
              aria-label="Toggle column types"
            >
              <Type />
              Types
            </Button>
          )}
          {viewMode === "data" && (
            <Button
              onClick={() => setIsCustomQuery(true)}
              variant="ghost"
              size="xs"
              className="rounded-full px-2 py-1 text-text-lighter"
              disabled={isCustomQuery}
              aria-label="Open SQL editor"
            >
              <Code />
              SQL
            </Button>
          )}
          {onCreateSubscription && (
            <Button
              onClick={onCreateSubscription}
              variant="ghost"
              size="xs"
              className="rounded-full px-2 py-1 text-text-lighter"
              aria-label="Create subscription"
            >
              <Plus />
              Subscription
            </Button>
          )}
          {isSubscription && subscriptionInfo && onToggleSubscription && (
            <Button
              onClick={onToggleSubscription}
              variant="ghost"
              size="xs"
              className="rounded-full px-2 py-1 text-text-lighter"
              aria-label={subscriptionInfo.enabled ? "Disable subscription" : "Enable subscription"}
            >
              {subscriptionInfo.enabled ? <ToggleRight /> : <ToggleLeft />}
              {subscriptionInfo.enabled ? "Disable" : "Enable"}
            </Button>
          )}
          {isSubscription && onRefreshSubscription && (
            <Button
              onClick={onRefreshSubscription}
              variant="ghost"
              size="xs"
              className="rounded-full px-2 py-1 text-text-lighter"
              aria-label="Refresh subscription"
            >
              <RefreshCw />
              Refresh
            </Button>
          )}
          {isSubscription && onDropSubscription && (
            <Button
              onClick={onDropSubscription}
              variant="ghost"
              size="xs"
              className="rounded-full px-2 py-1 text-text-lighter"
              aria-label="Drop subscription"
            >
              <Trash2 />
              Drop
            </Button>
          )}
          {hasData && (
            <>
              <Button
                onClick={exportAsCSV}
                variant="ghost"
                size="xs"
                className="rounded-full px-2 py-1 text-text-lighter"
                aria-label="Export as CSV"
              >
                <Download />
                Export
              </Button>
              <Button
                onClick={copyAsJSON}
                variant="ghost"
                size="xs"
                className="rounded-full px-2 py-1 text-text-lighter"
                aria-label="Copy as JSON"
              >
                <Copy />
                JSON
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
