/**
 * Utility functions for managing localStorage with quota handling
 */

/**
 * Clears all localStorage items that match a prefix pattern
 */
const clearLocalStorageByPrefix = (prefix: string): void => {
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
};

/**
 * Safely stores an item in localStorage with quota exceeded handling
 */
export const safeLocalStorageSetItem = (
  key: string,
  value: string,
  options: {
    clearPrefix?: string;
    maxRetries?: number;
    truncateData?: (data: string) => string;
    onQuotaExceeded?: (error: Error) => void;
    onSuccess?: () => void;
    onTruncated?: (originalSize: number, truncatedSize: number) => void;
  } = {},
): boolean => {
  const {
    clearPrefix,
    maxRetries = 2,
    truncateData,
    onQuotaExceeded,
    onSuccess,
    onTruncated,
  } = options;

  let attempts = 0;
  let currentValue = value;

  while (attempts <= maxRetries) {
    try {
      localStorage.setItem(key, currentValue);

      if (attempts === 0) {
        onSuccess?.();
      } else if (attempts > 0 && onTruncated) {
        onTruncated(value.length, currentValue.length);
      }

      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "QuotaExceededError") {
        console.warn(`localStorage quota exceeded on attempt ${attempts + 1}`, error);

        if (attempts === 0 && clearPrefix) {
          // First attempt: try clearing items with specified prefix
          clearLocalStorageByPrefix(clearPrefix);
        } else if (attempts === 1 && truncateData) {
          // Second attempt: try truncating the data
          const originalLength = currentValue.length;
          currentValue = truncateData(currentValue);

          if (currentValue.length >= originalLength) {
            // Truncation didn't help, give up
            console.error("Data truncation did not reduce size sufficiently");
            onQuotaExceeded?.(error);
            return false;
          }
        } else {
          // Final attempt failed
          console.error("All attempts to store in localStorage failed");
          onQuotaExceeded?.(error);
          return false;
        }
      } else {
        // Non-quota error
        console.error("localStorage error:", error);
        return false;
      }
    }

    attempts++;
  }

  return false;
};
