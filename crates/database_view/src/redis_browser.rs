//! The Redis browser (`providers/redis/redis-viewer.tsx`): keys a SCAN pattern finds in the
//! sidebar, the selected key's value, and the server's info.

use gpui::{AnyElement, Context, Entity, Window, div, prelude::*, px};
use theme::ActiveTheme;
use ui::{
    Badge, Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, SidebarListItem, TextInput,
    TextInputEvent, Tone, WithScrollbar, typography,
};

use crate::{
    Confirm, DatabaseView, Dialog, PendingAction,
    mongo_browser::code_block,
    nosql::{self, RedisKey, RedisValue},
};

pub(crate) struct RedisBrowser {
    pub keys: Vec<RedisKey>,
    pub selected: Option<String>,
    pub value: Option<RedisValue>,
    pub info: Vec<(String, String)>,
    pub pattern: Entity<TextInput>,
    pub scan_pattern: String,
    pub cursor: String,
    pub has_more: bool,
    pub scanning: bool,
    pub loading: bool,
    pub show_info: bool,
    pub error: Option<String>,
    scan_request: u64,
    value_request: u64,
}

impl RedisBrowser {
    pub fn new(window: &mut Window, cx: &mut Context<DatabaseView>) -> Self {
        let pattern = cx.new(|cx| {
            let mut input = TextInput::new(window, cx)
                .placeholder("Pattern (e.g. user:*)")
                .appearance(ui::InputAppearance::Bare)
                .leading_icon(IconName::Search);
            input.set_text("*", cx);
            input
        });
        cx.subscribe(&pattern, |this, input, event: &TextInputEvent, cx| {
            if let TextInputEvent::Confirmed = event {
                let pattern = input.read(cx).text().to_string();
                this.scan_redis(Some(pattern), true, cx);
            }
        })
        .detach();
        Self {
            keys: Vec::new(),
            selected: None,
            value: None,
            info: Vec::new(),
            pattern,
            scan_pattern: "*".into(),
            cursor: "0".into(),
            has_more: false,
            scanning: false,
            loading: true,
            show_info: false,
            error: None,
            scan_request: 0,
            value_request: 0,
        }
    }
}

impl DatabaseView {
    pub(crate) fn start_redis(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.redis = Some(RedisBrowser::new(window, cx));
        self.scan_redis(Some("*".into()), true, cx);
        self.load_redis_info(cx);
    }

