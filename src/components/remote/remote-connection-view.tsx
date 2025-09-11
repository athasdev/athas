import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { memo, useEffect, useState } from "react";
import { connectionStore } from "@/utils/connection-store";
import ConnectionDialog from "./connection-dialog";
import ConnectionList from "./connection-list";
import PasswordPromptDialog from "./password-prompt-dialog";
import type { RemoteConnection, RemoteConnectionFormData } from "./types";

interface RemoteConnectionViewProps {
  onFileSelect?: (path: string, isDir: boolean) => void;
}

const RemoteConnectionView = ({ onFileSelect }: RemoteConnectionViewProps) => {
  const [connections, setConnections] = useState<RemoteConnection[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<RemoteConnection | null>(null);
  const [passwordPromptConnection, setPasswordPromptConnection] = useState<RemoteConnection | null>(
    null,
  );

  // Load connections from Tauri Store
  useEffect(() => {
    const loadConnections = async () => {
      try {
        // First migrate any existing localStorage connections
        await connectionStore.migrateFromLocalStorage();

        // Then load all connections from Tauri Store
        const storedConnections = await connectionStore.getAllConnections();
        setConnections(storedConnections.map((conn: any) => ({ ...conn, isConnected: false })));
      } catch (error) {
        console.error("Error loading remote connections:", error);
      }
    };

    loadConnections();
  }, []);

  // Listen for remote connection disconnection events
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupDisconnectListener = async () => {
      try {
        unlisten = await listen<{ connectionId: string }>(
          "remote-connection-disconnected",
          async (event) => {
            console.log("Received remote disconnection event:", event.payload);

            // Update connection status in store
            await connectionStore.updateConnectionStatus(event.payload.connectionId, false);

            // Refresh local state
            await refreshConnections();
          },
        );
      } catch (error) {
        console.error("Failed to set up disconnect event listener:", error);
      }
    };

    setupDisconnectListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Update the local state and reload connections
  const refreshConnections = async () => {
    try {
      const storedConnections = await connectionStore.getAllConnections();
      setConnections(storedConnections);
    } catch (error) {
      console.error("Error refreshing connections:", error);
    }
  };

  const handleSaveConnection = async (formData: RemoteConnectionFormData): Promise<boolean> => {
    try {
      if (editingConnection) {
        // Update existing connection
        await connectionStore.saveConnection({
          ...editingConnection,
          ...formData,
        });
      } else {
        // Add new connection
        const newConnection = {
          id: Date.now().toString(),
          ...formData,
          isConnected: false,
        };
        await connectionStore.saveConnection(newConnection);
      }

      // Refresh the local state
      await refreshConnections();
      return true;
    } catch (error) {
      console.error("Error saving connection:", error);
      return false;
    }
  };

  const handleConnect = async (connectionId: string, providedPassword?: string) => {
    const connection = connections.find((conn) => conn.id === connectionId);
    if (!connection) return;

    try {
      if (connection.isConnected) {
        // Disconnect
        await invoke("ssh_disconnect", { connectionId });

        // Update connection status in store
        await connectionStore.updateConnectionStatus(connectionId, false);

        // Refresh local state
        await refreshConnections();
      } else {
        // Check if we need to prompt for password
        // Only prompt if no SSH key is available AND no password is saved/provided
        if (!connection.keyPath && !connection.password && !providedPassword) {
          setPasswordPromptConnection(connection);
          return;
        }

        // Connect
        await invoke("ssh_connect", {
          connectionId,
          host: connection.host,
          port: connection.port,
          username: connection.username,
          password: providedPassword || connection.password || null,
          keyPath: connection.keyPath || null,
          useSftp: connection.type === "sftp",
        });

        // Update connection status in store
        await connectionStore.updateConnectionStatus(connectionId, true, new Date().toISOString());

        // Refresh local state
        await refreshConnections();

        // Create new remote window
        await invoke("create_remote_window", {
          connectionId,
          connectionName: connection.name,
        });
      }
    } catch (error) {
      console.error("Connection error:", error);

      // If this is a password prompt connection attempt, don't show the dialog
      // Let the password prompt handle the error display
      if (!providedPassword) {
        try {
          await message(String(error), {
            title: "Connection Error",
            kind: "error",
          });
        } catch {
          // Fallback to console if dialog fails
          console.error("Connection failed:", error);
        }
      }

      // Re-throw error so password prompt can handle it
      throw error;
    }
  };

  const handleEditConnection = (connection: RemoteConnection) => {
    setEditingConnection(connection);
    setIsDialogOpen(true);
  };

  const handleDeleteConnection = async (connectionId: string) => {
    try {
      await connectionStore.deleteConnection(connectionId);
      await refreshConnections();
    } catch (error) {
      console.error("Error deleting connection:", error);
    }
  };

  const handleAddNew = () => {
    setEditingConnection(null);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingConnection(null);
  };

  const handlePasswordPromptConnect = async (connectionId: string, password: string) => {
    await handleConnect(connectionId, password);
    setPasswordPromptConnection(null);
  };

  const handleClosePasswordPrompt = () => {
    setPasswordPromptConnection(null);
  };

  return (
    <>
      <ConnectionList
        connections={connections}
        onConnect={handleConnect}
        onEdit={handleEditConnection}
        onDelete={handleDeleteConnection}
        onFileSelect={onFileSelect}
        onAddNew={handleAddNew}
      />

      <ConnectionDialog
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        onSave={handleSaveConnection}
        editingConnection={editingConnection}
      />

      <PasswordPromptDialog
        isOpen={!!passwordPromptConnection}
        connection={passwordPromptConnection}
        onClose={handleClosePasswordPrompt}
        onConnect={handlePasswordPromptConnect}
      />
    </>
  );
};

export default memo(RemoteConnectionView);
