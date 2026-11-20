//! Notifications (`features/notifications`): what the app reports — a save that failed, an agent
//! that finished — kept in a short history behind the bell, and shown as a toast when it arrives.

use std::rc::Rc;

#[cfg(target_os = "macos")]
mod native;
mod inbox;

pub use inbox::{INBOX_WIDTH, InboxPanel};

use gpui::{AnyElement, App, ClipboardItem, Context, Global, SharedString, Window, div, prelude::*, px};
use palette::{Picker, PickerDelegate, PaletteRow};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, WithScrollbar, typography};
use workspace::{now_ms, relative_time};

/// The history keeps this many, newest first, as the web workbench does.
const MAX_NOTIFICATIONS: usize = 20;
/// How long a toast stays before it fades.
pub const TOAST_MS: u64 = 4000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationKind {
    Success,
    Warning,
    Error,
    Info,
}

impl NotificationKind {
    fn icon(self) -> IconName {
        match self {
            NotificationKind::Success => IconName::Check,
            NotificationKind::Warning => IconName::WarningCircle,
            NotificationKind::Error => IconName::Xcircle,
            NotificationKind::Info => IconName::Info,
        }
    }
}

/// Who a notification comes from, for the tabs of the list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationCategory {
    Athas,
    Agent,
    GitHub,
}

/// A button on a toast (`showToast({ action })`).
#[derive(Clone)]
pub struct NotificationAction {
    pub label: SharedString,
    pub handler: Rc<dyn Fn(&mut Window, &mut App)>,
}

impl NotificationAction {
    pub fn new(label: impl Into<SharedString>, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        Self { label: label.into(), handler: Rc::new(handler) }
    }
}

impl std::fmt::Debug for NotificationAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NotificationAction").field("label", &self.label).finish()
    }
}

#[derive(Clone)]
pub struct Notification {
    pub id: SharedString,
    pub message: SharedString,
    pub description: Option<SharedString>,
    pub kind: NotificationKind,
    pub category: NotificationCategory,
    pub created_at: u64,
    pub read: bool,
    pub action: Option<NotificationAction>,
    /// A quieter second button beside `action`, such as Cancel or another way to fix it.
    pub secondary_action: Option<NotificationAction>,
    /// Stays until closed (`duration: 0`) instead of fading.
    pub sticky: bool,
    /// Runs when the user closes the toast.
    pub on_dismiss: Option<Rc<dyn Fn(&mut App)>>,
}

impl std::fmt::Debug for Notification {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Notification")
            .field("id", &self.id)
            .field("message", &self.message)
            .field("kind", &self.kind)
            .field("action", &self.action)
            .field("sticky", &self.sticky)
            .finish()
    }
}

/// What a toast offers beyond its message.
#[derive(Default)]
pub struct ToastOptions {
    pub action: Option<NotificationAction>,
    pub secondary_action: Option<NotificationAction>,
    pub sticky: bool,
    pub on_dismiss: Option<Rc<dyn Fn(&mut App)>>,
}

#[derive(Default)]
pub struct Notifications {
    items: Vec<Notification>,
    /// Ids of notifications shown as toasts right now.
    toasts: Vec<SharedString>,
    next_id: u64,
    /// Sources still fetching their first list, such as the GitHub inbox: the Inbox shows them
    /// loading instead of empty.
    loading: Vec<NotificationCategory>,
}

impl Global for Notifications {}

/// Whether the pointer is over the toasts: the stack spreads out to show every toast, as
/// Sonner's does, and folds back behind the newest when it leaves.
#[derive(Default)]
pub struct ToastStackHover(pub bool);

impl Global for ToastStackHover {}

impl Notifications {
    pub fn items(&self) -> &[Notification] {
        &self.items
    }

    pub fn unread(&self) -> usize {
        self.items.iter().filter(|item| !item.read).count()
    }

