//! The command palette's database page (`database-command.tsx`): New Connection, the saved
//! connections and the database files found in the project. Picking one opens it in its own
//! database tab, which shows that one database.

use std::path::{Path, PathBuf};

use gpui::{AnyElement, App, AppContext as _, ClickEvent, Context, Entity, SharedString, Window, prelude::*};
use palette::{PaletteRow, Picker, PickerDelegate};
use ui::{Button, ButtonSize, ButtonTone, ButtonVariant, IconName};

use crate::{SavedConnection, connections, model::Provider};

/// The resource id a database tab opens with to show the New Connection form.
pub const NEW_CONNECTION_ID: &str = "new";

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Row {
    New,
    Saved(SavedConnection),
    Detected { path: PathBuf, relative: String, provider: Provider },
}

pub struct DatabaseConnectionsDelegate {
    store: Option<PathBuf>,
    saved: Vec<SavedConnection>,
    detected: Vec<(PathBuf, String, Provider)>,
    rows: Vec<Row>,
    selected: usize,
}

/// `describeConnection`: the file's name, or the server and database.
fn describe(connection: &SavedConnection) -> String {
    if connection.provider.is_file_based() {
        return Path::new(&connection.file_path)
            .file_name()
            .map_or_else(|| connection.provider.label().to_string(), |name| name.to_string_lossy().into_owned());
    }
    let database = if connection.database.is_empty() { String::new() } else { format!(" / {}", connection.database) };
    format!("{} {}:{}{database}", connection.provider.label(), connection.host, connection.port)
}

fn matches(query: &str, values: &[&str]) -> bool {
    query.is_empty() || values.iter().any(|value| value.to_lowercase().contains(query))
}

/// The database files under `root` (`getWorkspaceDatabaseFiles`), skipping hidden folders and
/// dependency and build output, a few levels deep.
pub fn workspace_database_files(root: &Path) -> Vec<(PathBuf, String, Provider)> {
    const SKIP: &[&str] = &["node_modules", "target", "dist", "build", "vendor", "__pycache__"];
    let mut found = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut visited = 0usize;
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            visited += 1;
            if visited > 20_000 {
                return found;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                if depth < 5 && !name.starts_with('.') && !SKIP.contains(&name.as_str()) {
                    stack.push((path, depth + 1));
                }
            } else if let Some(provider) = path.to_str().and_then(Provider::for_file) {
                let relative = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().into_owned();
                found.push((path, relative, provider));
            }
        }
    }
    found.sort_by(|a, b| a.1.cmp(&b.1));
    found
}

impl DatabaseConnectionsDelegate {
    pub fn new(project_root: Option<&Path>) -> Self {
        let store = connections::default_store_path();
        let saved = store.as_deref().map(connections::load).unwrap_or_default();
        let detected = project_root.map(workspace_database_files).unwrap_or_default();
        let mut delegate = Self { store, saved, detected, rows: Vec::new(), selected: 0 };
        delegate.filter("");
        delegate
    }

    #[cfg(test)]
    pub(crate) fn with(saved: Vec<SavedConnection>, detected: Vec<(PathBuf, String, Provider)>) -> Self {
        let mut delegate = Self { store: None, saved, detected, rows: Vec::new(), selected: 0 };
        delegate.filter("");
        delegate
    }

    #[cfg(test)]
    pub(crate) fn rows(&self) -> &[Row] {
        &self.rows
    }

