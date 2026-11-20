//! The prompt to install a language extension when a file needs one that is not installed
//! (`use-extension-install-prompt.ts`): Install, then progress, success or an error with Retry.
//! Closing the prompt keeps it away for the rest of the session.

use std::{collections::HashSet, path::Path, rc::Rc, time::Duration};

use extensions::Extensions;
use gpui::{App, Global, SharedString};
use notifications::{NotificationAction, NotificationCategory, NotificationKind, ToastOptions};

#[derive(Default)]
struct InstallPrompts {
    dismissed: HashSet<String>,
}

impl Global for InstallPrompts {}

fn toast_id(extension_id: &str) -> SharedString {
    format!("extension-install-{extension_id}").into()
}

/// Offers to install the language extension `path` needs, once per extension and session.
pub fn prompt_for_path(path: &Path, cx: &mut App) {
    let Some((id, name)) = cx.try_global::<Extensions>().and_then(|extensions| extensions.extension_needing_install(path)) else {
        return;
    };
    prompt(id, name, cx);
}

fn prompt(id: String, name: String, cx: &mut App) {
    if cx.default_global::<InstallPrompts>().dismissed.contains(&id) {
        return;
    }
    let toast = toast_id(&id);
    if cx.try_global::<notifications::Notifications>().is_some_and(|store| store.has_toast(&toast)) {
        return;
    }
    let dismissed_id = id.clone();
    let on_dismiss: Rc<dyn Fn(&mut App)> = Rc::new(move |cx| {
        cx.default_global::<InstallPrompts>().dismissed.insert(dismissed_id.clone());
        telemetry::record_friction(cx, telemetry::FrictionSignal::new(telemetry::FrictionArea::Extensions, telemetry::FrictionKind::PromptDismissed));
    });
    let (install_id, install_name) = (id.clone(), name.clone());
    notifications::notify_with(
        cx,
        NotificationKind::Info,
        NotificationCategory::Athas,
        format!("{name} integration not installed. Install it to enable language support?"),
        None,
        Some(toast),
        ToastOptions {
            action: Some(NotificationAction::new("Install", move |_, cx| install(install_id.clone(), install_name.clone(), cx))),
            sticky: true,
            on_dismiss: Some(on_dismiss),
            ..Default::default()
        },
    );
}

fn install(id: String, name: String, cx: &mut App) {
    let toast = toast_id(&id);
    notifications::notify_with(
        cx,
        NotificationKind::Info,
        NotificationCategory::Athas,
        format!("Installing {name}..."),
        None,
        Some(toast.clone()),
        ToastOptions { sticky: true, ..Default::default() },
    );
    let task = extensions::install(&id, cx);
    cx.spawn(async move |cx| {
        let result = task.await;
        cx.update(|cx| match result {
            Ok(()) => {
                notifications::notify(cx, NotificationKind::Success, NotificationCategory::Athas, format!("{name} installed successfully!"), None, Some(toast.clone()));
                cx.spawn(async move |cx| {
                    cx.background_executor().timer(Duration::from_secs(3)).await;
                    cx.update(|cx| notifications::dismiss_toast(cx, &toast));
                })
                .detach();
            }
            Err(error) => {
                let (retry_id, retry_name) = (id.clone(), name.clone());
                notifications::notify_with(
                    cx,
                    NotificationKind::Error,
                    NotificationCategory::Athas,
                    format!("Failed to install {name}: {error:#}"),
                    None,
                    Some(toast),
                    ToastOptions {
                        action: Some(NotificationAction::new("Retry", move |_, cx| {
                            telemetry::record_friction(cx, telemetry::FrictionSignal::new(telemetry::FrictionArea::Extensions, telemetry::FrictionKind::Retry));
                            notifications::dismiss_toast(cx, &toast_id(&retry_id));
                            prompt(retry_id.clone(), retry_name.clone(), cx);
                        })),
                        sticky: true,
                        ..Default::default()
                    },
                );
            }
        });
    })
    .detach();
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;

    #[gpui::test]
    fn prompts_once_and_stays_away_after_closing(cx: &mut TestAppContext) {
        cx.update(|cx| {
            settings::init(cx, settings::Settings::default(), None);
            theme::init(cx, None, theme::Appearance::Dark, false);
            extensions::init_with(cx, None, None);
            let path = Path::new("/project/main.rs");
            prompt_for_path(path, cx);
            let toast = toast_id("athas.rust");
            let store = cx.global::<notifications::Notifications>();
            let notification = store.get(&toast).expect("a prompt for Rust");
            assert!(notification.sticky);
            assert_eq!(notification.action.as_ref().unwrap().label.as_ref(), "Install");
            assert!(notification.message.contains("Rust integration not installed"));

            notifications::close_toast(cx, &toast);
            assert!(!cx.global::<notifications::Notifications>().has_toast(&toast));
            prompt_for_path(path, cx);
            assert!(!cx.global::<notifications::Notifications>().has_toast(&toast), "closed prompts stay closed");

            prompt_for_path(Path::new("/project/notes.unknownext"), cx);
            assert_eq!(cx.global::<notifications::Notifications>().toasts().count(), 0);
        });
    }

    #[gpui::test]
    async fn install_replaces_the_prompt_with_the_result(cx: &mut TestAppContext) {
        cx.update(|cx| {
            settings::init(cx, settings::Settings::default(), None);
            theme::init(cx, None, theme::Appearance::Dark, false);
            extensions::init_with(cx, None, None);
            prompt_for_path(Path::new("/project/main.go"), cx);
        });
        let id = cx.update(|cx| {
            let store = cx.global::<notifications::Notifications>();
            store.toasts().next().unwrap().id.clone()
        });
        let id_string = id.to_string();
        let extension = id_string.trim_start_matches("extension-install-").to_string();
        cx.update(|cx| install(extension.clone(), "Go".into(), cx));
        cx.run_until_parked();
        cx.update(|cx| {
            let notification = cx.global::<notifications::Notifications>().get(&id).unwrap().clone();
            assert_eq!(notification.kind, NotificationKind::Success);
            assert!(cx.global::<Extensions>().status(&extension, settings::get(cx)).installed);
            assert!(cx.global::<Extensions>().extension_needing_install(Path::new("/project/main.go")).is_none());
        });
    }
}