    pub fn toasts(&self) -> impl Iterator<Item = &Notification> {
        self.toasts.iter().filter_map(|id| self.items.iter().find(|item| item.id == *id))
    }

    pub fn has_toast(&self, id: &str) -> bool {
        self.toasts.iter().any(|toast| toast.as_ref() == id)
    }

    /// Whether `category` (any, for `None`) is still fetching its first list.
    pub fn is_loading(&self, category: Option<NotificationCategory>) -> bool {
        self.loading.iter().any(|loading| category.is_none_or(|category| category == *loading))
    }

    pub fn get(&self, id: &str) -> Option<&Notification> {
        self.items.iter().find(|item| item.id.as_ref() == id)
    }
}

/// Records a notification and shows it as a toast. A notification with the id of an earlier one
/// replaces it, as a progress message that later succeeds does.
pub fn notify(
    cx: &mut App,
    kind: NotificationKind,
    category: NotificationCategory,
    message: impl Into<SharedString>,
    description: Option<SharedString>,
    id: Option<SharedString>,
) -> SharedString {
    notify_with(cx, kind, category, message, description, id, ToastOptions::default())
}

/// [`notify`] with a button, or a toast that stays until it is closed.
pub fn notify_with(
    cx: &mut App,
    kind: NotificationKind,
    category: NotificationCategory,
    message: impl Into<SharedString>,
    description: Option<SharedString>,
    id: Option<SharedString>,
    options: ToastOptions,
) -> SharedString {
    let store = cx.default_global::<Notifications>();
    let id = id.unwrap_or_else(|| {
        store.next_id += 1;
        format!("notification-{}", store.next_id).into()
    });
    store.items.retain(|item| item.id != id);
    store.items.insert(
        0,
        Notification {
            id: id.clone(),
            message: message.into(),
            description,
            kind,
            category,
            created_at: now_ms(),
            read: false,
            action: options.action,
            secondary_action: options.secondary_action,
            sticky: options.sticky,
            on_dismiss: options.on_dismiss,
        },
    );
    store.items.truncate(MAX_NOTIFICATIONS);
    store.toasts.retain(|toast| *toast != id);
    store.toasts.push(id.clone());
    if store.toasts.len() > 3 {
        store.toasts.remove(0);
    }
    id
}

/// Keeps a notification in the history without a toast, such as an item of a GitHub inbox.
/// One with the id of an earlier one replaces it where it is.
pub fn record(
    cx: &mut App,
    kind: NotificationKind,
    category: NotificationCategory,
    message: impl Into<SharedString>,
    description: Option<SharedString>,
    id: SharedString,
    action: Option<NotificationAction>,
) {
    let store = cx.default_global::<Notifications>();
    let notification = Notification {
        id: id.clone(),
        message: message.into(),
        description,
        kind,
        category,
        created_at: now_ms(),
        read: false,
        action,
        secondary_action: None,
        sticky: false,
        on_dismiss: None,
    };
    match store.items.iter_mut().find(|item| item.id == id) {
        Some(existing) => *existing = Notification { read: existing.read, created_at: existing.created_at, ..notification },
        None => {
            store.items.insert(0, notification);
            store.items.truncate(MAX_NOTIFICATIONS);
        }
    }
}

pub fn info(cx: &mut App, message: impl Into<SharedString>) -> SharedString {
    notify(cx, NotificationKind::Info, NotificationCategory::Athas, message, None, None)
}

pub fn error(cx: &mut App, message: impl Into<SharedString>, description: Option<SharedString>) -> SharedString {
    notify(cx, NotificationKind::Error, NotificationCategory::Athas, message, description, None)
}

pub fn dismiss_toast(cx: &mut App, id: &SharedString) {
    cx.default_global::<Notifications>().toasts.retain(|toast| toast != id);
}

