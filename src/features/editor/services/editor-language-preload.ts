import { loadCodeMirrorLanguage } from "../engines/codemirror/languages";
import { getLanguageIdFromPath } from "./language-id";

/** Starts loading the editor language for `path`, so it is ready when the file's editor mounts. */
export function preloadEditorLanguageForPath(path: string) {
  return loadCodeMirrorLanguage(getLanguageIdFromPath(path));
}
