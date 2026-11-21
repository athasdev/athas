//! How the palette words a command (`palette.label` on the original's commands): the area it
//! belongs to before its name, as "View: Split Editor Right".

/// The labels the original's commands give the palette where they differ from the title.
const LABELS: &[(&str, &str)] = &[
    ("ai.keepAgentHunk", "AI: Keep Agent Change"),
    ("ai.rejectAgentHunk", "AI: Undo Agent Change"),
    ("browser.newTab", "Browser: New Browser Tab"),
    ("browser.openUrl", "Browser: Open URL..."),
    ("editor.addSelectionToChat", "AI: Add Selection to Agent Chat"),
    ("editor.addSelectionToNewChat", "AI: Add Selection to New Agent Chat"),
    ("file.save", "File: Save"),
    ("file.saveAs", "File: Save As"),
    ("file.saveAll", "File: Save All"),
    ("file.close", "Tab: Close Tab"),
    ("file.reopenClosed", "Tab: Reopen Closed Tab"),
    ("file.new", "File: New File"),
    ("file.open", "File: Open Project"),
    ("file.openFolder", "File: Open Folder"),
    ("file.quickOpen", "Go: Quick Open"),
    ("file.localHistory", "File: Show Local History"),
    ("workbench.nextTab", "Tab: Next Tab"),
    ("workbench.previousTab", "Tab: Previous Tab"),
    ("workbench.toggleActivePaneFullscreen", "View: Toggle Active Pane Full Screen"),
    ("workbench.splitEditorRight", "View: Split Editor Right"),
    ("workbench.splitEditorDown", "View: Split Editor Down"),
    ("workbench.closeEditorGroup", "View: Close Editor Group"),
    ("workbench.closeOtherEditorGroups", "View: Close Other Editor Groups"),
    ("workbench.moveEditorToNextGroup", "View: Move Editor Into Next Group"),
    ("workbench.moveEditorToPreviousGroup", "View: Move Editor Into Previous Group"),
    ("workbench.resetEditorGroupSizes", "View: Reset Editor Group Sizes"),
    ("workbench.toggleEditorGroupLock", "View: Toggle Editor Group Lock"),
    ("preview.shareLocalServer", "Preview: Share Local Server"),
    ("terminal.new", "Terminal: New Terminal"),
    ("terminal.find", "Terminal: Find"),
    ("terminal.split", "Terminal: Split Right"),
    ("terminal.splitDown", "Terminal: Split Down"),
    ("terminal.previousCommand", "Terminal: Scroll to Previous Command"),
    ("terminal.nextCommand", "Terminal: Scroll to Next Command"),
    ("terminal.unsplit", "Terminal: Unsplit"),
    ("terminal.focusNextPane", "Terminal: Focus Next Pane"),
    ("terminal.focusPreviousPane", "Terminal: Focus Previous Pane"),
    ("terminal.clear", "Terminal: Clear"),
    ("terminal.selectAll", "Terminal: Select All"),
    ("terminal.copyLastCommandOutput", "Terminal: Copy Last Command Output"),
    ("workbench.toggleDock", "View: Toggle Dock"),
    ("workbench.toggleDiagnostics", "View: Show Diagnostics"),
    ("workbench.agentLauncher", "AI: New Agent"),
    ("workbench.showFind", "View: Find"),
    ("workbench.showGlobalSearch", "Search: Global Search"),
    ("workbench.openGlobalSearchInTab", "Search: Open Search in a Tab"),
    ("help.showWhatsNew", "Help: What's New"),
    ("workbench.zoomIn", "View: Zoom In"),
    ("workbench.zoomOut", "View: Zoom Out"),
    ("workbench.zoomReset", "View: Reset Zoom"),
    ("docker.open", "Docker: Open Docker…"),
    ("team.open", "Team: Open Team"),
    ("team.shareSession", "Team: Share Session with Team"),
    ("team.stopSharingSession", "Team: Stop Sharing Session"),
    ("team.handOffSession", "Team: Hand Off Session…"),
    ("team.requestReview", "Team: Request Review…"),
    ("workbench.openSettings", "Preferences: Open Settings"),
    ("window.toggleFullscreen", "Window: Toggle Fullscreen"),
    ("window.minimize", "Window: Minimize"),
];

/// The palette label the command `id` has where it differs from its title.
pub fn palette_label(id: &str) -> Option<&'static str> {
    LABELS.iter().find(|(command, _)| *command == id).map(|(_, label)| *label)
}

/// `label` led by its area, as every palette row is: "View: Hide Sidebar". A label that already
/// names one is kept.
pub fn with_category(label: &str, category: &str) -> String {
    if category.is_empty() || label.contains(": ") {
        label.to_string()
    } else {
        format!("{category}: {label}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_lead_with_their_area() {
        assert_eq!(palette_label("workbench.splitEditorRight"), Some("View: Split Editor Right"));
        assert_eq!(palette_label("file.quickOpen"), Some("Go: Quick Open"));
        assert_eq!(palette_label("unknown"), None);
        assert_eq!(with_category("Toggle Terminal", "View"), "View: Toggle Terminal");
        assert_eq!(with_category("File: Save", "File"), "File: Save");
        assert_eq!(with_category("Save", ""), "Save");
    }
}
