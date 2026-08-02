import { addComposerChild$, realmPlugin } from "@mdxeditor/editor";
import { MarkdownSlashCommands } from "../components/github-markdown-editor-controls";

export const githubMarkdownEditorPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, MarkdownSlashCommands);
  },
});