/// The user closed the toast: puts it away and tells whoever asked (`toast:dismissed`).
pub fn close_toast(cx: &mut App, id: &SharedString) {
    let on_dismiss = cx.default_global::<Notifications>().items.iter().find(|item| item.id == *id).and_then(|item| item.on_dismiss.clone());
    dismiss_toast(cx, id);
    if let Some(on_dismiss) = on_dismiss {
        on_dismiss(cx);
    }
}

/// Marks `category` as fetching its first list, or done.
pub fn set_loading(cx: &mut App, category: NotificationCategory, loading: bool) {
    if cx.try_global::<Notifications>().is_some_and(|store| store.loading.contains(&category) == loading) {
        return;
    }
    let store = cx.default_global::<Notifications>();
    store.loading.retain(|item| *item != category);
    if loading {
        store.loading.push(category);
    }
}

pub fn mark_all_read(cx: &mut App) {
    for item in &mut cx.default_global::<Notifications>().items {
        item.read = true;
    }
}

pub fn clear(cx: &mut App) {
    let store = cx.default_global::<Notifications>();
    store.items.clear();
    store.toasts.clear();
}

/// Minutes after midnight of `HH:MM`.
fn minutes_of(time: &str) -> Option<u32> {
    settings::is_time_of_day(time).then(|| {
        let (hours, minutes) = time.split_once(':').unwrap_or_default();
        hours.parse::<u32>().unwrap_or(0) * 60 + minutes.parse::<u32>().unwrap_or(0)
    })
}

/// Whether `now` (minutes after midnight) falls in quiet hours from `start` to `end`: start
/// included, end excluded, crossing midnight when the end is earlier; equal times mean none.
pub fn is_within_quiet_hours(now: u32, start: &str, end: &str) -> bool {
    let (Some(start), Some(end)) = (minutes_of(start), minutes_of(end)) else { return false };
    if start == end {
        false
    } else if start < end {
        now >= start && now < end
    } else {
        now >= start || now < end
    }
}

/// The user's limits on OS notifications (`os-notification-policy.ts`): none during quiet hours,
/// and none while an Athas window has focus when they asked for background-only ones.
pub fn can_send_os_notification(cx: &App) -> bool {
    let Some(settings) = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx)) else { return false };
    if settings.notification_quiet_hours {
        use chrono::Timelike as _;
        let now = chrono::Local::now();
        if is_within_quiet_hours(now.hour() * 60 + now.minute(), &settings.notification_quiet_hours_start, &settings.notification_quiet_hours_end) {
            return false;
        }
    }
    !(settings.notifications_only_in_background && cx.active_window().is_some())
}

/// Shows a notification from the OS when the policy allows it. Returns whether one was sent.
pub fn send_os_notification(cx: &App, title: &str, body: &str) -> bool {
    if !can_send_os_notification(cx) {
        return false;
    }
    os_notify(title, body)
}

/// [`send_os_notification`] with the system notification sound when `sound` is set (macOS; other
/// systems play their own).
pub fn send_os_notification_with_sound(cx: &App, title: &str, body: &str, sound: bool) -> bool {
    if !can_send_os_notification(cx) {
        return false;
    }
    os_notify_with_sound(title, body, sound)
}

#[cfg(target_os = "macos")]
fn os_notify(title: &str, body: &str) -> bool {
    os_notify_with_sound(title, body, false)
}

#[cfg(target_os = "macos")]
fn os_notify_with_sound(title: &str, body: &str, sound: bool) -> bool {
    // In the app bundle the banner is Athas's own, so clicking it brings Athas forward as the
    // original's (Tauri's notification plugin) does; a bare binary falls back to `osascript`.
    if native::bundled() {
        native::send(title, body, sound);
        return true;
    }
    let quote = |text: &str| text.replace('\\', "\\\\").replace('"', "\\\"");
    let mut script = format!("display notification \"{}\" with title \"{}\"", quote(body), quote(title));
    if sound {
        script.push_str(" sound name \"Glass\"");
    }
    std::process::Command::new("osascript").arg("-e").arg(script).spawn().is_ok()
}

