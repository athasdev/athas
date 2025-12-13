export interface DeviceFlowResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface OAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface CopilotTokenResponse {
  token: string;
  expires_at: number;
  refresh_in?: number;
}

export interface CopilotAuthStatus {
  authenticated: boolean;
  github_username?: string;
  copilot_token_expires_at?: number;
}

export interface StoredCopilotTokens {
  github_token: string;
  access_token: string;
  expires_at: number;
  username?: string;
}

export interface CopilotModel {
  id: string;
  name: string;
  version?: string;
  is_default?: boolean;
}

export type CopilotAuthStage =
  | "idle"
  | "awaiting_code"
  | "polling"
  | "exchanging_token"
  | "authenticated"
  | "error";

export interface CopilotAuthState {
  stage: CopilotAuthStage;
  deviceCode: string | null;
  userCode: string | null;
  verificationUri: string | null;
  expiresAt: number | null;
  pollInterval: number;
  isAuthenticated: boolean;
  githubUsername: string | null;
  copilotTokenExpiresAt: number | null;
  availableModels: CopilotModel[];
  enterpriseUri: string | null;
  error: string | null;
}

export interface CopilotAuthActions {
  startSignIn: () => Promise<void>;
  pollForAuth: () => Promise<boolean>;
  cancelSignIn: () => void;
  signOut: () => Promise<void>;
  refreshTokenIfNeeded: () => Promise<boolean>;
  fetchAvailableModels: () => Promise<void>;
  checkAuthStatus: () => Promise<void>;
  setEnterpriseUri: (uri: string | null) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  reset: () => void;
}
