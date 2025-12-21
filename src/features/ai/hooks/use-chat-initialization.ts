import { useEffect, useRef, useState } from "react";
import { performMigrationIfNeeded } from "../lib/chat-migration";
import { useAIChatStore } from "../store/store";

/**
 * Hook to initialize AI chat storage
 * - Initializes SQLite database
 * - Migrates from localStorage if needed
 * - Loads chats from database
 */
export function useChatInitialization() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  const initializeDatabase = useAIChatStore((state) => state.initializeDatabase);
  const loadChatsFromDatabase = useAIChatStore((state) => state.loadChatsFromDatabase);
  const applyDefaultSettings = useAIChatStore((state) => state.applyDefaultSettings);

  useEffect(() => {
    // Prevent double initialization in strict mode
    if (initRef.current) return;
    initRef.current = true;

    async function initialize() {
      try {
        console.log("Initializing AI chat storage...");
        setIsLoading(true);
        setError(null);

        // Step 1: Initialize SQLite database
        console.log("1. Initializing SQLite database...");
        await initializeDatabase();

        // Step 2: Migrate from localStorage if needed
        console.log("2. Checking for migration...");
        const migrationSuccess = await performMigrationIfNeeded();

        if (!migrationSuccess) {
          console.warn("Migration failed, but continuing with initialization");
        }

        // Step 3: Load chats from database
        console.log("3. Loading chats from database...");
        await loadChatsFromDatabase();

        // Step 4: Apply default settings from settings store
        console.log("4. Applying default settings...");
        applyDefaultSettings();

        console.log("AI chat storage initialized successfully");
        setIsInitialized(true);
      } catch (err) {
        const errorMsg = `Failed to initialize chat storage: ${err}`;
        console.error(errorMsg);
        setError(errorMsg);
      } finally {
        setIsLoading(false);
      }
    }

    initialize();
  }, [initializeDatabase, loadChatsFromDatabase, applyDefaultSettings]);

  return { isInitialized, isLoading, error };
}