#[cfg(not(target_os = "macos"))]
fn os_notify_with_sound(title: &str, body: &str, _sound: bool) -> bool {
    os_notify(title, body)
}

#[cfg(all(unix, not(target_os = "macos"), not(target_family = "wasm")))]
fn os_notify(title: &str, body: &str) -> bool {
    std::process::Command::new("notify-send").args(["--app-name=Athas", title, body]).spawn().is_ok()
}

/// A toast through the WinRT notification API in PowerShell, under PowerShell's own app id (an
/// unregistered one shows nothing).
#[cfg(any(windows, test))]
fn windows_toast_script(title: &str, body: &str) -> String {
    let quote = |text: &str| {
        let escaped = text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;");
        escaped.replace('\'', "''")
    };
    format!(
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; \
         [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null; \
         $xml = New-Object Windows.Data.Xml.Dom.XmlDocument; \
         $xml.LoadXml('<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>'); \
         $toast = New-Object Windows.UI.Notifications.ToastNotification $xml; \
         [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)",
        quote(title),
        quote(body)
    )
}

#[cfg(windows)]
fn os_notify(title: &str, body: &str) -> bool {
    use std::os::windows::process::CommandExt as _;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &windows_toast_script(title, body)])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .is_ok()
}

#[cfg(target_family = "wasm")]
fn os_notify(_: &str, _: &str) -> bool {
    false
}

/// One toast: the kind's mark, the message, its detail and a close button.
pub fn render_toast(notification: &Notification, on_close: impl Fn(&mut Window, &mut App) + 'static, cx: &App) -> AnyElement {
    let theme = cx.theme();
    let colors = &theme.colors;
    let close = Rc::new(on_close);
    // `ui/sonner.tsx`: 18px icons in the text colour (errors take the warning glyph), 356px cards
    // with 16px padding and a 12px radius, normal-weight 20px lines, and a close button that
    // appears on hover in the corner.
    let icon = match notification.kind {
        NotificationKind::Success => IconName::CheckCircle,
        NotificationKind::Info => IconName::Info,
        NotificationKind::Warning | NotificationKind::Error => IconName::Warning,
    };
    let group = SharedString::from(format!("toast-{}", notification.id));
    div()
        .id(gpui::ElementId::Name(notification.id.clone()))
        .group(group.clone())
        .relative()
        .flex()
        .items_start()
        .gap(px(6.))
        .w(px(356.))
        .p(px(16.))
        .rounded(px(12.))
        .bg(colors.overlay)
        .shadow(theme.shadows.popover.clone())
        .font_family(typography::UI_FONT)
        .child(div().flex_none().pt(px(1.)).child(Icon::new(icon).size(IconSize::Custom(px(18.))).color(colors.foreground)))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .pr(px(32.))
                .text_size(typography::TEXT_SM)
                .line_height(px(20.))
                .child(div().text_color(colors.foreground).child(notification.message.clone()))
                .children(notification.description.clone().map(|description| div().text_color(colors.muted_foreground).child(description)))
                .when(notification.action.is_some() || notification.secondary_action.is_some(), |this| {
                    // The fix first and filled, a second way out quieter beside it.
                    let button = |id: &'static str, action: &NotificationAction, variant: ButtonVariant| {
                        let handler = action.handler.clone();
                        Button::new(id, action.label.clone()).variant(variant).size(ButtonSize::Small).on_click(move |_, window, cx| handler(window, cx))
                    };
                    this.child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(6.))
                            .pt(px(8.))
                            .children(notification.action.as_ref().map(|action| button("toast-action", action, ButtonVariant::Accent)))
                            .children(notification.secondary_action.as_ref().map(|action| button("toast-secondary-action", action, ButtonVariant::Outline))),
                    )
                }),
        )
        .child(
            div()
                .id("toast-close")
                .absolute()
                .top(px(8.))
                .right(px(8.))
                .flex()
                .items_center()
                .justify_center()
                .size(px(18.))
                .rounded(px(4.))
                .invisible()
                .group_hover(group, |style| style.visible())
                .hover(|style| style.bg(colors.accent))
                .child(Icon::new(IconName::X).size(IconSize::Custom(px(14.))).color(colors.subtle_foreground))
                .on_click(move |_, window, cx| close(window, cx)),
        )
        .into_any_element()
}

