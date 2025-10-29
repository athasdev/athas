import { invoke } from "@tauri-apps/api/core";

/**
 * Token management utilities for AI providers
 * Handles secure storage and retrieval of API tokens using Tauri's secure storage
 */

// Get API token for a specific provider
export const getProviderApiToken = async (providerId: string): Promise<string | null> => {
  try {
    const token = (await invoke("get_ai_provider_token", {
      providerId,
    })) as string | null;
    return token;
  } catch (error) {
    console.error(`Error getting ${providerId} API token:`, error);
    return null;
  }
};

// Store API token for a specific provider
export const storeProviderApiToken = async (providerId: string, token: string): Promise<void> => {
  try {
    await invoke("store_ai_provider_token", { providerId, token });
  } catch (error) {
    console.error(`Error storing ${providerId} API token:`, error);
    throw error;
  }
};

// Remove API token for a specific provider
export const removeProviderApiToken = async (providerId: string): Promise<void> => {
  try {
    await invoke("remove_ai_provider_token", { providerId });
  } catch (error) {
    console.error(`Error removing ${providerId} API token:`, error);
    throw error;
  }
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
