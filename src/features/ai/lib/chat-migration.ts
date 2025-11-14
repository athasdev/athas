import type { Chat } from "@/features/ai/types/ai-chat";
import { saveChatToDb } from "@/utils/chat-history-db";

/**
 * Migrate chat history from localStorage to SQLite
 * This handles the migration from the old localStorage-based storage (v4)
 * to the new SQLite-based storage (v5)
 */

const OLD_STORAGE_KEY = "athas-ai-chat-v4";

interface LegacyStorageState {
  state: {
    chats?: any[];
    currentChatId?: string;
    mode?: string;
    outputStyle?: string;
  };
  version: number;
}

/**
 * Check if legacy localStorage data exists
 */
export function hasLegacyData(): boolean {
  try {
    const data = localStorage.getItem(OLD_STORAGE_KEY);
    if (!data) return false;

    const parsed = JSON.parse(data) as LegacyStorageState;
    return !!(parsed?.state?.chats && parsed.state.chats.length > 0);
  } catch (error) {
    console.error("Error checking for legacy data:", error);
    return false;
  }
}

/**
 * Get legacy chats from localStorage
 */
function getLegacyChats(): Chat[] {
  try {
    const data = localStorage.getItem(OLD_STORAGE_KEY);
    if (!data) return [];

    const parsed = JSON.parse(data) as LegacyStorageState;
    const rawChats = parsed?.state?.chats || [];

    // Convert legacy chats to proper Chat format
    return rawChats.map((chat: any) => ({
      id: chat.id,
      title: chat.title,
      messages: (chat.messages || []).map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
        toolCalls: msg.toolCalls?.map((tc: any) => ({
          ...tc,
          timestamp: new Date(tc.timestamp),
        })),
      })),
      createdAt: new Date(chat.createdAt),
      lastMessageAt: new Date(chat.lastMessageAt),
    }));
  } catch (error) {
    console.error("Error reading legacy chats:", error);
    return [];
  }
}

/**
 * Migrate all chats from localStorage to SQLite
 */
export async function migrateChatsToSQLite(): Promise<{
  success: boolean;
  migratedCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let migratedCount = 0;

  try {
    console.log("Starting chat migration from localStorage to SQLite...");

    const legacyChats = getLegacyChats();
    if (legacyChats.length === 0) {
      console.log("No legacy chats found to migrate");
      return { success: true, migratedCount: 0, errors: [] };
    }

    console.log(`Found ${legacyChats.length} chats to migrate`);

    // Migrate each chat
    for (const chat of legacyChats) {
      try {
        await saveChatToDb(chat);
        migratedCount++;
        console.log(`Migrated chat: ${chat.title} (${chat.id})`);
      } catch (error) {
        const errorMsg = `Failed to migrate chat ${chat.id}: ${error}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    console.log(`Migration complete: ${migratedCount}/${legacyChats.length} chats migrated`);

    return {
      success: errors.length === 0,
      migratedCount,
      errors,
    };
  } catch (error) {
    const errorMsg = `Fatal error during migration: ${error}`;
    console.error(errorMsg);
    return {
      success: false,
      migratedCount,
      errors: [errorMsg],
    };
  }
}

/**
 * Clear legacy localStorage data after successful migration
 */
export function clearLegacyData(): void {
  try {
    localStorage.removeItem(OLD_STORAGE_KEY);
    console.log("Legacy localStorage data cleared");
  } catch (error) {
    console.error("Error clearing legacy data:", error);
  }
}

/**
 * Get migration status from new localStorage key
 */
const MIGRATION_STATUS_KEY = "athas-chat-migration-status";

interface MigrationStatus {
  completed: boolean;
  timestamp: number;
  migratedCount: number;
}

export function getMigrationStatus(): MigrationStatus | null {
  try {
    const data = localStorage.getItem(MIGRATION_STATUS_KEY);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Error reading migration status:", error);
    return null;
  }
}

export function setMigrationStatus(status: MigrationStatus): void {
  try {
    localStorage.setItem(MIGRATION_STATUS_KEY, JSON.stringify(status));
  } catch (error) {
    console.error("Error saving migration status:", error);
  }
}

/**
 * Main migration function - should be called on app initialization
 */
export async function performMigrationIfNeeded(): Promise<boolean> {
  // Check if migration already completed
  const migrationStatus = getMigrationStatus();
  if (migrationStatus?.completed) {
    console.log("Chat migration already completed previously");
    return true;
  }

  // Check if legacy data exists
  if (!hasLegacyData()) {
    console.log("No legacy data to migrate");
    // Mark migration as completed (nothing to migrate)
    setMigrationStatus({
      completed: true,
      timestamp: Date.now(),
      migratedCount: 0,
    });
    return true;
  }

  // Perform migration
  console.log("Performing chat migration...");
  const result = await migrateChatsToSQLite();

  if (result.success) {
    // Clear legacy data
    clearLegacyData();

    // Save migration status
    setMigrationStatus({
      completed: true,
      timestamp: Date.now(),
      migratedCount: result.migratedCount,
    });

    console.log(`Migration successful: ${result.migratedCount} chats migrated`);
    return true;
  } else {
    console.error(`Migration failed with ${result.errors.length} errors`);
    return false;
  }
}
