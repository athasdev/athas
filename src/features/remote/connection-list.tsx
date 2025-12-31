import { Edit, FolderOpen, Loader2, Plus, Server, Trash2, Wifi, WifiOff } from "lucide-react";
import React, { useState } from "react";
import { createPortal } from "react-dom";
import Button from "@/ui/button";
import { cn } from "@/utils/cn";
import type { RemoteConnection } from "./types";

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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    connectionId: string;
  } | null>(null);

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

  // Handle click outside to close menu
  React.useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu(null);
    };

    if (contextMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, connectionId: string) => {
    e.preventDefault();
    e.stopPropagation();

    let x = e.pageX;
    let y = e.pageY;

    const menuWidth = 150;
    const menuHeight = 100;

    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight;
    }

    setContextMenu({ x, y, connectionId });
  };

  return (
    <div className="flex h-full select-none flex-col bg-secondary-bg">
      {/* Header */}
      <div className="flex items-center justify-between border-border border-b bg-secondary-bg px-2 py-1.5">
        <h3 className="ui-font font-medium text-text text-xs tracking-wide">Remote</h3>
        <Button
          onClick={onAddNew}
          variant="ghost"
          size="sm"
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded p-0",
            "text-text-lighter transition-colors hover:bg-hover hover:text-text",
          )}
          aria-label="Add Remote Connection"
        >
          <Plus size={12} />
        </Button>
      </div>

      {/* Connections List */}
      <div className="flex-1 overflow-y-auto">
        {connections.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <Server size={20} className="mb-2 text-text-lighter" />
            <p className="mb-3 text-text-lighter text-xs">No remote connections</p>
            <button
              onClick={onAddNew}
              className={cn(
                "ui-font flex items-center gap-1.5 rounded border border-border",
                "bg-hover px-2.5 py-1 text-text text-xs",
                "transition-colors hover:border-accent hover:text-accent",
              )}
            >
              <Plus size={12} />
              Add Connection
            </button>
          </div>
        ) : (
          <div className="flex flex-col">
            {connections.map((connection) => (
              <button
                key={connection.id}
                type="button"
                onClick={() => {
                  if (!connectingMap[connection.id]) {
                    onConnect(connection.id);
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, connection.id)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2",
                  "border-none bg-transparent px-2 py-1.5 text-left",
                  "ui-font text-text text-xs transition-colors",
                  "hover:bg-hover focus:outline-none",
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
                    connection.isConnected ? "bg-green-500" : "bg-text-lighter/40",
                  )}
                />

                {/* Connection Info */}
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate">{connection.name}</span>
                  <span className="shrink-0 text-[10px] text-text-lighter">
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
                    <span className="shrink-0 text-[10px] text-text-lighter">{statusText}</span>
                  );
                })()}

                {/* Action Buttons */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  {connection.isConnected ? (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFileSelect?.(`/remote/${connection.id}/`, true);
                        }}
                        className="rounded p-0.5 text-text-lighter hover:bg-hover hover:text-text"
                        aria-label="Browse Files"
                      >
                        <FolderOpen size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onConnect(connection.id);
                        }}
                        className="rounded p-0.5 text-text-lighter hover:bg-hover hover:text-red-400"
                        aria-label="Disconnect"
                      >
                        <WifiOff size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!connectingMap[connection.id]) onConnect(connection.id);
                      }}
                      className={`rounded p-0.5 text-text-lighter hover:bg-hover hover:text-text ${connectingMap[connection.id] ? "cursor-not-allowed opacity-70" : ""}`}
                      disabled={!!connectingMap[connection.id]}
                      aria-label="Connect"
                    >
                      {connectingMap[connection.id] ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Wifi size={12} />
                      )}
                    </button>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu &&
        createPortal(
          <div
            className={cn(
              "fixed z-100 min-w-[140px] rounded-md border",
              "border-border bg-secondary-bg py-1 shadow-lg",
            )}
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const connection = connections.find((c) => c.id === contextMenu.connectionId);
                if (connection) {
                  onEdit(connection);
                }
                setContextMenu(null);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5",
                "ui-font text-left text-text text-xs hover:bg-hover",
              )}
            >
              <Edit size={12} />
              Edit
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(contextMenu.connectionId);
                setContextMenu(null);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5",
                "ui-font text-left text-xs hover:bg-hover hover:text-red-500",
              )}
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default ConnectionList;
