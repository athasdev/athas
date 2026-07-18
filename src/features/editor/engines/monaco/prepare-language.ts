import { getLanguageIdFromPath } from "@/features/editor/utils/language-id";
import { ensureMonacoLanguageTokenizer } from "./language-contributions";
import { toMonacoLanguageId } from "./language";

export function prepareMonacoLanguageForPath(path: string): Promise<boolean> {
  return ensureMonacoLanguageTokenizer(toMonacoLanguageId(getLanguageIdFromPath(path)));
}
