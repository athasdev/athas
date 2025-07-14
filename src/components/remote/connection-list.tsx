import { Edit, FolderOpen, Plus, Server, Trash2, Wifi } from "lucide-react";
import React, { useState } from "react";
import { cn } from "../../utils/cn";
import Button from "../ui/button";
import type { RemoteConnection } from "./types";

interface ConnectionListProps {
  connections: RemoteConnection[];
  onConnect: (connectionId: string) => Promise<void>;
  onEdit: (connection: RemoteConnection) => void;
  onDelete: (connectionId: string) => void;
  onFileSelect?: (path: string, isDir: boolean) => void;
  onAddNew: () => void;
}

const ConnectionList = ({
  connections,
  onConnect,
  onEdit,
  onDelete,
  onFileSelect,
  onAddNew,
}: ConnectionListProps) => {
  const [connectionMenu, setConnectionMenu] = useState<{
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

    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
    return `${Math.floor(diffMinutes / 1440)}d ago`;
  };

  // Handle click outside to close menu
  React.useEffect(() => {
    const handleClickOutside = () => {
      setConnectionMenu(null);
    };

    if (connectionMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [connectionMenu]);

  return (
    <div className="flex h-full flex-col bg-secondary-bg">
      {/* Header */}
      <div className="flex items-center justify-between border-border border-b bg-secondary-bg px-2 py-1.5">
        <h3 className="font-medium font-mono text-text text-xs tracking-wide">Remote</h3>
        <Button
          onClick={onAddNew}
          variant="ghost"
          size="sm"
          className="flex h-5 w-5 items-center justify-center rounded p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text"
          title="Add Remote Connection"
        >
          <Plus size={12} />
        </Button>
      </div>

      {/* Connections List */}
      <div className="flex-1 overflow-y-auto">
        {connections.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-hover">
              <Server size={24} className="text-text-lighter" />
            </div>
            <h3 className="mb-1 font-medium text-sm text-text">No remote connections</h3>
            <p className="mb-4 text-sm text-text-lighter">
              Connect to remote servers via SSH or SFTP
            </p>
            <Button onClick={onAddNew} variant="default" size="sm" className="h-8">
              <Plus size={14} className="mr-2" />
              Add Connection
            </Button>
          </div>
        ) : (
          <div className="space-y-2 p-2 sm:p-3">
            {connections.map(connection => (
              <div
                key={connection.id}
                className={cn(
                  "group relative overflow-hidden rounded-lg border p-2 transition-all duration-200 hover:shadow-sm",
                  connection.isConnected
                    ? "border-green-200/50 bg-green-50/50 dark:border-green-800/30 dark:bg-green-950/20"
                    : "border-border bg-secondary-bg",
                )}
              >
                <div className="flex items-center gap-3">
                  {/* Connection Status */}
                  <div
                    className={cn(
                      "h-2.5 w-2.5 flex-shrink-0 rounded-full transition-colors",
                      connection.isConnected ? "bg-green-500" : "bg-gray-400 dark:bg-gray-600",
                    )}
                  />

                  {/* Connection Info - Clickable */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span
                        className="cursor-pointer truncate rounded px-1 py-0.5 font-medium text-sm text-text hover:bg-hover"
                        title="Click for options"
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          setConnectionMenu({
                            x: e.currentTarget.getBoundingClientRect().left,
                            y: e.currentTarget.getBoundingClientRect().bottom + 5,
                            connectionId: connection.id,
                          });
                        }}
                        onContextMenu={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          setConnectionMenu({
                            x: e.currentTarget.getBoundingClientRect().left,
                            y: e.currentTarget.getBoundingClientRect().bottom + 5,
                            connectionId: connection.id,
                          });
                        }}
                      >
                        {connection.name}
                      </span>
                      <span className="flex-shrink-0 rounded bg-hover px-1.5 py-0.5 font-mono text-text-lighter text-xs">
                        {connection.type.toUpperCase()}
                      </span>
                    </div>
                    <div className="truncate text-text-lighter text-xs">
                      {connection.isConnected
                        ? "Connected"
                        : connection.lastConnected
                          ? `Last connected ${formatLastConnected(connection.lastConnected)}`
                          : "Never connected"}
                    </div>
                  </div>

                  {/* Connect/Browse Button Only */}
                  <div className="flex flex-shrink-0 items-center">
                    {connection.isConnected ? (
                      <Button
                        onClick={() => onFileSelect?.(`/remote/${connection.id}/`, true)}
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 cursor-pointer p-0"
                        title="Browse Files"
                      >
                        <FolderOpen size={12} />
                      </Button>
                    ) : (
                      <Button
                        onClick={() => onConnect(connection.id)}
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 cursor-pointer p-0 text-text-lighter hover:text-text"
                        title="Connect"
                      >
                        <Wifi size={12} />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connection Menu Dropdown */}
      {connectionMenu && (
        <div
          className="fixed z-50 min-w-[120px] rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
          style={{
            left: connectionMenu.x,
            top: connectionMenu.y,
          }}
          onMouseDown={e => {
            e.stopPropagation();
          }}
        >
          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              const connection = connections.find(c => c.id === connectionMenu.connectionId);
              if (connection) {
                onEdit(connection);
              }
              setConnectionMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-text text-xs hover:bg-hover"
          >
            <Edit size={12} />
            Edit
          </button>
          <button
            onMouseDown={e => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(connectionMenu.connectionId);
              setConnectionMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-red-400 text-xs hover:bg-red-500/10"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default ConnectionList;
