import {
  loadCodeMirrorLanguage,
  resolveCodeMirrorLanguageId,
} from "../engines/codemirror/languages";
import { getLanguageIdFromPath } from "./language-id";

/** Starts loading the editor language for `path`, so it is ready when the file's editor mounts. */
export function preloadEditorLanguageForPath(path: string) {
  return loadCodeMirrorLanguage(getLanguageIdFromPath(path));
}

/** Loads the languages of the first `limit` distinct languages among `paths`, one at a time. */
export async function preloadEditorLanguagesForPaths(paths: readonly string[], limit: number) {
  const languageIds = new Set<string>();
  for (const path of paths) {
    if (languageIds.size >= limit) break;
    const languageId = resolveCodeMirrorLanguageId(getLanguageIdFromPath(path));
    if (languageId) languageIds.add(languageId);
  }
  for (const languageId of languageIds) {
    await loadCodeMirrorLanguage(languageId);
  }
}