/// The notifications list (`notifications-command.tsx`): search, category tabs, the Athas, Agent
/// and GitHub sections with counts, a delete button on each row, Clear in the header, and a
/// notification's details (message, category, age, the full description, Copy and Delete).
pub struct NotificationsDelegate {
    items: Vec<Notification>,
    category: Option<NotificationCategory>,
    matches: Vec<usize>,
    selected: usize,
    query: String,
    /// The notification whose details are open.
    details: Option<SharedString>,
    copied: bool,
}

const CATEGORIES: [(&str, Option<NotificationCategory>); 4] = [
    ("All", None),
    ("Athas", Some(NotificationCategory::Athas)),
    ("Agent", Some(NotificationCategory::Agent)),
    ("GitHub", Some(NotificationCategory::GitHub)),
];

fn category_label(category: NotificationCategory) -> &'static str {
    match category {
        NotificationCategory::Athas => "Athas",
        NotificationCategory::Agent => "Agent",
        NotificationCategory::GitHub => "GitHub",
    }
}

fn kind_label(kind: NotificationKind) -> &'static str {
    match kind {
        NotificationKind::Success => "success",
        NotificationKind::Warning => "warning",
        NotificationKind::Error => "error",
        NotificationKind::Info => "info",
    }
}

/// Removes one notification from the list (and its toast).
pub fn remove(cx: &mut App, id: &SharedString) {
    let store = cx.default_global::<Notifications>();
    store.items.retain(|item| item.id != *id);
    store.toasts.retain(|toast| toast != id);
}

/// The text Copy puts on the clipboard (`formatNotificationText`).
fn notification_text(item: &Notification) -> String {
    match &item.description {
        Some(description) => format!("{}\n{description}", item.message),
        None => item.message.to_string(),
    }
}

/// Indices of `items` in `category` matching every word of `query`, in section order (Athas,
/// Agent, GitHub), newest first within each.
fn visible(items: &[Notification], category: Option<NotificationCategory>, query: &str, now: u64) -> Vec<usize> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    let mut matches: Vec<usize> = items
        .iter()
        .enumerate()
        .filter(|(_, item)| category.is_none_or(|category| item.category == category))
        .filter(|(_, item)| {
            let text = format!(
                "{} {} {} {} {}",
                item.message,
                item.description.clone().unwrap_or_default(),
                kind_label(item.kind),
                category_label(item.category),
                relative_time(item.created_at, now)
            )
            .to_lowercase();
            words.iter().all(|word| text.contains(word))
        })
        .map(|(index, _)| index)
        .collect();
    let order = |category: NotificationCategory| match category {
        NotificationCategory::Athas => 0,
        NotificationCategory::Agent => 1,
        NotificationCategory::GitHub => 2,
    };
    matches.sort_by_key(|index| order(items[*index].category));
    matches
}

impl NotificationsDelegate {
    pub fn new(cx: &mut App) -> Self {
        let items = cx.default_global::<Notifications>().items.clone();
        mark_all_read(cx);
        Self { items, category: None, matches: Vec::new(), selected: 0, query: String::new(), details: None, copied: false }
    }

    fn detail_item(&self) -> Option<&Notification> {
        let id = self.details.as_ref()?;
        self.items.iter().find(|item| item.id == *id)
    }

    fn reload(&mut self, cx: &mut Context<Picker<Self>>) {
        self.items = cx.default_global::<Notifications>().items.clone();
        if self.detail_item().is_none() {
            self.details = None;
        }
        self.matches = visible(&self.items, self.category, &self.query, now_ms());
        self.selected = self.selected.min(self.matches.len().saturating_sub(1));
        cx.notify();
    }

