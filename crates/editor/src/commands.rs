//! The editor's Athas commands by id (`editor.*`, `lsp.*`, find, save, zoom), and the ones that
//! act on the whole app: line numbers, whitespace, zoom and the language servers.

use gpui::{App, Global, actions};
use lsp_client::LspStore;
use notifications::{NotificationCategory, NotificationKind};

use crate::*;

actions!(
    editor,
    [
        SelectPreviousOccurrence,
        RemoveSecondaryCursors,
        FormatSelection,
        SelectToBracket,
        RemoveBrackets,
        JumpToSelection,
        ToggleLineNumbers,
        ToggleRenderWhitespace,
        ZoomIn,
        ZoomOut,
        ResetZoom,
        RestartLanguageServers,
        StopLanguageServers,
        ShowLanguageServerStatus,
        ShowCallHierarchy,
        ShowTypeHierarchy,
        PeekReferences,
        OrganizeJavaImports,
        RefreshJavaProject,
    ]
);

/// The terminal command that opens `path` in the external editor the settings name
/// (`externalEditor`, `customEditorCommand`), with the path relative to the project root; `None`
/// when files open in the built-in editor.
pub fn external_editor_command(settings: &settings::Settings, path: &std::path::Path, root: Option<&std::path::Path>) -> Option<String> {
    let relative = match root.and_then(|root| path.strip_prefix(root).ok()) {
        Some(rest) => std::path::Path::new(".").join(rest),
        None => path.to_path_buf(),
    };
    let quoted = format!("\"{}\"", relative.display());
    match settings.external_editor.as_str() {
        "nvim" => Some(format!("nvim {quoted}")),
        "helix" => Some(format!("hx {quoted}")),
        "vim" => Some(format!("vim {quoted}")),
        "custom" if !settings.custom_editor_command.trim().is_empty() => Some(settings.custom_editor_command.replace("$FILE", &quoted)),
        _ => None,
    }
}

struct Registered;

impl Global for Registered {}

/// Registers the command ids and the app-wide handlers once.
pub(crate) fn register(cx: &mut App) {
    if cx.has_global::<Registered>() {
        return;
    }
    cx.set_global(Registered);
    keymap::register(cx, "editor.selectAll", SelectAll);
    keymap::register(cx, "editor.undo", Undo);
    keymap::register(cx, "editor.redo", Redo);
    keymap::register(cx, "editor.copy", Copy);
    keymap::register(cx, "editor.cut", Cut);
    keymap::register(cx, "editor.paste", Paste);
    keymap::register(cx, "editor.selectNextOccurrence", SelectNextOccurrence);
    keymap::register(cx, "editor.selectPreviousOccurrence", SelectPreviousOccurrence);
    keymap::register(cx, "editor.selectAllOccurrences", SelectAllOccurrences);
    keymap::register(cx, "editor.duplicateLine", CopyLineDown);
    keymap::register(cx, "editor.deleteLine", DeleteLine);
    keymap::register(cx, "editor.toggleComment", ToggleComment);
    keymap::register(cx, "editor.foldAll", FoldAll);
    keymap::register(cx, "editor.unfoldAll", UnfoldAll);
    keymap::register(cx, "editor.foldLevel1", FoldLevel1);
    keymap::register(cx, "editor.foldLevel2", FoldLevel2);
    keymap::register(cx, "editor.foldLevel3", FoldLevel3);
    keymap::register(cx, "editor.foldLevel4", FoldLevel4);
    keymap::register(cx, "editor.foldLevel5", FoldLevel5);
    keymap::register(cx, "editor.foldLevel6", FoldLevel6);
    keymap::register(cx, "editor.foldLevel7", FoldLevel7);
    keymap::register(cx, "editor.moveLineUp", MoveLineUp);
    keymap::register(cx, "editor.moveLineDown", MoveLineDown);
    keymap::register(cx, "editor.copyLineUp", CopyLineUp);
    keymap::register(cx, "editor.copyLineDown", CopyLineDown);
    keymap::register(cx, "editor.insertCursorAbove", AddCursorAbove);
    keymap::register(cx, "editor.insertCursorBelow", AddCursorBelow);
    keymap::register(cx, "editor.insertCursorsAtLineEnds", CursorsAtLineEnds);
    keymap::register(cx, "editor.removeSecondaryCursors", RemoveSecondaryCursors);
    keymap::register(cx, "editor.formatDocument", FormatDocument);
    keymap::register(cx, "editor.formatSelection", FormatSelection);
    keymap::register(cx, "editor.triggerSuggest", ShowCompletions);
    keymap::register(cx, "editor.triggerParameterHints", ShowSignatureHelp);
    keymap::register(cx, "editor.showHover", ShowHover);
    keymap::register(cx, "editor.quickFix", CodeActions);
    keymap::register(cx, "editor.goToDefinition", GoToDefinition);
    keymap::register(cx, "editor.goToImplementation", GoToImplementation);
    keymap::register(cx, "editor.goToTypeDefinition", GoToTypeDefinition);
    keymap::register(cx, "editor.goToReferences", FindReferences);
    keymap::register(cx, "editor.peekReferences", PeekReferences);
    keymap::register(cx, "editor.showCallHierarchy", ShowCallHierarchy);
    keymap::register(cx, "editor.showTypeHierarchy", ShowTypeHierarchy);
    keymap::register(cx, "editor.goToBracket", GoToBracket);
    keymap::register(cx, "editor.selectToBracket", SelectToBracket);
    keymap::register(cx, "editor.removeBrackets", RemoveBrackets);
    keymap::register(cx, "editor.expandSelection", SelectLargerSyntaxNode);
    keymap::register(cx, "editor.shrinkSelection", SelectSmallerSyntaxNode);
    keymap::register(cx, "editor.renameSymbol", Rename);
    keymap::register(cx, "editor.findNext", FindNext);
    keymap::register(cx, "editor.findPrevious", FindPrevious);
    keymap::register(cx, "editor.useSelectionForFind", UseSelectionForFind);
    keymap::register(cx, "editor.jumpToSelection", JumpToSelection);
    keymap::register(cx, "editor.toggleWordWrap", ToggleWordWrap);
    keymap::register(cx, "editor.toggleLineNumbers", ToggleLineNumbers);
    keymap::register(cx, "editor.toggleRenderWhitespace", ToggleRenderWhitespace);
    keymap::register(cx, "markdown.togglePreview", ToggleMarkdownPreview);
    keymap::register(cx, "workbench.showFind", Find);
    keymap::register(cx, "workbench.showFindReplace", FindReplace);
    keymap::register(cx, "file.save", Save);
    keymap::register(cx, "file.saveAs", SaveAs);
    keymap::register(cx, "workbench.zoomIn", ZoomIn);
    keymap::register(cx, "workbench.zoomOut", ZoomOut);
    keymap::register(cx, "workbench.zoomReset", ResetZoom);
    keymap::register(cx, "lsp.restartAllServers", RestartLanguageServers);
    keymap::register(cx, "lsp.stopAllServers", StopLanguageServers);
    keymap::register(cx, "lsp.showStatus", ShowLanguageServerStatus);
    keymap::register(cx, "java.organizeImports", OrganizeJavaImports);
    keymap::register(cx, "java.refreshProject", RefreshJavaProject);

    // Command keys bind after the editor's own; vim's keys (ctrl-d, ctrl-c, …) must still win.
    cx.observe_global::<keymap::ActiveKeymap>(crate::vim::bind_keys).detach();
    cx.on_action(|_: &ToggleLineNumbers, cx| settings::update(cx, |settings| settings.line_numbers = !settings.line_numbers));
    cx.on_action(|_: &ToggleRenderWhitespace, cx| {
        settings::update(cx, |settings| {
            settings.render_whitespace = if settings.render_whitespace == "none" { "all".into() } else { "none".into() };
        })
    });
    cx.on_action(|_: &RestartLanguageServers, cx| LspStore::global(cx).update(cx, |store, cx| store.restart_all(cx)));
    cx.on_action(|_: &StopLanguageServers, cx| LspStore::global(cx).update(cx, |store, cx| store.stop_all(cx)));
    cx.on_action(|_: &OrganizeJavaImports, cx| {
        run_java_command(cx, "java.edit.organizeImports", true, "Open a Java file to organize imports.", "Java imports organized.", "Failed to organize Java imports.")
    });
    cx.on_action(|_: &RefreshJavaProject, cx| {
        run_java_command(cx, "java.project.import", false, "Open a Java file to refresh its project.", "Java project refreshed.", "Failed to refresh the Java project.")
    });
    cx.on_action(|_: &ShowLanguageServerStatus, cx| {
        let (title, description) = LspStore::global(cx).read(cx).status_summary();
        notifications::notify(cx, NotificationKind::Info, NotificationCategory::Athas, title, Some(description.into()), Some("lsp-status".into()));
    });
}