    /// Scans the next page of keys, or from the start when `reset` (a new pattern or a refresh).
    pub(crate) fn scan_redis(&mut self, pattern: Option<String>, reset: bool, cx: &mut Context<Self>) {
        let Some(backend) = self.backend.clone() else { return };
        let Some(redis) = self.redis.as_mut() else { return };
        let pattern = nosql::normalize_pattern(pattern.as_deref().unwrap_or(&redis.scan_pattern));
        let cursor = if reset { "0".to_string() } else { redis.cursor.clone() };
        redis.scan_request += 1;
        let request = redis.scan_request;
        redis.scanning = true;
        redis.error = None;
        if reset {
            redis.value_request += 1;
            redis.selected = None;
            redis.value = None;
        }
        let generation = self.generation;
        let scan_pattern = pattern.clone();
        let task = cx.background_spawn(async move { backend.redis_scan(&scan_pattern, &cursor) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                let Some(redis) = this.redis.as_mut().filter(|redis| redis.scan_request == request) else { return };
                redis.scanning = false;
                redis.loading = false;
                match result {
                    Ok(scan) => {
                        if reset {
                            redis.keys.clear();
                        }
                        nosql::merge_keys(&mut redis.keys, scan.keys);
                        redis.has_more = scan.cursor != "0";
                        redis.cursor = scan.cursor;
                        redis.scan_pattern = pattern;
                    }
                    Err(error) => redis.error = Some(format!("Scan failed: {error}")),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    fn load_redis_info(&mut self, cx: &mut Context<Self>) {
        let Some(backend) = self.backend.clone() else { return };
        let generation = self.generation;
        let task = cx.background_spawn(async move { backend.redis_info() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                let Some(redis) = this.redis.as_mut() else { return };
                match result {
                    Ok(info) => redis.info = info,
                    Err(error) => redis.error = Some(format!("Failed to load server info: {error}")),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn select_redis_key(&mut self, key: String, cx: &mut Context<Self>) {
        let key = key.trim().to_string();
        if key.is_empty() {
            return;
        }
        let Some(backend) = self.backend.clone() else { return };
        let Some(redis) = self.redis.as_mut() else { return };
        redis.value_request += 1;
        let request = redis.value_request;
        redis.selected = Some(key.clone());
        redis.value = None;
        redis.loading = true;
        redis.show_info = false;
        redis.error = None;
        let generation = self.generation;
        let task = cx.background_spawn(async move { backend.redis_value(&key) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                let Some(redis) = this.redis.as_mut().filter(|redis| redis.value_request == request) else { return };
                redis.loading = false;
                match result {
                    Ok(value) => redis.value = Some(value),
                    Err(error) => redis.error = Some(format!("Failed to get value: {error}")),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    pub(crate) fn toggle_redis_info(&mut self, cx: &mut Context<Self>) {
        if let Some(redis) = self.redis.as_mut() {
            redis.show_info = !redis.show_info;
            if redis.show_info {
                self.load_redis_info(cx);
            }
        }
        cx.notify();
    }

    pub(crate) fn request_delete_key(&mut self, key: &str, cx: &mut Context<Self>) {
        self.dialog = Some(Dialog::Confirm(Confirm {
            title: "Delete key?".into(),
            message: "The key and its value are removed. It cannot be undone.".into(),
            sql: Some(format!("DEL {key}").into()),
            confirm_label: "Delete".into(),
            destructive: true,
            action: PendingAction::DeleteKey(key.to_string()),
            running: false,
            error: None,
        }));
        cx.notify();
    }

    pub(crate) fn forget_redis_key(&mut self, key: &str) {
        if let Some(redis) = self.redis.as_mut() {
            redis.keys.retain(|candidate| candidate.key != key);
            if redis.selected.as_deref() == Some(key) {
                redis.value_request += 1;
                redis.selected = None;
                redis.value = None;
                redis.loading = false;
            }
        }
    }

    pub(crate) fn render_redis_keys(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let Some(redis) = self.redis.as_ref() else { return div() };
        let rows: Vec<AnyElement> = redis
            .keys
            .iter()
            .enumerate()
            .map(|(ix, info)| {
                let key = info.key.clone();
                SidebarListItem::new(("redis-key", ix), info.key.clone())
                    .in_content()
                    .active(redis.selected.as_deref() == Some(info.key.as_str()))
                    .leading(Badge::new(nosql::type_badge(&info.ty)).tone(if info.ty == "string" { Tone::Accent } else { Tone::Neutral }))
                    .when_some(nosql::format_ttl(info.ttl), |row, ttl| {
                        row.trailing(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(2.))
                                .text_size(typography::TEXT_CAPTION)
                                .child(Icon::new(IconName::Clock).size(IconSize::Custom(px(10.))).color(colors.subtle_foreground))
                                .child(ttl),
                        )
                    })
                    .on_click(cx.listener(move |this, _, _, cx| this.select_redis_key(key.clone(), cx)))
                    .into_any_element()
            })
            .collect();
        let refresh = Button::icon("refresh-keys", IconName::ArrowClockwise)
            .size(ButtonSize::Small)
            .tooltip("Refresh keys")
            .disabled(redis.scanning)
            .on_click(cx.listener(|this, _, _, cx| this.scan_redis(None, true, cx)));
        let note = |text: &'static str| {
            div().px(px(6.)).py(px(4.)).text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child(text)
        };
        div()
            .flex()
            .flex_col()
            .child(Self::section_title(format!("Keys ({})", redis.keys.len()), refresh, cx))
            .child(
                div()
                    .flex()
                    .items_center()
                    .h(px(28.))
                    .mx(px(2.))
                    .mb(px(4.))
                    .px(px(10.))
                    .rounded_full()
                    .bg(colors.field)
                    .border_1()
                    .border_color(colors.divider)
                    .child(redis.pattern.clone()),
            )
            .when(rows.is_empty() && !redis.scanning, |this| this.child(note("No keys match")))
            .children(rows)
            .when(redis.has_more, |this| {
                this.child(
                    div().flex().px(px(2.)).pt(px(2.)).child(
                        Button::new("more-keys", if redis.scanning { "Loading keys…" } else { "More keys…" })
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .disabled(redis.scanning)
                            .on_click(cx.listener(|this, _, _, cx| this.scan_redis(None, false, cx))),
                    ),
                )
            })
            .when(redis.scanning && !redis.has_more, |this| this.child(note("Loading keys…")))
    }

    pub(crate) fn render_redis(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let Some(redis) = self.redis.as_ref() else { return div().into_any_element() };
        let selected = redis.selected.clone();
        let toolbar = Self::toolbar(cx)
            .child(Icon::new(if redis.show_info { IconName::Info } else { IconName::Key }).size(IconSize::XSmall).color(colors.subtle_foreground))
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .font_weight(typography::MEDIUM)
                    .font_family(typography::MONO_FONT)
                    .child(match (&selected, redis.show_info) {
                        (_, true) => "Server info".to_string(),
                        (Some(key), false) => key.clone(),
                        (None, false) => "No key selected".to_string(),
                    }),
            )
            .when_some(redis.value.as_ref().filter(|_| !redis.show_info), |this, value| {
                this.child(Badge::new(value.ty.clone()))
            })
            .child(div().flex_1())
            .child(
                Button::new("redis-info", "Info")
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .active(redis.show_info)
                    .tooltip("Toggle server info")
                    .on_click(cx.listener(|this, _, _, cx| this.toggle_redis_info(cx))),
            )
            .when_some(selected.clone().filter(|_| !redis.show_info), |this, key| {
                this.child(
                    Button::icon("delete-key", IconName::Trash)
                        .size(ButtonSize::Small)
                        .tone(ui::ButtonTone::Danger)
                        .tooltip("Delete key")
                        .on_click(cx.listener(move |this, _, _, cx| this.request_delete_key(&key, cx))),
                )
            });

        let centered = |content: AnyElement| div().flex().flex_1().items_center().justify_center().child(content).into_any_element();
        let body = if redis.loading {
            centered(div().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("Loading…").into_any_element())
        } else if redis.show_info {
            div()
                .id("redis-info")
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .p(px(16.))
                .text_size(typography::TEXT_SM)
                .children(redis.info.iter().map(|(key, value)| {
                    div()
                        .flex()
                        .gap(px(12.))
                        .py(px(4.))
                        .child(div().w(px(160.)).flex_none().text_color(colors.subtle_foreground).child(key.clone()))
                        .child(div().flex_1().min_w_0().child(value.clone()))
                }))
                .scrollbar(window, cx)
                .into_any_element()
        } else if let Some(value) = redis.value.as_ref() {
            div()
                .id("redis-value")
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .p(px(12.))
                .child(code_block(&nosql::redis_value_text(&value.value), cx))
                .scrollbar(window, cx)
                .into_any_element()
        } else {
            centered(
                EmptyState::new("Select a key")
                    .icon(IconName::Key)
                    .message("Pick a Redis key from the sidebar to inspect its value.")
                    .into_any_element(),
            )
        };

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .child(toolbar)
            .children(redis.error.as_ref().map(|error| Self::error_banner(error, cx)))
            .child(body)
            .into_any_element()
    }
}
