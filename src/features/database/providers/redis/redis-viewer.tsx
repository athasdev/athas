import { Clock, Key, RefreshCw, Search, Server, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import Badge from "@/ui/badge";
import Button from "@/ui/button";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { useRedisStore } from "./stores/redis-store";

const TYPE_COLORS: Record<string, string> = {
  string: "text-accent",
  list: "text-text",
  set: "text-text",
  hash: "text-text",
  zset: "text-text",
  stream: "text-text",
};

interface RedisViewerProps {
  connectionId: string;
}

export default function RedisViewer({ connectionId }: RedisViewerProps) {
  const store = useRedisStore();
  const { actions } = store;
  const [patternInput, setPatternInput] = useState("*");
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    actions.init(connectionId);
    return () => actions.reset();
  }, [connectionId, actions]);

  const handleSearch = () => {
    actions.scanKeys(patternInput, true);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-secondary-bg/30 text-text">
      <div className="mx-2 mt-2 rounded-2xl bg-primary-bg/85 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full bg-secondary-bg/70 px-2.5 py-1">
            <Server size={14} className="text-text-lighter" />
            <span className="ui-font text-sm">{store.fileName}</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              onClick={() => setShowInfo(!showInfo)}
              variant="ghost"
              size="sm"
              active={showInfo}
              aria-label="Toggle server info"
            >
              Info
            </Button>
            <button
              onClick={() => actions.scanKeys(undefined, true)}
              className="rounded-full border border-transparent p-1.5 text-text-lighter transition-colors hover:border-border/70 hover:bg-hover hover:text-text"
              aria-label="Refresh keys"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 p-2 pt-1.5">
        <div className="flex w-64 flex-col overflow-hidden rounded-2xl bg-primary-bg/85">
          <div className="flex items-center gap-1.5 border-border/60 border-b px-3 py-2">
            <Search size={12} className="text-text-lighter" />
            <Input
              className="border-0 bg-transparent px-0 py-0 focus:border-transparent focus:ring-0"
              placeholder="Pattern (e.g. user:*)"
              value={patternInput}
              onChange={(e) => setPatternInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              aria-label="Key pattern"
            />
            <button
              onClick={handleSearch}
              className="rounded-full border border-transparent p-1 text-text-lighter transition-colors hover:border-border/70 hover:bg-hover hover:text-text"
              aria-label="Search keys"
            >
              <Search size={12} />
            </button>
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
            {store.keys.map((keyInfo) => (
              <button
                key={keyInfo.key}
                onClick={() => actions.selectKey(keyInfo.key)}
                className={cn(
                  "ui-font flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs hover:bg-hover",
                  store.selectedKey === keyInfo.key && "bg-selected",
                )}
                aria-label={`Select key ${keyInfo.key}`}
              >
                <Badge
                  className={cn(
                    "border-0 bg-secondary-bg/70 px-1.5 font-bold uppercase",
                    TYPE_COLORS[keyInfo.type] || "text-text-lighter",
                  )}
                >
                  {keyInfo.type.substring(0, 3)}
                </Badge>
                <span className="flex-1 truncate">{keyInfo.key}</span>
                {keyInfo.ttl > 0 && (
                  <span className="flex items-center gap-0.5 text-text-lighter">
                    <Clock size={10} />
                    <span className="text-[10px]">{keyInfo.ttl}s</span>
                  </span>
                )}
              </button>
            ))}
            {store.hasMore && (
              <button
                onClick={() => actions.scanKeys()}
                className="ui-font w-full rounded-lg px-2 py-1 text-center text-accent text-xs hover:bg-hover"
                aria-label="Load more keys"
              >
                Load more...
              </button>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-primary-bg/85">
          {store.error && (
            <div className="mx-3 mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400 text-xs">
              {store.error}
            </div>
          )}

          {store.isLoading && (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="flex items-center gap-2 text-sm text-text-lighter">
                <RefreshCw size={16} className="animate-spin" />
                Loading...
              </div>
            </div>
          )}

          {!store.isLoading && showInfo && store.serverInfo && (
            <div className="flex-1 overflow-auto p-3">
              <div className="rounded-2xl border border-border/60 bg-secondary-bg/40 p-3">
                <div className="mb-3 text-text-lighter text-xs uppercase tracking-[0.08em]">
                  Server Info
                </div>
                <div className="space-y-2">
                  {Object.entries(store.serverInfo).map(([key, value]) => (
                    <div key={key} className="flex gap-2 text-xs">
                      <span className="ui-font min-w-[140px] text-text-lighter">{key}</span>
                      <span className="ui-font">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!store.isLoading && !showInfo && store.selectedKey && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2">
                <Key size={12} className="text-text-lighter" />
                <span className="ui-font font-medium text-xs">{store.selectedKey}</span>
                <Badge
                  className={cn(
                    "border-0 bg-secondary-bg/70 px-1.5 font-bold uppercase",
                    TYPE_COLORS[store.selectedKeyType || ""] || "text-text-lighter",
                  )}
                >
                  {store.selectedKeyType}
                </Badge>
                <div className="flex-1" />
                <button
                  onClick={() => actions.deleteKey(store.selectedKey!)}
                  className="rounded p-1 text-red-400 hover:bg-red-500/10"
                  aria-label="Delete key"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-3">
                <pre className="ui-font whitespace-pre-wrap rounded-2xl bg-secondary-bg/40 p-3 text-xs leading-5">
                  {typeof store.keyValue === "string"
                    ? store.keyValue
                    : JSON.stringify(store.keyValue, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {!store.isLoading && !showInfo && !store.selectedKey && (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="rounded-2xl border border-border/60 bg-secondary-bg/40 px-5 py-4 text-center">
                <div className="text-sm">Select a key</div>
                <div className="mt-1 text-text-lighter text-xs">
                  Pick a Redis key from the sidebar to inspect its value.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
