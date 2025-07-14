import { invoke } from "@tauri-apps/api/core";

/**
 * Token management utilities for AI providers
 * Handles secure storage and retrieval of API tokens
 */

// Get API token for a specific provider
export const getProviderApiToken = async (providerId: string): Promise<string | null> => {
  try {
    // For now, use the same storage key but we could extend this
    // to support multiple providers with different storage keys
    const storageKey = providerId === "openai" ? "get_github_token" : `get_${providerId}_token`;

    try {
      const token = (await invoke(storageKey)) as string | null;
      return token;
    } catch (_error) {
      // Fallback to github token for backward compatibility
      if (providerId !== "openai") {
        const token = (await invoke("get_github_token")) as string | null;
        return token;
      }
      return null;
    }
  } catch (_error) {
    console.error(`Error getting ${providerId} API token:`, _error);
    return null;
  }
};

// Store API token for a specific provider
export const storeProviderApiToken = async (providerId: string, token: string): Promise<void> => {
  try {
    // For now, use the same storage method but we could extend this
    const storageKey = providerId === "openai" ? "store_github_token" : `store_${providerId}_token`;

    try {
      await invoke(storageKey, { token });
    } catch (_error) {
      // Fallback to github token storage for backward compatibility
      await invoke("store_github_token", { token });
    }
  } catch (_error) {
    console.error(`Error storing ${providerId} API token:`, _error);
    throw _error;
  }
};

// Remove API token for a specific provider
export const removeProviderApiToken = async (providerId: string): Promise<void> => {
  try {
    const storageKey =
      providerId === "openai" ? "remove_github_token" : `remove_${providerId}_token`;

    try {
      await invoke(storageKey);
    } catch (_error) {
      // Fallback to github token removal for backward compatibility
      await invoke("remove_github_token");
    }
  } catch (_error) {
    console.error(`Error removing ${providerId} API token:`, _error);
    throw _error;
  }
};

// Legacy function for backward compatibility
export const getOpenAIToken = async (): Promise<string | null> => {
  return getProviderApiToken("openai");
};

// Validate API key for a specific provider
export const validateProviderApiKey = async (
  providerId: string,
  apiKey: string,
): Promise<boolean> => {
  try {
    // Import provider dynamically to avoid circular dependency
    const { getProvider } = await import("./providers");
    const provider = getProvider(providerId);

    if (!provider) {
      console.error(`Provider not found: ${providerId}`);
      return false;
    }

    return await provider.validateApiKey(apiKey);
  } catch (error) {
    console.error(`${providerId} API key validation error:`, error);
    return false;
  }
};
