import {
  PencilSimpleIcon as Edit,
  FolderOpenIcon as FolderOpen,
  PlusIcon as Plus,
  HardDrivesIcon as Server,
  TrashIcon as Trash2,
  WifiHighIcon as Wifi,
  WifiSlashIcon as WifiOff,
} from "@/ui/icons";
import { Button } from "@/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/ui/item";
import { Spinner } from "@/ui/spinner";
import { ScrollArea } from "@/ui/scroll-area";
import { cn } from "@/utils/cn";
import type { RemoteConnection } from "../types/remote.types";

interface ConnectionListProps {
  connections: RemoteConnection[];
  onConnect: (connectionId: string) => Promise<void>;
  onEdit: (connection: RemoteConnection) => void;
  onDelete: (connectionId: string) => void;
  onFileSelect?: (path: string, isDir: boolean) => void;
  onAddNew: () => void;
  connectingMap?: Record<string, boolean>;
}

const ConnectionList = ({
  connections,
  onConnect,
  onEdit,
  onDelete,
  onFileSelect,
  onAddNew,
  connectingMap = {},
}: ConnectionListProps) => {
  const formatLastConnected = (dateString?: string): string => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 1) return "just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
    return `${Math.floor(diffMinutes / 1440)}d ago`;
  };

  return (
    <div className="flex h-full select-none flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-border border-b bg-surface px-2 py-1.5">
        <h3 className="font-sans font-medium text-foreground ui-text-sm tracking-wide">Remote</h3>
        <Button
          onClick={onAddNew}
          variant="ghost"
          className={cn(
            "flex items-center justify-center rounded-md",
            "text-subtle-foreground transition-colors hover:bg-accent hover:text-foreground",
          )}
          aria-label="Add Remote Connection"
          size="icon-xs"
        >
          <Plus />
        </Button>
      </div>

      {/* Connections List */}
      <ScrollArea className="flex-1">
        {connections.length === 0 ? (
          <Empty className="h-full min-h-48">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Server />
              </EmptyMedia>
              <EmptyTitle>No remote connections</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button
                onClick={onAddNew}
                variant="default"
                className="font-sans flex items-center gap-1.5"
                size="xs"
              >
                <Plus />
                Add Connection
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div role="list" className="flex flex-col p-1">
            {connections.map((connection) => (
              <ContextMenu key={connection.id}>
                <ContextMenuTrigger>
                  <Item
                    render={<div role="button" tabIndex={0} />}
                    onClick={() => {
                      if (!connectingMap[connection.id]) {
                        void onConnect(connection.id);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (
                        !connectingMap[connection.id] &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        void onConnect(connection.id);
                      }
                    }}
                    size="xs"
                    className={cn(
                      "relative cursor-pointer flex-nowrap border-0 text-left hover:bg-accent",
                      connection.isConnected && "bg-selected",
                      connectingMap[connection.id] && "cursor-not-allowed opacity-70",
                    )}
                    aria-disabled={!!connectingMap[connection.id]}
                    aria-busy={!!connectingMap[connection.id]}
                  >
                    <ItemMedia>
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          connection.isConnected ? "bg-success" : "bg-subtle-foreground/40",
                        )}
                      />
                    </ItemMedia>
                    <ItemContent className="flex-row items-center gap-1.5">
                      <ItemTitle className="truncate font-normal">{connection.name}</ItemTitle>
                      <ItemDescription className="shrink-0">
                        {connection.type.toUpperCase()}
                      </ItemDescription>
                    </ItemContent>
                    <ItemDescription className="shrink-0">
                      {connectingMap[connection.id]
                        ? "Connecting…"
                        : connection.isConnected
                          ? "Connected"
                          : connection.lastConnected
                            ? formatLastConnected(connection.lastConnected)
                            : ""}
                    </ItemDescription>
                    <ItemActions className="gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-within/item:opacity-100">
                      {connection.isConnected ? (
                        <>
                          <Button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onFileSelect?.(`remote://${connection.id}/`, true);
                            }}
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Browse Files"
                          >
                            <FolderOpen />
                          </Button>
                          <Button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onConnect(connection.id);
                            }}
                            variant="ghost"
                            size="icon-xs"
                            className="hover:text-destructive"
                            aria-label="Disconnect"
                          >
                            <WifiOff />
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!connectingMap[connection.id]) onConnect(connection.id);
                          }}
                          variant="ghost"
                          size="icon-xs"
                          className={cn(
                            connectingMap[connection.id] && "cursor-not-allowed opacity-70",
                          )}
                          disabled={!!connectingMap[connection.id]}
                          aria-label="Connect"
                        >
                          {connectingMap[connection.id] ? (
                            <Spinner label="Connecting" compact />
                          ) : (
                            <Wifi />
                          )}
                        </Button>
                      )}
                    </ItemActions>
                  </Item>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => onEdit(connection)}>
                    <Edit />
                    Edit
                  </ContextMenuItem>
                  <ContextMenuItem variant="destructive" onClick={() => onDelete(connection.id)}>
                    <Trash2 />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default ConnectionList;
