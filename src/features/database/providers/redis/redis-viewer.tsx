import {
  ClockIcon as Clock,
  KeyIcon as Key,
  ArrowClockwiseIcon as RefreshCw,
  MagnifyingGlassIcon as Search,
  HardDrivesIcon as Server,
  TrashIcon as Trash2,
} from "@/ui/icons";
import { useEffect, useRef, useState } from "react";
import { PathBreadcrumb } from "@/features/editor/components/toolbar/path-breadcrumb";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import { Alert, AlertDescription } from "@/ui/alert";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import Input from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import { ScrollArea } from "@/ui/scroll-area";
import { cn } from "@/utils/cn";
import {
  databaseCodeBlockClassName,
  databasePanelClassName,
} from "../../components/database-surface";
import { createRedisStore } from "./stores/redis.store";

const TYPE_COLORS: Record<string, string> = {
  string: "text-primary",
  list: "text-foreground",
  set: "text-foreground",
  hash: "text-foreground",
  zset: "text-foreground",
  stream: "text-foreground",
};

interface RedisViewerProps {
  connectionId: string;
}

export default function RedisViewer({ connectionId }: RedisViewerProps) {
  const [useStore] = useState(() => createRedisStore());
  const store = useStore();
  const { actions } = store;
  const [patternInput, setPatternInput] = useState("*");
  const [showInfo, setShowInfo] = useState(false);
  const keyListRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    actions.init(connectionId);
    return () => actions.reset();
  }, [connectionId, actions]);

  useEffect(() => {
    setPatternInput(store.scanPattern);
  }, [store.scanPattern]);

  const handleSearch = () => {
    actions.scanKeys(patternInput, true);
  };

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const keyList = keyListRef.current;
    if (
      !sentinel ||
      !keyList ||
      !store.hasMore ||
      store.isScanningKeys ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          actions.scanKeys();
        }
      },
      { root: keyList, rootMargin: "160px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [actions, store.hasMore, store.isScanningKeys, store.keys.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <PaneContentHeader
        context={
          <PathBreadcrumb
            segments={[store.fileName]}
            icons={[<Server key="server" />]}
            ariaLabel="Redis connection"
          />
        }
        actions={
          <>
            <Button
              onClick={() => setShowInfo(!showInfo)}
              variant="ghost"
              size="xs"
              data-active={showInfo}
              aria-label="Toggle server info"
            >
              Info
            </Button>
            <Button
              onClick={() => actions.scanKeys(undefined, true)}
              variant="ghost"
              size="icon-xs"
              disabled={store.isScanningKeys}
              aria-label="Refresh keys"
            >
              {store.isScanningKeys ? <Spinner label="Refreshing keys" compact /> : <RefreshCw />}
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className={databasePanelClassName("w-64 shrink-0 border-border/60 border-r")}>
          <PaneContentHeader
            leading={<Search />}
            context={
              <Input
                className="min-w-0 flex-1 border-0 bg-transparent p-0 focus:border-transparent focus:ring-0"
                placeholder="Pattern (e.g. user:*)"
                value={patternInput}
                onChange={(e) => setPatternInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                aria-label="Key pattern"
              />
            }
            actions={
              <Button
                onClick={handleSearch}
                variant="ghost"
                disabled={store.isScanningKeys}
                aria-label="Search keys"
                size="icon-xs"
              >
                {store.isScanningKeys ? <Spinner label="Scanning keys" compact /> : <Search />}
              </Button>
            }
          />
          <ScrollArea
            className="flex-1"
            contentClassName="space-y-0.5 p-1.5"
            viewportProps={{ ref: keyListRef }}
          >
            {store.keys.map((keyInfo) => (
              <Button
                key={keyInfo.key}
                type="button"
                variant="ghost"
                onClick={() => actions.selectKey(keyInfo.key)}
                className={cn(
                  "h-auto w-full justify-start gap-1.5 px-2 py-1 leading-row",
                  store.selectedKey === keyInfo.key && "bg-selected",
                )}
                aria-label={`Select key ${keyInfo.key}`}
              >
                <Badge
                  className={cn(
                    "border-0 bg-surface/70 px-1.5 font-bold uppercase",
                    TYPE_COLORS[keyInfo.type] || "text-subtle-foreground",
                  )}
                >
                  {keyInfo.type.substring(0, 3)}
                </Badge>
                <span className="flex-1 truncate leading-row">{keyInfo.key}</span>
                {keyInfo.ttl > 0 && (
                  <span className="flex items-center gap-0.5 text-subtle-foreground">
                    <Clock />
                    <span className="ui-text-sm">{keyInfo.ttl}s</span>
                  </span>
                )}
              </Button>
            ))}
            {store.hasMore && (
              <div
                ref={loadMoreRef}
                aria-label="Loading more keys"
                className="px-2 py-1 text-subtle-foreground ui-text-sm"
              >
                {store.isScanningKeys ? "Loading keys..." : "More keys..."}
              </div>
            )}
            {store.isScanningKeys && !store.hasMore && (
              <div className="px-2 py-1 text-subtle-foreground ui-text-sm">Loading keys...</div>
            )}
          </ScrollArea>
        </div>

        <div className={databasePanelClassName("flex-1")}>
          {store.error && (
            <Alert tone="error" className="mx-3 mt-3 w-auto">
              <AlertDescription>{store.error}</AlertDescription>
            </Alert>
          )}

          {store.isLoading && (
            <Empty>
              <EmptyDescription>
                <Spinner label="Loading" showLabel />
              </EmptyDescription>
            </Empty>
          )}

          {!store.isLoading && showInfo && store.serverInfo && (
            <div className="flex-1 overflow-auto p-3">
              <section className="border-y border-border/60 py-3">
                <div className="mb-3 text-subtle-foreground ui-text-sm uppercase tracking-[0.08em]">
                  Server Info
                </div>
                <div className="space-y-2">
                  {Object.entries(store.serverInfo).map(([key, value]) => (
                    <div key={key} className="flex gap-2 ui-text-sm">
                      <span className="font-sans min-w-35 text-subtle-foreground">{key}</span>
                      <span className="font-sans">{value}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {!store.isLoading && !showInfo && store.selectedKey && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <PaneContentHeader
                leading={<Key />}
                title={store.selectedKey}
                detail={store.selectedKeyType}
                actions={
                  <Button
                    onClick={() => actions.deleteKey(store.selectedKey!)}
                    variant="ghost"
                    size="icon-xs"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Delete key"
                  >
                    <Trash2 />
                  </Button>
                }
              />
              <div className="flex-1 overflow-auto p-3">
                <pre className={databaseCodeBlockClassName()}>
                  {typeof store.keyValue === "string"
                    ? store.keyValue
                    : JSON.stringify(store.keyValue, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {!store.isLoading && !showInfo && !store.selectedKey && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Select a key</EmptyTitle>
                <EmptyDescription>
                  Pick a Redis key from the sidebar to inspect its value.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}
