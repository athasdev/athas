import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type {
  CopilotAuthActions,
  CopilotAuthState,
  CopilotAuthStatus,
  CopilotModel,
  CopilotTokenResponse,
  DeviceFlowResponse,
  OAuthTokenResponse,
  StoredCopilotTokens,
} from "@/features/ai/types/copilot";

const initialState: CopilotAuthState = {
  stage: "idle",
  deviceCode: null,
  userCode: null,
  verificationUri: null,
  expiresAt: null,
  pollInterval: 5,
  isAuthenticated: false,
  githubUsername: null,
  copilotTokenExpiresAt: null,
  availableModels: [],
  enterpriseUri: null,
  error: null,
};

export const useCopilotAuthStore = create<CopilotAuthState & CopilotAuthActions>()(
  immer(
    persist(
      (set, get) => ({
        ...initialState,

        startSignIn: async () => {
          set((state) => {
            state.stage = "awaiting_code";
            state.error = null;
          });

          try {
            const response = await invoke<DeviceFlowResponse>("copilot_start_device_flow");

            set((state) => {
              state.deviceCode = response.device_code;
              state.userCode = response.user_code;
              state.verificationUri = response.verification_uri;
              state.expiresAt = Date.now() + response.expires_in * 1000;
              state.pollInterval = response.interval;
              state.stage = "polling";
            });
          } catch (error) {
            set((state) => {
              state.stage = "error";
              state.error = error instanceof Error ? error.message : String(error);
            });
          }
        },

        pollForAuth: async () => {
          const { deviceCode, stage } = get();

          if (stage !== "polling" || !deviceCode) {
            return false;
          }

          try {
            const response = await invoke<OAuthTokenResponse>("copilot_poll_device_auth", {
              deviceCode,
            });

            if (response.error) {
              if (response.error === "authorization_pending") {
                return false;
              }
              if (response.error === "slow_down") {
                set((state) => {
                  state.pollInterval = state.pollInterval + 5;
                });
                return false;
              }
              if (response.error === "expired_token") {
                set((state) => {
                  state.stage = "error";
                  state.error = "Authorization expired. Please try again.";
                });
                return false;
              }
              if (response.error === "access_denied") {
                set((state) => {
                  state.stage = "error";
                  state.error = "Authorization denied by user.";
                });
                return false;
              }

              set((state) => {
                state.stage = "error";
                state.error = response.error_description || response.error || "Unknown error";
              });
              return false;
            }

            if (response.access_token) {
              set((state) => {
                state.stage = "exchanging_token";
              });

              const copilotToken = await invoke<CopilotTokenResponse>("copilot_get_copilot_token", {
                githubToken: response.access_token,
              });

              set((state) => {
                state.stage = "authenticated";
                state.isAuthenticated = true;
                state.copilotTokenExpiresAt = copilotToken.expires_at * 1000;
                state.deviceCode = null;
                state.userCode = null;
                state.verificationUri = null;
                state.expiresAt = null;
              });

              get().fetchAvailableModels();
              return true;
            }

            return false;
          } catch (error) {
            set((state) => {
              state.stage = "error";
              state.error = error instanceof Error ? error.message : String(error);
            });
            return false;
          }
        },

        cancelSignIn: () => {
          set((state) => {
            state.stage = "idle";
            state.deviceCode = null;
            state.userCode = null;
            state.verificationUri = null;
            state.expiresAt = null;
            state.error = null;
          });
        },

        signOut: async () => {
          try {
            await invoke("copilot_sign_out");
          } catch (error) {
            console.error("Failed to sign out:", error);
          }

          set((state) => {
            Object.assign(state, initialState);
          });
        },

        refreshTokenIfNeeded: async () => {
          const { isAuthenticated, copilotTokenExpiresAt } = get();

          if (!isAuthenticated) {
            return false;
          }

          const now = Date.now();
          const bufferMs = 5 * 60 * 1000;

          if (copilotTokenExpiresAt && copilotTokenExpiresAt - now > bufferMs) {
            return true;
          }

          try {
            const response = await invoke<CopilotTokenResponse>("copilot_refresh_token");

            set((state) => {
              state.copilotTokenExpiresAt = response.expires_at * 1000;
            });

            return true;
          } catch (error) {
            console.error("Failed to refresh token:", error);
            set((state) => {
              state.isAuthenticated = false;
              state.stage = "idle";
              state.error = "Session expired. Please sign in again.";
            });
            return false;
          }
        },

        fetchAvailableModels: async () => {
          try {
            const models = await invoke<CopilotModel[]>("copilot_list_models");

            set((state) => {
              state.availableModels = models;
            });
          } catch (error) {
            console.error("Failed to fetch models:", error);
          }
        },

        checkAuthStatus: async () => {
          try {
            const status = await invoke<CopilotAuthStatus>("copilot_check_auth_status");

            set((state) => {
              state.isAuthenticated = status.authenticated;
              state.githubUsername = status.github_username ?? null;
              state.copilotTokenExpiresAt = status.copilot_token_expires_at
                ? status.copilot_token_expires_at * 1000
                : null;

              if (status.authenticated) {
                state.stage = "authenticated";
              } else if (state.stage === "authenticated") {
                state.stage = "idle";
              }
            });

            if (status.authenticated) {
              get().fetchAvailableModels();
            }
          } catch (error) {
            console.error("Failed to check auth status:", error);
          }
        },

        setEnterpriseUri: async (uri) => {
          try {
            await invoke("copilot_set_enterprise_uri", { uri });

            set((state) => {
              state.enterpriseUri = uri;
            });
          } catch (error) {
            console.error("Failed to set enterprise URI:", error);
          }
        },

        getAccessToken: async () => {
          const refreshed = await get().refreshTokenIfNeeded();

          if (!refreshed) {
            return null;
          }

          try {
            const tokens = await invoke<StoredCopilotTokens | null>("copilot_get_stored_tokens");

            if (tokens) {
              return tokens.access_token;
            }

            return null;
          } catch {
            return null;
          }
        },

        reset: () => {
          set((state) => {
            Object.assign(state, initialState);
          });
        },
      }),
      {
        name: "copilot-auth-storage",
        partialize: (state) => ({
          isAuthenticated: state.isAuthenticated,
          githubUsername: state.githubUsername,
          copilotTokenExpiresAt: state.copilotTokenExpiresAt,
          enterpriseUri: state.enterpriseUri,
        }),
      },
    ),
  ),
);