    fn filter(&mut self, query: &str) {
        let query = query.trim().to_lowercase();
        let saved_files: Vec<&str> = self.saved.iter().filter(|saved| saved.provider.is_file_based()).map(|saved| saved.file_path.as_str()).collect();
        let mut rows = Vec::new();
        if matches(&query, &["new connection", "add database"]) {
            rows.push(Row::New);
        }
        rows.extend(
            self.saved
                .iter()
                .filter(|saved| matches(&query, &[&saved.name, &describe(saved)]))
                .cloned()
                .map(Row::Saved),
        );
        rows.extend(
            self.detected
                .iter()
                .filter(|(path, _, _)| !saved_files.contains(&path.to_string_lossy().as_ref()))
                .filter(|(path, relative, provider)| {
                    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                    matches(&query, &[&name, relative, provider.label()])
                })
                .map(|(path, relative, provider)| Row::Detected { path: path.clone(), relative: relative.clone(), provider: *provider }),
        );
        self.rows = rows;
        self.selected = self.selected.min(self.rows.len().saturating_sub(1));
    }

    fn remove(&mut self, id: &str) {
        self.saved.retain(|saved| saved.id != id);
        connections::delete_password(id);
        if let Some(store) = self.store.as_deref() {
            connections::save(store, &self.saved).ok();
        }
    }
}

/// Opens the page; the host shows it as a modal.
pub fn connections_picker(project_root: Option<&Path>, window: &mut Window, cx: &mut App) -> Entity<Picker<DatabaseConnectionsDelegate>> {
    let delegate = DatabaseConnectionsDelegate::new(project_root);
    cx.new(|cx| Picker::new(delegate, window, cx))
}

impl PickerDelegate for DatabaseConnectionsDelegate {
    fn placeholder(&self) -> SharedString {
        "Open a database".into()
    }

    fn match_count(&self) -> usize {
        self.rows.len()
    }

    fn selected_index(&self) -> usize {
        self.selected
    }

    fn set_selected_index(&mut self, index: usize, _: &mut Context<Picker<Self>>) {
        self.selected = index;
    }

    fn update_matches(&mut self, query: &str, _: &mut Window, _: &mut Context<Picker<Self>>) {
        self.selected = 0;
        self.filter(query);
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, cx: &mut Context<Picker<Self>>) -> AnyElement {
        match &self.rows[index] {
            Row::New => PaletteRow::new("New Connection…")
                .icon(IconName::Plus)
                .description("Connect to a database server or open a database file")
                .selected(selected)
                .into_any_element(),
            Row::Saved(connection) => {
                let picker = cx.entity().downgrade();
                let id = connection.id.clone();
                PaletteRow::new(connection.name.clone())
                    .icon(if connection.provider.is_file_based() { IconName::Database } else { IconName::HardDrives })
                    .description(describe(connection))
                    .accessory(
                        Button::icon(SharedString::from(format!("remove-connection-{}", connection.id)), IconName::Trash)
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::XSmall)
                            .tone(ButtonTone::Danger)
                            .tooltip("Remove Connection")
                            .on_click(move |_: &ClickEvent, window, cx| {
                                cx.stop_propagation();
                                picker
                                    .update(cx, |picker, cx| {
                                        picker.delegate.remove(&id);
                                        picker.refresh_matches(window, cx);
                                    })
                                    .ok();
                            }),
                    )
                    .selected(selected)
                    .into_any_element()
            }
            Row::Detected { path, relative, .. } => PaletteRow::new(path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default())
                .icon(IconName::Database)
                .description(relative.clone())
                .selected(selected)
                .into_any_element(),
        }
    }

    fn confirm(&mut self, index: usize, _: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        match self.rows.get(index).cloned() {
            Some(Row::New) => workbench_api::open_resource(cx, "database", NEW_CONNECTION_ID, "New Connection"),
            Some(Row::Saved(connection)) if connection.provider.is_file_based() => workbench_api::open_file(cx, connection.file_path.clone(), None),
            Some(Row::Saved(connection)) => workbench_api::open_resource(cx, "database", &connection.id, &connection.name),
            Some(Row::Detected { path, .. }) => workbench_api::open_file(cx, path, None),
            None => return false,
        }
        true
    }

    fn empty_message(&self) -> SharedString {
        "No databases found".into()
    }

    fn leading_icon(&self) -> IconName {
        IconName::Database
    }
}