fn is_java(path: &std::path::Path) -> bool {
    path.extension().is_some_and(|extension| extension == "java")
}

/// The Java file in front, else any open Java tab (`getActiveJavaFilePath`).
fn active_java_file(cx: &App) -> Option<std::path::PathBuf> {
    workbench_api::active_file(cx)
        .filter(|path| is_java(path))
        .or_else(|| workbench_api::open_tabs(cx).into_iter().filter_map(|tab| tab.path).find(|path| is_java(path)))
}

/// `java.organizeImports` / `java.refreshProject`: a jdtls `workspace/executeCommand` for the
/// active Java file, with the returned edit applied.
fn run_java_command(cx: &mut App, command: &'static str, with_uri: bool, missing: &'static str, done: &'static str, failed: &'static str) {
    let Some(path) = active_java_file(cx) else {
        notifications::notify(cx, NotificationKind::Info, NotificationCategory::Athas, missing, None, None);
        return;
    };
    let arguments = if with_uri { lsp_client::uri::from_path(&path).map(|uri| vec![serde_json::Value::String(uri.to_string())]).unwrap_or_default() } else { Vec::new() };
    let task = LspStore::global(cx).update(cx, |store, cx| store.execute_command(&path, command, arguments, cx));
    cx.spawn(async move |cx| {
        let result = task.await;
        cx.update(|cx| match result {
            Ok(_) => {
                notifications::notify(cx, NotificationKind::Success, NotificationCategory::Athas, done, None, None);
            }
            Err(error) => {
                let message = error.to_string();
                notifications::notify(cx, NotificationKind::Error, NotificationCategory::Athas, if message.is_empty() { failed.to_string() } else { message }, None, None);
            }
        })
    })
    .detach();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_editor_commands_use_the_relative_path() {
        let mut settings = settings::Settings::default();
        let path = std::path::Path::new("/p/src/main.rs");
        let root = Some(std::path::Path::new("/p"));
        assert_eq!(external_editor_command(&settings, path, root), None);
        settings.external_editor = "helix".into();
        assert_eq!(external_editor_command(&settings, path, root).unwrap(), "hx \"./src/main.rs\"");
        settings.external_editor = "custom".into();
        assert_eq!(external_editor_command(&settings, path, root), None);
        settings.custom_editor_command = "emacs -nw $FILE".into();
        assert_eq!(external_editor_command(&settings, path, None).unwrap(), "emacs -nw \"/p/src/main.rs\"");
    }

}