    fn remove(&mut self, id: SharedString, cx: &mut Context<Picker<Self>>) {
        remove(cx, &id);
        if self.details.as_ref() == Some(&id) {
            self.details = None;
        }
        self.reload(cx);
    }

    fn section_header(&self, category: NotificationCategory, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let count = self.matches.iter().filter(|index| self.items[**index].category == category).count();
        div()
            .id(SharedString::from(format!("notification-section-{}", category_label(category))))
            .flex()
            .items_center()
            .gap(px(8.))
            .h(px(28.))
            .px(px(8.))
            .text_size(typography::TEXT_SM)
            .text_color(colors.subtle_foreground)
            .child(div().flex_1().min_w_0().child(category_label(category)))
            .child(
                div()
                    .px(px(6.))
                    .rounded_full()
                    .bg(colors.accent)
                    .text_size(typography::TEXT_CAPTION)
                    .text_color(colors.muted_foreground)
                    .child(count.to_string()),
            )
            .on_click(|_, _, cx| cx.stop_propagation())
            .on_mouse_move(|_, _, cx| cx.stop_propagation())
            .into_any_element()
    }

    fn render_details(&self, item: &Notification, window: &mut Window, cx: &mut Context<Picker<Self>>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let id = item.id.clone();
        let text = notification_text(item);
        div()
            .id("notification-details")
            .flex()
            .flex_col()
            .gap(px(8.))
            .p(px(8.))
            .on_click(|_, _, cx| cx.stop_propagation())
            .on_mouse_move(|_, _, cx| cx.stop_propagation())
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(Icon::new(item.kind.icon()).size(IconSize::Small).color(colors.muted_foreground))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().truncate().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).child(item.message.clone()))
                            .child(
                                div()
                                    .mt(px(2.))
                                    .text_size(typography::TEXT_SM)
                                    .text_color(colors.subtle_foreground)
                                    .child(format!("{} · {}", category_label(item.category), relative_time(item.created_at, now_ms()))),
                            ),
                    ),
            )
            .children(item.description.clone().map(|description| {
                div()
                    .id("notification-description")
                    .max_h(px(160.))
                    .overflow_y_scroll()
                    .p(px(8.))
                    .rounded(px(8.))
                    .bg(colors.surface)
                    .text_size(typography::TEXT_SM)
                    .text_color(colors.muted_foreground)
                    .child(description)
                    .scrollbar(window, cx)
            }))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        Button::new("notification-copy", if self.copied { "Copied" } else { "Copy" })
                            .leading_icon(IconName::Copy)
                            .variant(ButtonVariant::Ghost)
                            .on_click(cx.listener(move |picker, _, _, cx| {
                                cx.write_to_clipboard(ClipboardItem::new_string(text.clone()));
                                picker.delegate.copied = true;
                                cx.notify();
                                cx.spawn(async move |picker, cx| {
                                    cx.background_executor().timer(std::time::Duration::from_secs(1)).await;
                                    picker
                                        .update(cx, |picker, cx| {
                                            picker.delegate.copied = false;
                                            cx.notify();
                                        })
                                        .ok();
                                })
                                .detach();
                            })),
                    )
                    .child(
                        Button::new("notification-delete", "Delete")
                            .leading_icon(IconName::Trash)
                            .variant(ButtonVariant::Ghost)
                            .tone(ui::ButtonTone::Danger)
                            .on_click(cx.listener(move |picker, _, _, cx| picker.delegate.remove(id.clone(), cx))),
                    ),
            )
            .into_any_element()
    }
}

impl PickerDelegate for NotificationsDelegate {
    fn placeholder(&self) -> SharedString {
        "Search notifications".into()
    }

    fn match_count(&self) -> usize {
        if self.detail_item().is_some() { 1 } else { self.matches.len() }
    }

    fn selected_index(&self) -> usize {
        self.selected
    }

