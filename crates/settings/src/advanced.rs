//! Which rows a page keeps behind its "Advanced" disclosure, by setting key.
//!
//! The long pages had grown past what anyone reads: Editor was thirty-nine rows, Git twenty-six,
//! Terminal twenty. A row is advanced when it asks you to know how the editor works inside
//! (semantic tokens, globs, a meta key), or when it is a tuning knob nobody turns twice
//! (scrollback, max open tabs, a contrast ratio). Anything a person goes looking for — fonts,
//! saving, word wrap, line numbers, the safety confirmations — stays in sight.
//!
//! Hidden is not gone: the search finds these rows like any other and opens the disclosure on its
//! way to them (`SettingsView::open_result`).

use crate::SettingDef;

/// Keyed by setting key, not label: "Font Family", "Font Size", "Line Height" and "Cursor Style"
/// each name a row on two different pages.
const ADVANCED: &[&str] = &[
    // General > External Editor. Handing text files to `micro` or `vim`, with `$FILE` spliced
    // into a command line.
    "externalEditor",
    "customEditorCommand",
    // Editor > Display.
    "renderWhitespace",
    "editorRulers",
    "editorBracketPairColorization",
    "breadcrumbShowSymbols",
    // Only means anything with Vim mode on, and the row says so.
    "vimRelativeLineNumbers",
    // Editor > Cursor and Scrolling.
    "editorMultiCursorModifier",
    "editorSmoothScrolling",
    "editorScrollBeyondLastLine",
    // Editor > Tabs and Files.
    "maxOpenTabs",
    "horizontalTabScroll",
    "defaultLanguage",
    "autoDetectLanguage",
    // Editor > Language Features. Format on save, lint on save and completion stay in sight;
    // these four are the language server's own vocabulary.
    "parameterHints",
    "inlayHints",
    "codeLens",
    "semanticTokens",
    // Files > Display and Behavior.
    "fileTreeIndentSize",
    "compactFoldersInFileTree",
    "hideRootFolderInFileTree",
    "largeFileThresholdMB",
    // Files > Filters. Three comma-separated glob lists.
    "hiddenFilePatterns",
    "hiddenDirectoryPatterns",
    "searchExcludePatterns",
    // Git > Integration and Repository. Confirm Before Discard stays in sight: it is a guard,
    // not a knob.
    "autoRefreshGitStatus",
    "gitAutoFetchInterval",
    "gitPullRebase",
    "gitSignOffCommits",
    "gitDefaultBranchName",
    // Git > Git View. What the panel shows stays; how it arranges itself goes.
    "gitChangesFolderView",
    "compactGitStatusBadges",
        "rememberLastGitPanelMode",
    // Terminal > Typography.
    "terminalLetterSpacing",
    "terminalScrollback",
    "terminalMinimumContrastRatio",
    // Terminal > Interaction. The close guard stays in sight.
    "terminalAltClickMovesCursor",
    "terminalMacOptionIsMeta",
    "terminalRightClickSelectsWord",
    // Terminal > Rendering and Cursor.
    "terminalGpuAcceleration",
    "terminalCursorWidth",
    "terminalCursorInactiveStyle",
];

/// Whether the page keeps this row behind its "Advanced" disclosure.
pub fn is_advanced(def: &SettingDef) -> bool {
    def.key.is_some_and(|key| ADVANCED.contains(&key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SETTING_DEFS;

    #[test]
    fn every_advanced_key_names_a_row() {
        for key in ADVANCED {
            assert!(SETTING_DEFS.iter().any(|def| def.key == Some(*key)), "no row has the key {key}");
        }
    }

    #[test]
    fn a_page_keeps_more_than_it_hides() {
        // The disclosure is for the tail of a page, not for most of it. If a page ever tips over,
        // the rows it hides are the wrong ones.
        for (tab, _) in crate::SETTINGS_PAGES {
            let rows: Vec<&SettingDef> = SETTING_DEFS.iter().filter(|def| def.tab == *tab && def.key.is_some()).collect();
            let hidden = rows.iter().filter(|def| is_advanced(def)).count();
            assert!(hidden * 2 <= rows.len(), "{tab} hides {hidden} of {} rows", rows.len());
        }
    }

    #[test]
    fn what_people_go_looking_for_stays_in_sight() {
        let find = |label: &str| SETTING_DEFS.iter().find(|def| def.label == label).unwrap();
        for label in ["Font Size", "Word Wrap", "Line Numbers", "Auto Save", "Format on Save", "Tab Size", "Show Hidden Files"] {
            assert!(!is_advanced(find(label)), "{label} belongs in sight");
        }
        for label in ["Semantic Tokens", "Scrollback", "Max Open Tabs", "Hidden Files"] {
            assert!(is_advanced(find(label)), "{label} belongs under Advanced");
        }
    }
}
