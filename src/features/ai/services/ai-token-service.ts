import { commands } from "@/bindings/commands";

/**
 * Token management utilities for AI providers
 * Handles secure storage and retrieval of API tokens using Tauri's secure storage
 */

const tokenChangeListeners = new Set<(providerId: string) => void>();

/** Calls `listener` after a provider's API token is stored or removed; returns an unsubscribe. */
export function onProviderApiTokenChange(listener: (providerId: string) => void) {
  tokenChangeListeners.add(listener);
  return () => {
    tokenChangeListeners.delete(listener);
  };
}

function notifyTokenChange(providerId: string) {
  for (const listener of tokenChangeListeners) listener(providerId);
}

// Get API token for a specific provider
export const getProviderApiToken = async (providerId: string): Promise<string | null> => {
  try {
    const token = await commands.getAiProviderToken(providerId);
    return token;
  } catch (error) {
    console.error(`Error getting ${providerId} API token:`, error);
    return null;
  }
};

// Store API token for a specific provider
export const storeProviderApiToken = async (providerId: string, token: string): Promise<void> => {
  try {
    await commands.storeAiProviderToken(providerId, token);
    notifyTokenChange(providerId);
  } catch (error) {
    console.error(`Error storing ${providerId} API token:`, error);
    throw error;
  }
};

// Remove API token for a specific provider
export const removeProviderApiToken = async (providerId: string): Promise<void> => {
  try {
    await commands.removeAiProviderToken(providerId);
    notifyTokenChange(providerId);
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
    const { getProvider } = await import("@/features/ai/services/providers/ai-provider-registry");
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
