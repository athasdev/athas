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
    <div className="flex flex-col h-full bg-[var(--secondary-bg)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-[var(--text-lighter)]" />
          <span className="text-sm font-medium text-[var(--text-color)]">Remote</span>
        </div>
        <Button
          onClick={onAddNew}
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 hover:bg-[var(--hover-color)] transition-colors"
          title="Add Remote Connection"
        >
          <Plus size={14} />
        </Button>
      </div>

      {/* Connections List */}
      <div className="flex-1 overflow-y-auto">
        {connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--hover-color)] flex items-center justify-center mb-4">
              <Server size={24} className="text-[var(--text-lighter)]" />
            </div>
            <h3 className="text-sm font-medium text-[var(--text-color)] mb-1">
              No remote connections
            </h3>
            <p className="text-sm text-[var(--text-lighter)] mb-4">
              Connect to remote servers via SSH or SFTP
            </p>
            <Button onClick={onAddNew} variant="default" size="sm" className="h-8">
              <Plus size={14} className="mr-2" />
              Add Connection
            </Button>
          </div>
        ) : (
          <div className="p-2 sm:p-3 space-y-2">
            {connections.map(connection => (
              <div
                key={connection.id}
                className={cn(
                  "group relative p-2 rounded-lg border transition-all duration-200 hover:shadow-sm overflow-hidden",
                  connection.isConnected
                    ? "bg-green-50/50 border-green-200/50 dark:bg-green-950/20 dark:border-green-800/30"
                    : "bg-[var(--secondary-bg)] border-[var(--border-color)]",
                )}
              >
                <div className="flex items-center gap-3">
                  {/* Connection Status */}
                  <div
                    className={cn(
                      "w-2.5 h-2.5 rounded-full transition-colors flex-shrink-0",
                      connection.isConnected ? "bg-green-500" : "bg-gray-400 dark:bg-gray-600",
                    )}
                  />

                  {/* Connection Info - Clickable */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span
                        className="text-sm font-medium text-[var(--text-color)] truncate cursor-pointer hover:bg-[var(--hover-color)] px-1 py-0.5 rounded"
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
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--hover-color)] text-[var(--text-lighter)] font-mono flex-shrink-0">
                        {connection.type.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-lighter)] truncate">
                      {connection.isConnected
                        ? "Connected"
                        : connection.lastConnected
                          ? `Last connected ${formatLastConnected(connection.lastConnected)}`
                          : "Never connected"}
                    </div>
                  </div>

                  {/* Connect/Browse Button Only */}
                  <div className="flex items-center flex-shrink-0">
                    {connection.isConnected ? (
                      <Button
                        onClick={() => onFileSelect?.(`/remote/${connection.id}/`, true)}
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 cursor-pointer"
                        title="Browse Files"
                      >
                        <FolderOpen size={12} />
                      </Button>
                    ) : (
                      <Button
                        onClick={() => onConnect(connection.id)}
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 cursor-pointer text-[var(--text-lighter)] hover:text-[var(--text-color)]"
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
          className="fixed bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded-md shadow-lg z-50 py-1 min-w-[120px]"
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
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
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
            className="w-full text-left px-3 py-1.5 text-xs font-mono text-red-400 hover:bg-red-500/10 flex items-center gap-2"
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
