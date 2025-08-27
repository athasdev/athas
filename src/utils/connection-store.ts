import { load } from "@tauri-apps/plugin-store";

const CONNECTIONS_STORE = "remote-connections.json";
const CREDENTIALS_STORE = "credentials.json";

class ConnectionStore {
  private connectionsStore: any = null;
  private credentialsStore: any = null;

  private async getConnectionsStore() {
    if (!this.connectionsStore) {
      this.connectionsStore = await load(CONNECTIONS_STORE, { autoSave: true });
    }
    return this.connectionsStore;
  }

  private async getCredentialsStore() {
    if (!this.credentialsStore) {
      this.credentialsStore = await load(CREDENTIALS_STORE, { autoSave: true });
    }
    return this.credentialsStore;
  }

  async saveConnection(connection: {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    keyPath?: string;
    type: "ssh" | "sftp";
    saveCredentials?: boolean;
  }) {
    const connectionsStore = await this.getConnectionsStore();
    const credentialsStore = await this.getCredentialsStore();

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
      await credentialsStore.set(connection.id, {
        password: connection.password,
      });
    } else {
      await credentialsStore.delete(connection.id);
    }

    await connectionsStore.save();
    await credentialsStore.save();
  }

  async getConnection(connectionId: string) {
    const connectionsStore = await this.getConnectionsStore();
    const credentialsStore = await this.getCredentialsStore();

    const connection = await connectionsStore.get(connectionId);
    if (!connection) return null;

    const credentials = await credentialsStore.get(connectionId);

    return {
      ...connection,
      password: credentials?.password,
    };
  }

  async getAllConnections() {
    const connectionsStore = await this.getConnectionsStore();
    const credentialsStore = await this.getCredentialsStore();

    const connectionIds: string[] = await connectionsStore.keys();
    const connections = [];

    for (const id of connectionIds) {
      const connection = await connectionsStore.get(id);
      if (connection) {
        const credentials = await credentialsStore.get(id);
        connections.push({
          ...connection,
          password: credentials?.password,
        });
      }
    }

    return connections;
  }

  async deleteConnection(connectionId: string) {
    const connectionsStore = await this.getConnectionsStore();
    const credentialsStore = await this.getCredentialsStore();

    await connectionsStore.delete(connectionId);
    await credentialsStore.delete(connectionId);

    await connectionsStore.save();
    await credentialsStore.save();
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
        const connections = JSON.parse(stored);

        for (const conn of connections) {
          await this.saveConnection({
            ...conn,
            saveCredentials: !!conn.password,
          });
        }

        localStorage.removeItem("athas-remote-connections");
        console.log("Successfully migrated connections from localStorage to Tauri Store");
      }
    } catch (error) {
      console.error("Error migrating from localStorage:", error);
    }
  }
}

export const connectionStore = new ConnectionStore();
