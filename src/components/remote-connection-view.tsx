import React, { useState, useEffect, useRef } from "react";
import { 
  Server, 
  Plus, 
  Trash2, 
  Edit, 
  FolderOpen, 
  Wifi, 
  WifiOff, 
  Eye,
  EyeOff,
  Save,
  X,
} from "lucide-react";
import { cn } from "../utils/cn";
import Button from "./button";
import Dropdown from "./dropdown";
import { invoke } from '@tauri-apps/api/core';
import { safeLocalStorageSetItem } from '../utils/storage';

interface RemoteConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  keyPath?: string;
  type: 'ssh' | 'sftp';
  isConnected: boolean;
  lastConnected?: string;
}

interface RemoteConnectionViewProps {
  onFileSelect?: (path: string, isDir: boolean) => void;
}

const RemoteConnectionView = ({
  onFileSelect
}: RemoteConnectionViewProps) => {
  const [connections, setConnections] = useState<RemoteConnection[]>([]);
  const [isAddingConnection, setIsAddingConnection] = useState(false);
  const [editingConnection, setEditingConnection] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [newConnection, setNewConnection] = useState<Partial<RemoteConnection>>({
    name: '',
    host: '',
    port: 22,
    username: '',
    password: '',
    keyPath: '',
    type: 'ssh'
  });

  // Load connections from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('athas-remote-connections');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setConnections(parsed.map((conn: any) => ({ ...conn, isConnected: false })));
      } catch (error) {
        console.error('Error loading remote connections:', error);
      }
    }
  }, []);

  // Save connections to localStorage
  const saveConnections = (conns: RemoteConnection[]) => {
    const connectionsJson = JSON.stringify(conns);
    
    const success = safeLocalStorageSetItem('athas-remote-connections', connectionsJson, {
      clearPrefix: 'athas-remote-',
      onSuccess: () => {
        setConnections(conns);
      },
      onQuotaExceeded: (error) => {
        console.error('Failed to save remote connections due to quota:', error);
        // Still update the state even if localStorage fails
        setConnections(conns);
        
        // Try to inform the user
        try {
          alert('Warning: Remote connections could not be saved due to storage limitations. Your connections will be lost when you restart the application.');
        } catch {
          console.warn('Remote connections could not be saved due to storage limitations');
        }
      }
    });
    
    if (!success) {
      console.error('Failed to save remote connections');
      // Still update the state even if localStorage fails
      setConnections(conns);
    }
  };

  const handleAddConnection = () => {
    if (!newConnection.name || !newConnection.host || !newConnection.username) {
      return;
    }

    const connection: RemoteConnection = {
      id: Date.now().toString(),
      name: newConnection.name,
      host: newConnection.host,
      port: newConnection.port || 22,
      username: newConnection.username,
      password: newConnection.password,
      keyPath: newConnection.keyPath,
      type: newConnection.type || 'ssh',
      isConnected: false,
    };

    saveConnections([...connections, connection]);
    setNewConnection({
      name: '',
      host: '',
      port: 22,
      username: '',
      password: '',
      keyPath: '',
      type: 'ssh'
    });
    setIsAddingConnection(false);
  };

  const handleDeleteConnection = (id: string) => {
    saveConnections(connections.filter(conn => conn.id !== id));
  };

  const handleConnect = async (connectionId: string) => {
    const connection = connections.find(conn => conn.id === connectionId);
    if (!connection) return;

    try {
      if (connection.isConnected) {
        // Disconnect
        await invoke('ssh_disconnect', { connectionId });
        
        setConnections(connections.map(conn => 
          conn.id === connectionId 
            ? { ...conn, isConnected: false }
            : conn
        ));
      } else {
        // Connect
        await invoke('ssh_connect', {
          connectionId,
          host: connection.host,
          port: connection.port,
          username: connection.username,
          password: connection.password || null,
          keyPath: connection.keyPath || null,
          useSftp: connection.type === 'sftp'
        });

        // Update connection status
        setConnections(connections.map(conn => 
          conn.id === connectionId 
            ? { ...conn, isConnected: true, lastConnected: new Date().toISOString() }
            : conn
        ));

        // Create new remote window
        await invoke('create_remote_window', {
          connectionId,
          connectionName: connection.name
        });
      }
    } catch (error) {
      console.error('Connection error:', error);
      
      // Use Tauri's dialog API instead of alert
      try {
        const { message } = await import('@tauri-apps/plugin-dialog');
        await message(`Connection failed: ${error}`, {
          title: 'SSH Connection Error',
          kind: 'error'
        });
      } catch {
        // Fallback to console if dialog fails
        console.error('Connection failed:', error);
      }
    }
  };

  const handleEditConnection = (connection: RemoteConnection) => {
    setNewConnection(connection);
    setEditingConnection(connection.id);
    setIsAddingConnection(true);
  };

  const handleUpdateConnection = () => {
    if (!newConnection.name || !newConnection.host || !newConnection.username || !editingConnection) {
      return;
    }

    const updatedConnections = connections.map(conn => 
      conn.id === editingConnection 
        ? { 
            ...conn, 
            ...newConnection,
            isConnected: false // Reset connection status when editing
          }
        : conn
    );

    saveConnections(updatedConnections);
    setNewConnection({
      name: '',
      host: '',
      port: 22,
      username: '',
      password: '',
      keyPath: '',
      type: 'ssh'
    });
    setIsAddingConnection(false);
    setEditingConnection(null);
  };

  const formatLastConnected = (dateString?: string): string => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
    return `${Math.floor(diffMinutes / 1440)}d ago`;
  };

  const connectionTypeOptions = [
    { value: 'ssh', label: 'SSH' },
    { value: 'sftp', label: 'SFTP' }
  ];

  return (
    <div className="flex flex-col h-full bg-[var(--primary-bg)]">
      {/* Minimal Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-[var(--text-lighter)]" />
          <span className="text-sm font-medium text-[var(--text-color)]">
            Remote
          </span>
        </div>
        <Button
          onClick={() => setIsAddingConnection(true)}
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 hover:bg-[var(--hover-color)] transition-colors"
          title="Add Remote Connection"
        >
          <Plus size={14} />
        </Button>
      </div>

      {/* Add/Edit Connection Form */}
      {isAddingConnection && (
        <div className="p-3 border-b border-[var(--border-color)] bg-[var(--secondary-bg)]">
          <div className="space-y-3">
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Connection name"
                value={newConnection.name || ''}
                onChange={(e) => setNewConnection({ ...newConnection, name: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors text-[var(--text-color)] placeholder-[var(--text-lighter)]"
              />
              <div className="grid grid-cols-4 gap-2">
                <input
                  type="text"
                  placeholder="Host"
                  value={newConnection.host || ''}
                  onChange={(e) => setNewConnection({ ...newConnection, host: e.target.value })}
                  className="col-span-2 px-3 py-2 text-sm bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors text-[var(--text-color)] placeholder-[var(--text-lighter)]"
                />
                <input
                  type="number"
                  placeholder="Port"
                  value={newConnection.port || 22}
                  onChange={(e) => setNewConnection({ ...newConnection, port: parseInt(e.target.value) || 22 })}
                  className="px-3 py-2 text-sm bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors text-[var(--text-color)] placeholder-[var(--text-lighter)]"
                />
                <Dropdown
                  value={newConnection.type || 'ssh'}
                  options={connectionTypeOptions}
                  onChange={(value) => setNewConnection({ ...newConnection, type: value as 'ssh' | 'sftp' })}
                />
              </div>
              <input
                type="text"
                placeholder="Username"
                value={newConnection.username || ''}
                onChange={(e) => setNewConnection({ ...newConnection, username: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors text-[var(--text-color)] placeholder-[var(--text-lighter)]"
              />
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password (optional)"
                  value={newConnection.password || ''}
                  onChange={(e) => setNewConnection({ ...newConnection, password: e.target.value })}
                  className="w-full px-3 py-2 pr-10 text-sm bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors text-[var(--text-color)] placeholder-[var(--text-lighter)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <input
                type="text"
                placeholder="Private key path (optional)"
                value={newConnection.keyPath || ''}
                onChange={(e) => setNewConnection({ ...newConnection, keyPath: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors text-[var(--text-color)] placeholder-[var(--text-lighter)]"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={editingConnection ? handleUpdateConnection : handleAddConnection}
                variant="default"
                size="sm"
                className="flex-1 h-8 text-sm"
              >
                <Save size={14} className="mr-2" />
                {editingConnection ? 'Update' : 'Add'}
              </Button>
              <Button
                onClick={() => {
                  setIsAddingConnection(false);
                  setEditingConnection(null);
                  setNewConnection({
                    name: '',
                    host: '',
                    port: 22,
                    username: '',
                    password: '',
                    keyPath: '',
                    type: 'ssh'
                  });
                }}
                variant="ghost"
                size="sm"
                className="h-8 px-3"
              >
                <X size={14} />
              </Button>
            </div>
          </div>
        </div>
      )}

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
            <Button
              onClick={() => setIsAddingConnection(true)}
              variant="default"
              size="sm"
              className="h-8"
            >
              <Plus size={14} className="mr-2" />
              Add Connection
            </Button>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {connections.map((connection) => (
              <div
                key={connection.id}
                className={cn(
                  "group relative p-3 rounded-lg border transition-all duration-200 hover:shadow-sm",
                  connection.isConnected 
                    ? "bg-green-50/50 border-green-200/50 dark:bg-green-950/20 dark:border-green-800/30" 
                    : "bg-[var(--secondary-bg)] border-[var(--border-color)] hover:bg-[var(--hover-color)]"
                )}
              >
                <div className="flex items-center gap-3">
                  {/* Connection Status */}
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full transition-colors",
                    connection.isConnected ? "bg-green-500" : "bg-gray-400 dark:bg-gray-600"
                  )} />
                  
                  {/* Connection Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-[var(--text-color)] truncate">
                        {connection.name}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--hover-color)] text-[var(--text-lighter)] font-mono">
                        {connection.type.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-lighter)] font-mono truncate">
                      {connection.username}
                    </div>
                    {connection.lastConnected && (
                      <div className="text-xs text-[var(--text-lighter)] mt-1">
                        Last connected {formatLastConnected(connection.lastConnected)}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {connection.isConnected && (
                      <Button
                        onClick={() => onFileSelect?.(`/remote/${connection.id}/`, true)}
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        title="Browse Files"
                      >
                        <FolderOpen size={12} />
                      </Button>
                    )}
                    <Button
                      onClick={() => handleConnect(connection.id)}
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-7 w-7 p-0",
                        connection.isConnected 
                          ? "text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300" 
                          : "text-[var(--text-lighter)] hover:text-[var(--text-color)]"
                      )}
                      title={connection.isConnected ? "Disconnect" : "Connect"}
                    >
                      {connection.isConnected ? <WifiOff size={12} /> : <Wifi size={12} />}
                    </Button>
                    <Button
                      onClick={() => handleEditConnection(connection)}
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-[var(--text-lighter)] hover:text-[var(--text-color)]"
                      title="Edit Connection"
                    >
                      <Edit size={12} />
                    </Button>
                    <Button
                      onClick={() => handleDeleteConnection(connection.id)}
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-400 hover:text-red-500"
                      title="Delete Connection"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default RemoteConnectionView; 