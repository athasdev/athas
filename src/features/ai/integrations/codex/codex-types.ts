export interface CodexIntegrationStatus {
  installed: boolean;
  version: string | null;
  running: boolean;
  initialized: boolean;
  state: string;
  error: string | null;
  cwd: string | null;
  threadId: string | null;
  turnId: string | null;
  account: Record<string, unknown> | null;
}

export interface CodexProtocolEvent {
  method: string;
  params: Record<string, any>;
  id?: string | number;
}

export interface CodexThreadSettings {
  model?: string;
  effort?: string;
  personality?: string;
  approvalPolicy?: string;
  sandbox?: string;
  developerInstructions?: string;
  serviceTier?: string;
  collaborationMode?: string;
}

export interface CodexCatalog {
  models: any[];
  threads: any[];
  skills: any[];
  mcpServers: any[];
  permissionProfiles: any[];
  collaborationModes: any[];
  rateLimits: Record<string, any> | null;
}