    fn set_selected_index(&mut self, index: usize, _: &mut Context<Picker<Self>>) {
        self.selected = index;
    }

    fn update_matches(&mut self, query: &str, _: &mut Window, _: &mut Context<Picker<Self>>) {
        self.query = query.to_string();
        self.details = None;
        self.matches = visible(&self.items, self.category, query, now_ms());
        self.selected = 0;
    }

    fn render_match(&self, index: usize, selected: bool, window: &mut Window, cx: &mut Context<Picker<Self>>) -> AnyElement {
        if let Some(item) = self.detail_item() {
            return self.render_details(item, window, cx);
        }
        let item = &self.items[self.matches[index]];
        let previous = index.checked_sub(1).map(|previous| self.items[self.matches[previous]].category);
        let header = (previous != Some(item.category)).then(|| self.section_header(item.category, cx));
        let description = item.description.clone().unwrap_or_else(|| relative_time(item.created_at, now_ms()).into());
        let id = item.id.clone();
        let mut row = PaletteRow::new(item.message.clone()).icon(item.kind.icon()).description(description).selected(selected);
        if item.category != NotificationCategory::GitHub {
            row = row.accessory(
                Button::icon(SharedString::from(format!("notification-delete-{index}")), IconName::Trash)
                    .size(ButtonSize::Small)
                    .tooltip(format!("Delete {}", item.message))
                    .on_click(cx.listener(move |picker, _, _, cx| {
                        cx.stop_propagation();
                        picker.delegate.remove(id.clone(), cx);
                    })),
            );
        }
        div().flex().flex_col().children(header).child(row).into_any_element()
    }

