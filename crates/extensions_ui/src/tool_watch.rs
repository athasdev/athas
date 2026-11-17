//! Language tool installs outside the extension page: a missing language server installs its
//! extension's tools (the old app's repair), progress and results show as notifications, and
//! files without a server look for it again once tools are installed.

use std::{cell::RefCell, collections::HashMap, rc::Rc};

use extensions::{Extensions, ToolState, ToolStatuses};
use gpui::{App, SharedString};
use notifications::{NotificationCategory, NotificationKind};

#[derive(Default)]
struct Watch {
    generation: u64,
    seen: HashMap<String, ToolStatuses>,
}

pub(crate) fn init(cx: &mut App) {
    lsp_client::on_missing_server(cx, |server, cx| {
        let Some(id) = cx.try_global::<Extensions>().and_then(|extensions| extensions.extension_for_server(server)) else {
            return;
        };
        if let Some(task) = extensions::repair_tools(&id, cx) {
            task.detach();
        }
    });
    let watch = Rc::new(RefCell::new(Watch::default()));
    cx.observe_global::<Extensions>(move |cx| changed(&watch, cx)).detach();
}

fn changed(watch: &Rc<RefCell<Watch>>, cx: &mut App) {
    let extensions = extensions::get(cx);
    let generation = extensions.tools_generation();
    let mut messages = Vec::new();
    let mut watch = watch.borrow_mut();
    for (id, statuses) in extensions.tracked_tools() {
        let previous = watch.seen.get(id);
        if previous == Some(statuses) {
            continue;
        }
        let name = extensions.entry(id).map_or_else(|| id.to_string(), |entry| entry.manifest.display_name.clone());
        if let Some(message) = message_for(&name, previous, statuses) {
            messages.push((format!("extension-tools-{id}"), message));
        }
        watch.seen.insert(id.to_string(), statuses.clone());
    }
    let installed = watch.generation != generation;
    watch.generation = generation;
    drop(watch);
    if installed && let Some(store) = lsp_client::LspStore::try_global(cx) {
        store.update(cx, |store, cx| store.retry_unavailable(cx));
    }
    for (id, (kind, message, description)) in messages {
        notifications::notify(cx, kind, NotificationCategory::Athas, message, description, Some(id.into()));
    }
}

/// What to tell the user when an extension's tools change: the start of an install, its
/// progress in tenths, and how it ended.
fn message_for(
    name: &str,
    previous: Option<&ToolStatuses>,
    current: &ToolStatuses,
) -> Option<(NotificationKind, String, Option<SharedString>)> {
    let was_installing = previous.is_some_and(ToolStatuses::is_installing);
    if current.is_installing() {
        let (kind, fraction) = current.iter().find_map(|(kind, state)| match state {
            ToolState::Installing(fraction) => Some((kind, *fraction)),
            _ => None,
        })?;
        let tenth = |statuses: &ToolStatuses| {
            statuses.get(kind).and_then(|state| match state {
                ToolState::Installing(fraction) => Some((fraction * 10.).floor() as u32),
                _ => None,
            })
        };
        if was_installing && previous.and_then(tenth) == tenth(current) {
            return None;
        }
        let detail = if fraction > 0. { format!("{} {}%", kind.label(), (fraction * 100.).round() as u32) } else { kind.label().to_string() };
        return Some((NotificationKind::Info, format!("Installing {name} tools"), Some(detail.into())));
    }
    if !was_installing {
        return None;
    }
    Some(match current.issue() {
        Some((kind, message)) => (NotificationKind::Error, format!("{name}: the {} could not be installed", kind.label().to_lowercase()), Some(message)),
        None => (NotificationKind::Success, format!("{name} tools installed"), None),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn statuses(lsp: ToolState, formatter: Option<ToolState>) -> ToolStatuses {
        ToolStatuses { lsp: Some(lsp), formatter, linter: None }
    }

    #[test]
    fn messages_follow_an_install() {
        let start = statuses(ToolState::Installing(0.), Some(ToolState::Installing(0.)));
        let (kind, message, detail) = message_for("Rust", None, &start).unwrap();
        assert_eq!((kind, message.as_str()), (NotificationKind::Info, "Installing Rust tools"));
        assert_eq!(detail.unwrap().as_ref(), "Language server");

        let tick = statuses(ToolState::Installing(0.04), Some(ToolState::Installing(0.)));
        assert!(message_for("Rust", Some(&start), &tick).is_none(), "progress shows in tenths");
        let half = statuses(ToolState::Installing(0.5), Some(ToolState::Installing(0.)));
        assert_eq!(message_for("Rust", Some(&tick), &half).unwrap().2.unwrap().as_ref(), "Language server 50%");

        let done = statuses(ToolState::Installed, Some(ToolState::Installed));
        assert_eq!(message_for("Rust", Some(&half), &done).unwrap().0, NotificationKind::Success);
        let failed = statuses(ToolState::Installed, Some(ToolState::Failed("HTTP 404".into())));
        let (kind, message, detail) = message_for("Rust", Some(&half), &failed).unwrap();
        assert_eq!(kind, NotificationKind::Error);
        assert_eq!(message, "Rust: the formatter could not be installed");
        assert_eq!(detail.unwrap().as_ref(), "HTTP 404");

        assert!(message_for("Rust", None, &done).is_none(), "a status check is not news");
    }
}
