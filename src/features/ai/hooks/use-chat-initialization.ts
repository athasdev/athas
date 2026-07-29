import { useEffect, useRef, useState } from "react";
import { performMigrationIfNeeded } from "../lib/chat-migration";
import { useAIChatStore } from "../stores/ai-chat.store";

export function useChatInitialization() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  const initializeDatabase = useAIChatStore((state) => state.actions.initializeDatabase);
  const loadChatsFromDatabase = useAIChatStore((state) => state.actions.loadChatsFromDatabase);

  useEffect(() => {
    // Prevent double initialization in strict mode
    if (initRef.current) return;
    initRef.current = true;

    async function initialize() {
      try {
        setIsLoading(true);
        setError(null);

        // Step 1: Initialize SQLite database
        await initializeDatabase();

        // Step 2: Migrate from localStorage if needed
        const migrationSuccess = await performMigrationIfNeeded();

        if (!migrationSuccess) {
          console.warn("Migration failed, but continuing with initialization");
        }

        // Step 3: Load chats from database
        await loadChatsFromDatabase();

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
  }, [initializeDatabase, loadChatsFromDatabase]);

  return { isInitialized, isLoading, error };
}