    /// A notification with an action (a GitHub item, an agent's session) runs it; any other
    /// opens its details.
    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        if self.detail_item().is_some() {
            return false;
        }
        let Some(item) = self.matches.get(index).map(|index| self.items[*index].clone()) else { return false };
        if let Some(action) = item.action.clone() {
            (action.handler)(window, cx);
            return true;
        }
        self.details = Some(item.id.clone());
        self.copied = false;
        cx.notify();
        false
    }

    fn empty_message(&self) -> SharedString {
        if self.query.trim().is_empty() { "No notifications yet.".into() } else { "No matching notifications.".into() }
    }

    fn leading_element(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Option<AnyElement> {
        self.detail_item()?;
        Some(
            Button::icon("notification-details-back", IconName::ArrowLeft)
                .size(ButtonSize::Small)
                .tooltip("Back")
                .on_click(cx.listener(|picker, _, _, cx| {
                    picker.delegate.details = None;
                    cx.notify();
                }))
                .into_any_element(),
        )
    }

    fn header_actions(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Vec<AnyElement> {
        if self.items.is_empty() || self.detail_item().is_some() {
            return Vec::new();
        }
        vec![
            Button::icon("notifications-clear", IconName::Trash)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .tooltip("Clear local notifications")
                .on_click(cx.listener(|picker, _, _, cx| {
                    clear(cx);
                    picker.delegate.reload(cx);
                }))
                .into_any_element(),
        ]
    }

    fn tabs(&self) -> Vec<(SharedString, bool)> {
        CATEGORIES.iter().map(|(label, category)| ((*label).into(), *category == self.category)).collect()
    }

    fn select_tab(&mut self, index: usize, _: &mut Window, _: &mut Context<Picker<Self>>) {
        self.category = CATEGORIES.get(index).and_then(|(_, category)| *category);
    }

    fn tab_icon(&self, index: usize) -> Option<IconName> {
        match CATEGORIES.get(index)?.1? {
            NotificationCategory::Athas => Some(IconName::Bell),
            NotificationCategory::Agent => Some(IconName::Sparkle),
            NotificationCategory::GitHub => Some(IconName::Github),
        }
    }

    fn shows_return_hint(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_toasts_escape_their_text() {
        let script = windows_toast_script("Ada's <build>", "done & \"green\"");
        assert!(script.contains("<text>Ada''s &lt;build&gt;</text><text>done &amp; &quot;green&quot;</text>"));
        assert!(script.contains("{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"));
        assert!(!script.contains('\n'));
    }

    #[test]
    fn quiet_hours_cross_midnight() {
        let at = |h: u32, m: u32| h * 60 + m;
        assert!(is_within_quiet_hours(at(23, 0), "22:00", "08:00"));
        assert!(is_within_quiet_hours(at(7, 59), "22:00", "08:00"));
        assert!(!is_within_quiet_hours(at(8, 0), "22:00", "08:00"));
        assert!(is_within_quiet_hours(at(12, 30), "12:00", "13:00"));
        assert!(!is_within_quiet_hours(at(13, 0), "12:00", "13:00"));
        assert!(!is_within_quiet_hours(at(12, 0), "12:00", "12:00"));
        assert!(!is_within_quiet_hours(at(12, 0), "noon", "13:00"));
    }

    #[gpui::test]
    fn the_policy_follows_the_settings(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            assert!(!can_send_os_notification(cx), "no settings, no OS notifications");
            settings::init(cx, settings::Settings::default(), None);
            assert!(can_send_os_notification(cx));
            settings::update(cx, |settings| {
                settings.notification_quiet_hours = true;
                settings.notification_quiet_hours_start = "00:00".into();
                settings.notification_quiet_hours_end = "23:59".into();
            });
            use chrono::Timelike as _;
            let now = chrono::Local::now();
            assert_eq!(can_send_os_notification(cx), now.hour() == 23 && now.minute() == 59);
        });
    }

    #[gpui::test]
    fn the_inbox_reads_new_notifications_without_looping(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            info(cx, "before");
        });
        let _inbox = cx.new(InboxPanel::new);
        cx.update(|cx| {
            assert_eq!(cx.global::<Notifications>().unread(), 0, "opening the Inbox reads what is there");
            info(cx, "while open");
        });
        cx.run_until_parked();
        cx.update(|cx| assert_eq!(cx.global::<Notifications>().unread(), 0, "what arrives while it is open is read too"));
    }

    #[gpui::test]
    fn notify_keeps_a_short_history(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            for index in 0..25 {
                info(cx, format!("message {index}"));
            }
            let store = cx.global::<Notifications>();
            assert_eq!(store.items().len(), MAX_NOTIFICATIONS);
            assert_eq!(store.items()[0].message.as_ref(), "message 24");
            assert_eq!(store.toasts().count(), 3);
            assert_eq!(store.unread(), MAX_NOTIFICATIONS);
            mark_all_read(cx);
            assert_eq!(cx.global::<Notifications>().unread(), 0);
        });
    }

    #[gpui::test]
    fn the_list_groups_sections_and_searches_every_field(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            notify(cx, NotificationKind::Info, NotificationCategory::Agent, "Agent finished", None, None);
            let saved = error(cx, "Save failed", Some("disk full".into()));
            notify(cx, NotificationKind::Success, NotificationCategory::Athas, "Pushed main", None, None);
            let items = cx.global::<Notifications>().items().to_vec();
            let now = now_ms();
            let order: Vec<&str> = visible(&items, None, "", now).into_iter().map(|index| items[index].message.as_ref()).collect();
            assert_eq!(order, ["Pushed main", "Save failed", "Agent finished"], "Athas first, then Agent, newest first");
            let found: Vec<&str> = visible(&items, None, "disk error", now).into_iter().map(|index| items[index].message.as_ref()).collect();
            assert_eq!(found, ["Save failed"], "description and kind are searched");
            assert!(visible(&items, Some(NotificationCategory::GitHub), "", now).is_empty());
            remove(cx, &saved);
            assert_eq!(cx.global::<Notifications>().items().len(), 2);
            assert_eq!(notification_text(&items[1]), "Save failed\ndisk full");
        });
    }
}
