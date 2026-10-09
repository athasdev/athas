export type PreviewKind = "local" | "sandbox";

/** A preview link as the account service describes it. */
export interface Preview {
  id: string;
  kind: PreviewKind;
  url: string;
  port: number;
  runId: string | null;
  active: boolean;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  bytes: number;
  requests: number;
}

/** Where a local preview's tunnel connects, and until when its token is valid. */
export interface PreviewConnectTicket {
  url: string;
  expiresAt: string;
}

export type PreviewTunnelStatus = "connecting" | "open" | "reconnecting" | "ended";

export type HeaderList = Array<[string, string]>;
