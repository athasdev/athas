export interface RemoteConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  keyPath?: string;
  type: "ssh" | "sftp";
  isConnected: boolean;
  lastConnected?: string;
  saveCredentials?: boolean;
}

export interface RemoteConnectionFormData {
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  keyPath?: string;
  type: "ssh" | "sftp";
  saveCredentials?: boolean;
}
