import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { calculateFrecencyScore } from "../../utils/frecency";
import type { RecentFile, RecentFilesStore } from "../models/recent-files";

const MAX_RECENT_FILES = 50;
const PRUNE_THRESHOLD_SCORE = 5; // Remove files with frecency score below this

export const useRecentFilesStore = create<RecentFilesStore>()(
  immer(
    persist(
      (set, get) => ({
        recentFiles: [],
        maxRecentFiles: MAX_RECENT_FILES,

        addOrUpdateRecentFile: (path: string, name: string) => {
          set((state) => {
            const existingIndex = state.recentFiles.findIndex((f) => f.path === path);
            const now = new Date().toISOString();

            if (existingIndex >= 0) {
              // Update existing file
              const file = state.recentFiles[existingIndex];
              file.lastAccessed = now;
              file.accessCount += 1;
              file.frecencyScore = calculateFrecencyScore(file.accessCount, now);
            } else {
              // Add new file
              const newFile: RecentFile = {
                path,
                name,
                lastAccessed: now,
                accessCount: 1,
                frecencyScore: calculateFrecencyScore(1, now),
              };
              state.recentFiles.push(newFile);
            }

            // Keep only max number of files, sorted by frecency
            if (state.recentFiles.length > state.maxRecentFiles) {
              state.recentFiles.sort((a, b) => b.frecencyScore - a.frecencyScore);
              state.recentFiles = state.recentFiles.slice(0, state.maxRecentFiles);
            }
          });
        },

        getRecentFilesOrderedByFrecency: () => {
          const { recentFiles } = get();

          // Recalculate frecency scores before sorting
          const filesWithUpdatedScores = recentFiles.map((file) => ({
            ...file,
            frecencyScore: calculateFrecencyScore(file.accessCount, file.lastAccessed),
          }));

          // Sort by frecency score (highest first)
          return filesWithUpdatedScores.sort((a, b) => b.frecencyScore - a.frecencyScore);
        },

        removeRecentFile: (path: string) => {
          set((state) => {
            state.recentFiles = state.recentFiles.filter((f) => f.path !== path);
          });
        },

        clearRecentFiles: () => {
          set((state) => {
            state.recentFiles = [];
          });
        },

        pruneOldFiles: () => {
          set((state) => {
            // Recalculate scores and remove files below threshold
            state.recentFiles = state.recentFiles
              .map((file) => ({
                ...file,
                frecencyScore: calculateFrecencyScore(file.accessCount, file.lastAccessed),
              }))
              .filter((file) => file.frecencyScore >= PRUNE_THRESHOLD_SCORE);
          });
        },
      }),
      {
        name: "athas-recent-files",
        version: 1,
      },
    ),
  ),
);
