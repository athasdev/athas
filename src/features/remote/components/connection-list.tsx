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
import { LoadingIndicator } from "@/ui/loading";
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
    <div className="flex h-full select-none flex-col bg-secondary-bg">
      {/* Header */}
      <div className="flex items-center justify-between border-border border-b bg-secondary-bg px-2 py-1.5">
        <h3 className="font-sans font-medium text-text ui-text-sm tracking-wide">Remote</h3>
        <Button
          onClick={onAddNew}
          variant="ghost"
          className={cn(
            "flex items-center justify-center rounded-md",
            "text-text-lighter transition-colors hover:bg-hover hover:text-text",
          )}
          aria-label="Add Remote Connection"
          size="icon-xs"
        >
          <Plus />
        </Button>
      </div>

      {/* Connections List */}
      <div className="flex-1 overflow-y-auto">
        {connections.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <Server className="mb-2 text-text-lighter" />
            <p className="mb-3 text-text-lighter ui-text-sm">No remote connections</p>
            <Button
              onClick={onAddNew}
              variant="default"
              className="font-sans flex items-center gap-1.5"
              size="xs"
            >
              <Plus />
              Add Connection
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {connections.map((connection) => (
              <ContextMenu key={connection.id}>
                <ContextMenuTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      if (!connectingMap[connection.id]) {
                        onConnect(connection.id);
                      }
                    }}
                    className={cn(
                      "h-auto w-full justify-start gap-2 px-2 py-1.5 text-left",
                      "text-text hover:bg-hover focus:outline-none",
                      connection.isConnected && "bg-selected",
                      connectingMap[connection.id] && "cursor-not-allowed opacity-70",
                    )}
                    disabled={!!connectingMap[connection.id]}
                    aria-busy={!!connectingMap[connection.id]}
                  >
                    {/* Status Indicator */}
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        connection.isConnected ? "bg-success" : "bg-text-lighter/40",
                      )}
                    />

                    {/* Connection Info */}
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate">{connection.name}</span>
                      <span className="ui-text-sm shrink-0 text-text-lighter">
                        {connection.type.toUpperCase()}
                      </span>
                    </div>

                    {/* Status Text */}
                    {(() => {
                      const statusText = connectingMap[connection.id]
                        ? "Connecting…"
                        : connection.isConnected
                          ? "Connected"
                          : connection.lastConnected
                            ? formatLastConnected(connection.lastConnected)
                            : "";
                      return (
                        <span className="ui-text-sm shrink-0 text-text-lighter">{statusText}</span>
                      );
                    })()}

                    {/* Action Buttons */}
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
                              onConnect(connection.id);
                            }}
                            variant="ghost"
                            size="icon-xs"
                            className="hover:text-error"
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
                            <LoadingIndicator label="Connecting" compact />
                          ) : (
                            <Wifi />
                          )}
                        </Button>
                      )}
                    </div>
                  </Button>
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
      </div>
    </div>
  );
};

export default ConnectionList;
