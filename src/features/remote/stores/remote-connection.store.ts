import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

const CONNECTIONS_STORE = "remote-connections.json";
const CREDENTIALS_STORE = "credentials.json";

interface RemoteConnectionInput {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  keyPath?: string;
  type: "ssh" | "sftp";
  saveCredentials?: boolean;
}

class ConnectionStore {
  private connectionsStore: any = null;
  private credentialsStore: any = null;

  private async getConnectionsStore() {
    if (!this.connectionsStore) {
      this.connectionsStore = await load(CONNECTIONS_STORE, {
        autoSave: true,
      } as Parameters<typeof load>[1]);
    }
    return this.connectionsStore;
  }

  private async getCredentialsStore() {
    if (!this.credentialsStore) {
      this.credentialsStore = await load(CREDENTIALS_STORE, {
        autoSave: true,
      } as Parameters<typeof load>[1]);
    }
    return this.credentialsStore;
  }

  private async storePassword(connectionId: string, password: string) {
    await invoke("store_remote_credential", { connectionId, password });
  }

  private async getPassword(connectionId: string): Promise<string | null> {
    return (await invoke("get_remote_credential", { connectionId })) as string | null;
  }

  private async removePassword(connectionId: string) {
    await invoke("remove_remote_credential", { connectionId });
  }

  private async syncWorkspaceTabName(connectionId: string, connectionName: string) {
    try {
      const { useWorkspaceTabsStore } =
        await import("@/features/window/stores/workspace-tabs.store");
      useWorkspaceTabsStore.getState().renameRemoteProjectTabs(connectionId, connectionName);
    } catch (error) {
      console.warn("Failed to sync remote workspace tab name:", error);
    }
  }

  async saveConnection(connection: RemoteConnectionInput) {
    const connectionsStore = await this.getConnectionsStore();

    const connectionData = {
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      keyPath: connection.keyPath,
      type: connection.type,
      isConnected: false,
      saveCredentials: connection.saveCredentials,
    };

    await connectionsStore.set(connection.id, connectionData);

    if (connection.saveCredentials && connection.password) {
      await this.storePassword(connection.id, connection.password);
    } else {
      await this.removePassword(connection.id);
    }

    await connectionsStore.save();
    await this.syncWorkspaceTabName(connection.id, connection.name);
  }

  async getConnection(connectionId: string) {
    const connectionsStore = await this.getConnectionsStore();

    const connection = await connectionsStore.get(connectionId);
    if (!connection) return null;

    const password = await this.getPassword(connectionId);
    const connectedIds = await this.getConnectedIds();

    return {
      ...connection,
      isConnected: connectedIds.includes(connectionId),
      password: password || undefined,
    };
  }

  async getAllConnections() {
    const connectionsStore = await this.getConnectionsStore();
    const connectedIds = await this.getConnectedIds();

    const connectionIds: string[] = await connectionsStore.keys();
    const connections = await Promise.all(
      connectionIds.map(async (id) => {
        const connection = await connectionsStore.get(id);
        if (!connection) return null;

        const password = await this.getPassword(id);
        return {
          ...connection,
          isConnected: connectedIds.includes(id),
          password: password || undefined,
        };
      }),
    );

    return connections.filter(
      (connection): connection is NonNullable<typeof connection> => connection !== null,
    );
  }

  async deleteConnection(connectionId: string) {
    const connectionsStore = await this.getConnectionsStore();

    await connectionsStore.delete(connectionId);
    await this.removePassword(connectionId);

    await connectionsStore.save();
  }

  async updateConnectionStatus(connectionId: string, isConnected: boolean, lastConnected?: string) {
    const connectionsStore = await this.getConnectionsStore();
    const connection = await connectionsStore.get(connectionId);

    if (connection) {
      const updatedConnection = {
        ...connection,
        isConnected,
        lastConnected: lastConnected || connection.lastConnected,
      };

      await connectionsStore.set(connectionId, updatedConnection);
      await connectionsStore.save();
    }
  }

  async migrateFromLocalStorage() {
    try {
      const stored = localStorage.getItem("athas-remote-connections");
      if (stored) {
        const connections = JSON.parse(stored) as RemoteConnectionInput[];

        await Promise.all(
          connections.map((conn) =>
            this.saveConnection({
              ...conn,
              saveCredentials: !!conn.password,
            }),
          ),
        );

        localStorage.removeItem("athas-remote-connections");
        console.log("Successfully migrated connections from localStorage to Tauri Store");
      }

      await this.migrateLegacyCredentialsStore();
    } catch (error) {
      console.error("Error migrating from localStorage:", error);
    }
  }

  async migrateLegacyCredentialsStore() {
    const credentialsStore = await this.getCredentialsStore();
    const credentialIds: string[] = await credentialsStore.keys();

    if (credentialIds.length === 0) {
      return;
    }

    await Promise.all(
      credentialIds.map(async (connectionId) => {
        const legacyCredentials = await credentialsStore.get(connectionId);
        const password =
          legacyCredentials &&
          typeof legacyCredentials === "object" &&
          "password" in legacyCredentials &&
          typeof legacyCredentials.password === "string"
            ? legacyCredentials.password
            : null;

        if (password) {
          await this.storePassword(connectionId, password);
        }

        await credentialsStore.delete(connectionId);
      }),
    );

    await credentialsStore.save();
    console.log("Successfully migrated remote credentials to secure storage");
  }

  private async getConnectedIds(): Promise<string[]> {
    try {
      return (await invoke("ssh_get_connected_ids")) as string[];
    } catch {
      return [];
    }
  }
}

export const connectionStore = new ConnectionStore();
