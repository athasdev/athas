import type { LanguageExtension } from "@/features/editor/extensions/types";

// Languages are now loaded dynamically from the extension store
// This empty array is kept for backwards compatibility with code that imports allLanguages
export const allLanguages: LanguageExtension[] = [];
