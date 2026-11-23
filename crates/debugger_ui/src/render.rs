//! Drawing the view, after `debugger-view.tsx`: a segmented bar (Call Stack, Variables, Watch,
//! Console, Breakpoints with counts) over a configuration column and the selected panel.

use std::path::Path;

use dap::{Breakpoint, BreakpointField, DebugSession, OutputCategory, SessionStatus};
use ui::scale::px;
use gpui::{
    Anchor, AnyElement, ClickEvent, Context, ElementId, Hsla, IntoElement, MouseButton, MouseDownEvent, Pixels, Render, SharedString, Window, div,
    prelude::*,
};
use theme::{ActiveTheme, ThemeColors};
use ui::TooltipExt as _;
use ui::{Badge, Button, ButtonSize, ButtonTone, ButtonVariant, Icon, IconName, IconSize, MenuEntry, MenuItem, OpenMenu, metrics, pane_header, typography};

use crate::{
    DebuggerView, Panel, Pause, Restart, Start, StepInto, StepOut, StepOver, Stop,
    tree::{self, RowKind, TreeRow},
};

/// `grid-cols-[minmax(260px,320px)_minmax(0,1fr)]`.
fn aside_width() -> Pixels { px(320.) }
fn aside_min_width() -> Pixels { px(260.) }
/// Room at the bar's end for the host's full screen and close buttons.
fn host_actions_width() -> Pixels { px(62.) }

/// `EMPTY_DEBUG_SECTION_MESSAGES`.
const EMPTY_STACK: &str = "Start a session to see frames.";
const EMPTY_VARIABLES: &str = "Pause on a frame to inspect values.";
const EMPTY_CONSOLE: &str = "Adapter output appears here.";
const EMPTY_BREAKPOINTS: &str = "Click a gutter line or toggle the current line.";
const EMPTY_WATCH: &str = "Add expressions to inspect while paused.";

fn row_height() -> Pixels { px(24.) }
const INDENT: f32 = 12.;

fn syntax(colors: &ThemeColors, key: &str, fallback: Hsla) -> Hsla {
    colors.syntax.get(key).copied().unwrap_or(fallback)
}

/// The colour of a value: strings, numbers, booleans and nulls as the editor colours them.
fn value_color(value: &str, kind: Option<&str>, colors: &ThemeColors) -> Hsla {
    let kind = kind.unwrap_or_default().to_ascii_lowercase();
    let first = value.chars().next().unwrap_or_default();
    if matches!(first, '"' | '\'') || kind == "str" || kind == "string" {
        syntax(colors, "string", colors.foreground)
    } else if first.is_ascii_digit() || (first == '-' && value.len() > 1) || matches!(kind.as_str(), "int" | "float" | "number" | "i32" | "i64" | "u32" | "u64" | "usize" | "f64") {
        syntax(colors, "number", colors.foreground)
    } else if matches!(value, "true" | "false" | "True" | "False") {
        syntax(colors, "boolean", colors.foreground)
    } else if matches!(value, "null" | "nil" | "None" | "undefined") {
        syntax(colors, "null", colors.subtle_foreground)
    } else {
        colors.muted_foreground
    }
}

/// A compact row of a debug list.
fn row(id: impl Into<ElementId>, depth: usize, colors: &ThemeColors) -> gpui::Stateful<gpui::Div> {
    let hover = colors.accent;
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .gap(px(4.))
        .h(row_height())
        .min_w_0()
        .mx(px(4.))
        .pl(px(4. + depth as f32 * INDENT))
        .pr(px(6.))
        .rounded(metrics::radius_md())
        .text_size(typography::text_sm())
        .hover(move |style| style.bg(hover))
}

fn chevron(expanded: bool, visible: bool, colors: &ThemeColors) -> impl IntoElement {
    let icon = if expanded { IconName::ChevronDown } else { IconName::ChevronRight };
    div()
        .flex()
        .flex_none()
        .w(px(12.))
        .justify_center()
        .when(visible, |this| this.child(Icon::new(icon).size(IconSize::XSmall).color(colors.subtle_foreground)))
}

/// `EmptyState layout="sidebar"`: a quiet line at the top of the panel (`px-3 py-6`).
fn empty(text: &'static str, colors: &ThemeColors) -> AnyElement {
    div().px(px(12.)).pt(px(38.)).pb(px(24.)).text_size(typography::text_sm()).text_color(colors.muted_foreground).child(text).into_any_element()
}

fn quiet(text: impl Into<SharedString>, colors: &ThemeColors) -> AnyElement {
    div()
        .px(px(8.))
        .py(px(4.))
        .text_size(typography::text_sm())
        .text_color(colors.subtle_foreground)
        .child(text.into())
        .into_any_element()
}

fn row_action(
    id: impl Into<ElementId>,
    icon: IconName,
    tooltip: &'static str,
    cx: &Context<DebuggerView>,
    handler: impl Fn(&mut DebuggerView, &mut Window, &mut Context<DebuggerView>) + 'static,
) -> AnyElement {
    Button::icon(id, icon)
        .size(ButtonSize::XSmall)
        .tooltip(tooltip)
        .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
            cx.stop_propagation();
            handler(this, window, cx);
        }))
        .into_any_element()
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

impl DebuggerView {
    /// The configuration column: Configuration, Command, the controls, the session and the
    /// project folder at the foot.
    fn render_aside(&self, session: Option<&DebugSession>, cx: &Context<Self>) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let status = session.map(DebugSession::status);
        let paused = status == Some(SessionStatus::Stopped);
        let running = matches!(status, Some(SessionStatus::Running | SessionStatus::Starting));
        let active = running || paused || self.command_session.is_some();
        let custom = self.is_custom_selected();
        let can_start = !self.configs.is_empty() && (!custom || !self.command_input.read(cx).text().trim().is_empty());
        let config_label: SharedString =
            self.selected_config().map(|config| config.name.clone()).unwrap_or_else(|| "No configurations".into()).into();
        let label = |text: &'static str| div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(text);
        let control = |id: &'static str, icon: IconName, tooltip: &'static str, shortcut: &'static str, enabled: bool| {
            Button::icon(id, icon).tooltip(tooltip).shortcut(shortcut).disabled(!enabled)
        };
        let pause_or_continue = if paused {
            control("debug-continue", IconName::Play, "Continue debugging", "F5", true)
                .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.on_start(&Start, window, cx)))
        } else {
            control("debug-pause", IconName::Pause, "Pause debugging", "F6", status == Some(SessionStatus::Running))
                .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.on_pause(&Pause, window, cx)))
        };
        let command: AnyElement = if custom {
            self.command_input.clone().into_any_element()
        } else {
            div()
                .min_h(px(32.))
                .px(px(8.))
                .py(px(6.))
                .rounded(metrics::radius_lg())
                .bg(colors.surface)
                .truncate()
                .font_family(typography::MONO_FONT)
                .text_size(typography::text_sm())
                .text_color(colors.subtle_foreground)
                .child(self.command_preview().unwrap_or_else(|| "No command available".into()))
                .into_any_element()
        };

        let status_block = session.filter(|session| session.status() != SessionStatus::Ended).map(|session| {
            let (dot, text) = match session.status() {
                SessionStatus::Starting => (colors.info, format!("Starting {}…", session.adapter_name().unwrap_or("the debug adapter"))),
                SessionStatus::Running => (colors.success, session.config().name.clone()),
                _ => (colors.warning, session.stop_info().map(|stop| stop.label()).unwrap_or_else(|| "Paused".into())),
            };
            div()
                .flex_none()
                .border_t_1()
                .border_color(colors.divider)
                .px(px(12.))
                .py(px(8.))
                .text_size(typography::text_sm())
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(div().flex_none().size(px(7.)).rounded_full().bg(dot))
                        .child(div().min_w_0().truncate().font_weight(typography::MEDIUM).child(session.config().name.clone()))
                        .when(session.status() == SessionStatus::Stopped, |this| this.child(Badge::new("Paused").tone(ui::Tone::Warning))),
                )
                .child(div().mt(px(4.)).text_color(colors.subtle_foreground).child(text))
        });
        let ended = session.filter(|session| session.status() == SessionStatus::Ended).and_then(|session| {
            let reason = session.ended_reason().unwrap_or("ended");
            (!matches!(reason, "stopped" | "the program finished")).then(|| reason.to_string())
        });
        let command_block = self.command_session.as_ref().map(|command| {
            div()
                .flex_none()
                .border_t_1()
                .border_color(colors.divider)
                .px(px(12.))
                .py(px(8.))
                .text_size(typography::text_sm())
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(div().flex_none().size(px(7.)).rounded_full().bg(colors.success))
                        .child(div().min_w_0().truncate().font_weight(typography::MEDIUM).child(command.name.clone())),
                )
                .child(div().mt(px(4.)).truncate().font_family(typography::MONO_FONT).text_color(colors.subtle_foreground).child(command.command.clone()))
        });
        let alert = self.notice.clone().or(ended).map(|notice| {
            div()
                .px(px(10.))
                .py(px(8.))
                .rounded(metrics::radius_lg())
                .bg(colors.destructive_soft)
                .text_size(typography::text_sm())
                .text_color(colors.foreground)
                .child(notice)
        });

        div()
            .flex()
            .flex_col()
            .flex_none()
            .w(aside_width())
            .min_w(aside_min_width())
            .flex_shrink_1()
            .min_h_0()
            .border_r_1()
            .border_color(colors.divider)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .p(px(12.))
                    .child(
                        div().flex().flex_col().gap(px(6.)).child(label("Configuration")).child(
                            div().flex().child(
                                Button::new("debug-config", config_label)
                                    .trailing_icon(IconName::ChevronDown)
                                    .shrinkable()
                                    .tooltip("Debug configuration")
                                    .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.show_picker(window, cx))),
                            ),
                        ),
                    )
                    .child(div().flex().flex_col().gap(px(6.)).child(label("Command")).child(command))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .child(
                                control("debug-start", IconName::Play, "Start debugging", "F5", can_start && !active)
                                    .variant(ButtonVariant::Accent)
                                    .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.on_start(&Start, window, cx))),
                            )
                            .child(pause_or_continue)
                            .child(
                                control("debug-stop", IconName::Square, "Stop debugging", "⇧F5", active)
                                    .variant(ButtonVariant::Ghost)
                                    .tone(ButtonTone::Danger)
                                    .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.on_stop(&Stop, window, cx))),
                            )
                            .child(
                                control("debug-step-over", IconName::ArrowCornerDownLeft, "Step over", "F10", paused)
                                    .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.on_step_over(&StepOver, window, cx))),
                            )
                            .child(
                                control("debug-step-into", IconName::ArrowDown, "Step into", "F11", paused)
                                    .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.on_step_into(&StepInto, window, cx))),
                            )
                            .child(
                                control("debug-step-out", IconName::ArrowUp, "Step out", "⇧F11", paused)
                                    .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.on_step_out(&StepOut, window, cx))),
                            )
                            .child(
                                control("debug-restart", IconName::ArrowsClockwise, "Restart debugging", "⇧⌘F5", can_start || active)
                                    .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.on_restart(&Restart, window, cx))),
                            )
                            .when(session.is_some_and(|session| session.config().kind == "java" && session.is_active()), |this| {
                                this.child(
                                    Button::icon("debug-java-hot-reload", IconName::ArrowsClockwise)
                                        .tooltip("Apply Java changes")
                                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.apply_java_changes(cx))),
                                )
                            }),
                    )
                    .when(self.is_starting_java(), |this| {
                        this.child(div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child("Starting the Java debugger through jdtls…"))
                    })
                    .children(alert),
            )
            .children(status_block)
            .children(command_block)
            .when(session.is_none() && self.command_session.is_none() && !self.installed_adapters.is_empty(), |this| {
                this.child(quiet(format!("Adapters found: {}", self.installed_adapters.join(", ")), colors))
            })
            .child(
                div()
                    .mt_auto()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(6.))
                    .border_t_1()
                    .border_color(colors.divider)
                    .px(px(12.))
                    .py(px(8.))
                    .text_size(typography::text_sm())
                    .text_color(colors.subtle_foreground)
                    .child(Icon::new(IconName::FolderOpen).size(IconSize::Custom(px(12.))).color(colors.subtle_foreground))
                    .child(div().min_w_0().truncate().child(self.project_root().display().to_string())),
            )
    }

    /// The segmented bar (`TabBarSurface` + `TabsList`) with each panel's count, and the actions
    /// at its end.
    fn render_bar(&self, session: Option<&DebugSession>, cx: &Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let breakpoints = self.store.read(cx).len();
        let exception_filters = session
            .filter(|session| session.is_active())
            .map_or(0, |session| session.capabilities().exception_breakpoint_filters.iter().filter(|filter| session.exception_filter_enabled(&filter.filter)).count());
        let output = session.map_or(0, |session| session.output().len());
        let count = |panel: Panel| match panel {
            Panel::Stack => session.map_or(0, |session| session.frames().len()),
            Panel::Variables => session.map_or(0, |session| session.scopes().len()),
            Panel::Watch => self.watches.len(),
            Panel::Console => output,
            Panel::Breakpoints => breakpoints + exception_filters,
        };
        let tabs = Panel::ALL.into_iter().map(|panel| {
            let active = panel == self.panel;
            let text = if active { colors.foreground } else { colors.subtle_foreground };
            let hover_text = colors.foreground;
            div()
                .id(ElementId::Name(format!("debug-panel-{}", panel.label()).into()))
                .flex()
                .flex_none()
                .items_center()
                .gap(px(6.))
                .h(metrics::chrome_control())
                .px(px(12.))
                .rounded_full()
                .whitespace_nowrap()
                .text_color(text)
                .when(active, |this| this.bg(colors.segment_knob).shadow(theme.shadows.raised_inset.clone()))
                .when(!active, |this| this.hover(move |style| style.text_color(hover_text)))
                .child(panel.label())
                .child(Badge::new(count(panel).to_string()))
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.set_panel(panel, cx)))
        });
        let any_enabled = self.store.read(cx).files().any(|(_, breakpoints)| breakpoints.iter().any(|breakpoint| breakpoint.enabled));
        let status_badge = session.map(|session| match session.status() {
            SessionStatus::Starting => Badge::new("Starting").tone(ui::Tone::Info),
            SessionStatus::Running => Badge::new("Running").tone(ui::Tone::Success),
            SessionStatus::Stopped => Badge::new("Paused").tone(ui::Tone::Warning),
            SessionStatus::Ended => Badge::new("Idle"),
        });
        let icon = |id: &'static str, icon: IconName, tooltip: &'static str| Button::icon(id, icon).variant(ButtonVariant::Ghost).size(ButtonSize::Small).tooltip(tooltip);
        pane_header(cx)
            .id("debug-bar")
            .pl(metrics::pane_inset())
            .pr(host_actions_width())
            .on_mouse_down(MouseButton::Right, cx.listener(|this, event: &MouseDownEvent, window, cx| this.show_bar_menu(event, window, cx)))
            .child(Icon::new(IconName::Bug).size(IconSize::Custom(px(14.))).color(colors.subtle_foreground))
            .child(
                div().flex().flex_1().min_w_0().overflow_hidden().child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(2.))
                        .p(px(2.))
                        .rounded_full()
                        .bg(colors.segment_track)
                        .font_weight(typography::MEDIUM)
                        .text_size(typography::text_chrome())
                        .children(tabs),
                ),
            )
            .children(status_badge)
            .when(self.panel == Panel::Console && output > 0, |this| {
                this.child(icon("debug-console-clear", IconName::Trash, "Clear console").on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.clear_console(cx))))
            })
            .when(self.panel == Panel::Breakpoints && breakpoints > 0, |this| {
                this.child(
                    icon("debug-bp-toggle-all", if any_enabled { IconName::EyeSlash } else { IconName::Eye }, if any_enabled { "Disable breakpoints" } else { "Enable breakpoints" })
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.store.update(cx, |store, cx| store.set_all_enabled(!any_enabled, cx)))),
                )
                .child(icon("debug-bp-clear", IconName::Trash, "Clear breakpoints").on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.store.update(cx, |store, cx| store.clear(cx)))))
            })
            .child(
                icon("debug-bp-at-cursor", IconName::CircleDotted, "Toggle breakpoint at cursor")
                    .shortcut("F9")
                    .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.toggle_breakpoint_at_cursor(window, cx))),
            )
    }

    fn show_bar_menu(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let status = self.status(cx);
        let paused = status == Some(SessionStatus::Stopped);
        let active = matches!(status, Some(SessionStatus::Running | SessionStatus::Starting | SessionStatus::Stopped)) || self.command_session.is_some();
        let this = cx.entity().downgrade();
        let item = |label: &'static str, icon: IconName, enabled: bool, action: fn(&mut DebuggerView, &mut Window, &mut Context<DebuggerView>)| {
            let this = this.clone();
            MenuEntry::from(MenuItem::new(label).icon(icon).disabled(!enabled).on_select(move |window, cx| {
                this.update(cx, |view, cx| action(view, window, cx)).ok();
            }))
        };
        let entries = vec![
            item("Start Debugging", IconName::Play, !self.configs.is_empty() && !active, |view, window, cx| view.start(window, cx)),
            if paused {
                item("Continue Debugging", IconName::Play, true, |view, window, cx| view.start(window, cx))
            } else {
                item("Pause Debugging", IconName::Pause, status == Some(SessionStatus::Running), |view, _, cx| view.pause(cx))
            },
            item("Stop Debugging", IconName::Square, active, |view, _, cx| view.stop(cx)),
            item("Restart Debugging", IconName::ArrowsClockwise, !self.configs.is_empty(), |view, window, cx| view.restart(window, cx)),
            MenuEntry::Separator,
            item("Toggle Breakpoint at Cursor", IconName::CircleDotted, true, |view, window, cx| view.toggle_breakpoint_at_cursor(window, cx)),
        ];
        self.open_menu = Some(OpenMenu::new("debug-bar", entries, event.position, Anchor::TopLeft, window, cx, |this: &mut DebuggerView, _| this.open_menu = None));
        cx.notify();
    }

    fn render_call_stack(&self, session: Option<&DebugSession>, cx: &Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let Some(session) = session.filter(|session| session.status() == SessionStatus::Stopped) else {
            return vec![empty(EMPTY_STACK, &colors)];
        };
        let mut rows = Vec::new();
        let show_threads = session.threads().len() > 1;
        for thread in session.threads() {
            let selected = Some(thread.id) == session.selected_thread();
            if show_threads {
                let id = thread.id;
                let stopped_here = session.stop_info().and_then(|stop| stop.thread_id) == Some(thread.id);
                rows.push(
                    row(ElementId::NamedInteger("debug-thread".into(), thread.id as u64), 0, &colors)
                        .child(chevron(selected, true, &colors))
                        .child(Icon::new(IconName::Nodes).size(IconSize::XSmall).color(colors.subtle_foreground))
                        .child(div().flex_1().min_w_0().truncate().text_color(colors.foreground).child(thread.name.clone()))
                        .when(stopped_here, |this| {
                            this.child(div().flex_none().text_size(typography::text_caption()).text_color(colors.warning).child("Paused"))
                        })
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.select_thread(id, cx)))
                        .into_any_element(),
                );
            }
            if !selected {
                continue;
            }
            let depth = usize::from(show_threads);
            for frame in session.frames() {
                let id = frame.id;
                let active = Some(frame.id) == session.selected_frame();
                let subtle = frame.presentation_hint.as_deref() == Some("subtle") || frame.path().is_none();
                rows.push(
                    row(ElementId::NamedInteger("debug-frame".into(), frame.id as u64), depth, &colors)
                        .pl(px(8. + depth as f32 * INDENT))
                        .when(active, |this| this.bg(colors.selected))
                        .when(subtle, |this| this.opacity(0.6))
                        .child(Icon::new(IconName::Stack).size(IconSize::XSmall).color(colors.subtle_foreground))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_color(if active { colors.foreground } else { colors.muted_foreground })
                                .child(frame.name.clone()),
                        )
                        .children(frame.source_label().map(|label| {
                            div().flex_none().max_w(px(160.)).truncate().text_color(colors.subtle_foreground).child(label)
                        }))
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.select_frame(id, cx)))
                        .into_any_element(),
                );
            }
            if session.frames().is_empty() {
                rows.push(quiet("Loading call stack…", &colors));
            }
        }
        rows
    }

    fn render_tree_row(&self, tree_row: TreeRow, cx: &Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let id = ElementId::Name(format!("debug-var-{}", tree_row.key).into());
        let expandable = tree_row.reference > 0;
        let base = row(id, tree_row.depth, &colors).child(chevron(tree_row.expanded, expandable, &colors));
        let base = if expandable {
            let key = tree_row.key.clone();
            let expanded = !tree_row.expanded;
            let reference = tree_row.reference;
            base.on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.toggle_row(key.clone(), expanded, reference, cx)))
        } else {
            base
        };
        match tree_row.kind {
            RowKind::Scope => base
                .child(div().flex_1().min_w_0().truncate().font_weight(typography::MEDIUM).text_color(colors.muted_foreground).child(tree_row.name))
                .into_any_element(),
            RowKind::Loading => base.child(div().text_color(colors.subtle_foreground).child("Loading…")).into_any_element(),
            RowKind::Failed(error) => base.child(div().flex_1().min_w_0().truncate().text_color(colors.destructive).child(error)).into_any_element(),
            RowKind::Variable { value, kind } => {
                let value_color = value_color(&value, kind.as_deref(), &colors);
                let tooltip: SharedString = match &kind {
                    Some(kind) => format!("{}: {kind}", tree_row.name).into(),
                    None => tree_row.name.clone().into(),
                };
                let editing = self.variable_edit.as_ref().filter(|edit| edit.key == tree_row.key);
                let group = SharedString::from(format!("debug-var-{}", tree_row.key));
                let settable = editing.is_none() && tree_row.parent > 0 && self.can_set_variables(cx);
                let (key, parent, name, current) = (tree_row.key.clone(), tree_row.parent, tree_row.name.clone(), value.clone());
                base.group(group.clone())
                    .font_family(typography::MONO_FONT)
                    .child(div().flex_none().max_w(px(180.)).truncate().text_color(syntax(&colors, "property", colors.foreground)).child(tree_row.name))
                    .child(div().flex_none().text_color(colors.subtle_foreground).child("="))
                    .map(|this| match editing {
                        Some(edit) => this.child(
                            div().flex_1().min_w_0().px(px(4.)).rounded(metrics::radius()).bg(colors.field).border_1().border_color(colors.focus_ring).child(edit.input.clone()),
                        ),
                        None => this.child(div().flex_1().min_w_0().truncate().text_color(value_color).child(value)),
                    })
                    .when(settable, |this| {
                        this.child(div().flex_none().invisible().group_hover(group, |style| style.visible()).child(row_action(
                            ElementId::Name(format!("debug-var-set-{key}").into()),
                            IconName::Pencil,
                            "Set Value",
                            cx,
                            move |this, window, cx| this.edit_variable(key.clone(), parent, name.clone(), current.clone(), window, cx),
                        )))
                    })
                    .anchored_tooltip({ let text: gpui::SharedString = (tooltip).into(); move || ui::Tooltip::new(text.clone()) })
                    .into_any_element()
            }
        }
    }

    fn render_variables(&self, session: Option<&DebugSession>, cx: &Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let Some(session) = session.filter(|session| session.status() == SessionStatus::Stopped) else {
            return vec![empty(EMPTY_VARIABLES, &colors)];
        };
        if session.scopes().is_empty() {
            return vec![quiet("Loading…", &colors)];
        }
        let rows = tree::scope_rows(session, &self.expansion, &mut Vec::new());
        rows.into_iter().map(|tree_row| self.render_tree_row(tree_row, cx)).collect()
    }

    /// `DebugWatchPanel`: the Add expression field with Add and Refresh, then the watches.
    fn render_watches(&self, session: Option<&DebugSession>, cx: &Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let has_text = !self.watch_input.read(cx).text().trim().is_empty();
        let can_refresh = session.is_some_and(|session| session.status() == SessionStatus::Stopped) && !self.watches.is_empty();
        let mut rows = vec![
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .p(px(8.))
                .child(div().flex_1().min_w_0().child(self.watch_input.clone()))
                .child(Button::icon("debug-watch-add", IconName::Plus).tooltip("Add watch").disabled(!has_text).on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                    let expression = this.watch_input.read(cx).text().to_string();
                    this.watch_input.update(cx, |input, cx| input.set_text("", cx));
                    this.add_watch(expression, cx);
                })))
                .child(
                    Button::icon("debug-watch-refresh", IconName::ArrowsClockwise)
                        .variant(ButtonVariant::Ghost)
                        .tooltip("Refresh watches")
                        .disabled(!can_refresh)
                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.evaluate_watches(cx))),
                )
                .into_any_element(),
        ];
        for watch in &self.watches {
            let id = watch.id;
            let key = format!("watch/{id}");
            let result = watch.result.as_ref();
            let reference = match result {
                Some(Ok(result)) => result.variables_reference,
                _ => 0,
            };
            let expanded = reference > 0 && self.expansion.is_expanded(&key, false);
            let (value, value_color) = match result {
                Some(Ok(result)) => (result.result.clone(), value_color(&result.result, result.kind.as_deref(), &colors)),
                Some(Err(error)) => (error.clone(), colors.destructive),
                None => ("not available".to_string(), colors.subtle_foreground),
            };
            let group = SharedString::from(format!("debug-watch-{id}"));
            let toggle_key = key.clone();
            rows.push(
                row(ElementId::NamedInteger("debug-watch".into(), id), 0, &colors)
                    .group(group.clone())
                    .font_family(typography::MONO_FONT)
                    .child(chevron(expanded, reference > 0, &colors))
                    .child(div().flex_none().max_w(px(180.)).truncate().text_color(syntax(&colors, "property", colors.foreground)).child(watch.expression.clone()))
                    .child(div().flex_none().text_color(colors.subtle_foreground).child("="))
                    .child(div().flex_1().min_w_0().truncate().text_color(value_color).child(value))
                    .child(
                        div()
                            .flex_none()
                            .invisible()
                            .group_hover(group, |style| style.visible())
                            .child(row_action(ElementId::NamedInteger("debug-watch-remove".into(), id), IconName::X, "Remove", cx, move |this, _, cx| {
                                this.remove_watch(id, cx)
                            })),
                    )
                    .when(reference > 0, |this| {
                        this.on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.toggle_row(toggle_key.clone(), !expanded, reference, cx)))
                    })
                    .into_any_element(),
            );
            if expanded && let Some(session) = session {
                let mut children = Vec::new();
                tree::push_children(session, reference, &key, 1, &self.expansion, &mut children, &mut Vec::new());
                rows.extend(children.into_iter().map(|child| self.render_tree_row(child, cx)));
            }
        }
        if self.watches.is_empty() {
            rows.push(empty(EMPTY_WATCH, &colors));
        }
        rows
    }

    fn render_breakpoint(&self, path: &Path, breakpoint: &Breakpoint, root: &Path, cx: &Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let id = breakpoint.id;
        let unverified = breakpoint.state.verified == Some(false);
        let dot_color = if !breakpoint.enabled || unverified { colors.subtle_foreground } else { colors.destructive };
        let dot = div()
            .id(ElementId::NamedInteger("debug-bp-toggle".into(), id.0))
            .flex()
            .flex_none()
            .w(px(14.))
            .h(row_height())
            .items_center()
            .justify_center()
            .child(
                div()
                    .size(px(9.))
                    .rounded_full()
                    .when(breakpoint.log_message.is_some(), |this| this.rounded(metrics::radius_sm()))
                    .when(breakpoint.enabled && !unverified, |this| this.bg(dot_color))
                    .when(!breakpoint.enabled || unverified, |this| this.border_1().border_color(dot_color)),
            )
            .anchored_tooltip({ let text: gpui::SharedString = (if breakpoint.enabled { "Disable" } else { "Enable" }).into(); move || ui::Tooltip::new(text.clone()) })
            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                cx.stop_propagation();
                let enabled = this.store.read(cx).find(id).is_some_and(|(_, breakpoint)| breakpoint.enabled);
                this.store.update(cx, |store, cx| store.set_enabled(id, !enabled, cx));
            }));
        let directory = path.parent().map(|parent| parent.strip_prefix(root).unwrap_or(parent).display().to_string()).unwrap_or_default();
        let detail = [
            breakpoint.condition.as_ref().map(|condition| format!("if {condition}")),
            breakpoint.hit_condition.as_ref().map(|hits| format!("hits {hits}")),
            breakpoint.log_message.as_ref().map(|message| format!("log {message}")),
            breakpoint.state.message.clone().filter(|_| unverified),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ");
        let editing = self.editing.as_ref().filter(|edit| edit.id == id);
        let group = SharedString::from(format!("debug-bp-{}", id.0));
        let open_path = path.to_path_buf();
        let line = breakpoint.row + 1;
        let actions = div()
            .absolute()
            .right(px(4.))
            .top(px(2.))
            .flex()
            .gap(px(1.))
            .invisible()
            .group_hover(group.clone(), |style| style.visible())
            .child(row_action(ElementId::NamedInteger("debug-bp-condition".into(), id.0), IconName::Pencil, "Edit Condition", cx, move |this, window, cx| {
                this.edit_breakpoint(id, BreakpointField::Condition, window, cx)
            }))
            .child(row_action(ElementId::NamedInteger("debug-bp-hits".into(), id.0), IconName::Hash, "Edit Hit Count", cx, move |this, window, cx| {
                this.edit_breakpoint(id, BreakpointField::HitCondition, window, cx)
            }))
            .child(row_action(ElementId::NamedInteger("debug-bp-log".into(), id.0), IconName::ChatBubbleText, "Edit Log Message", cx, move |this, window, cx| {
                this.edit_breakpoint(id, BreakpointField::LogMessage, window, cx)
            }))
            .child(row_action(ElementId::NamedInteger("debug-bp-remove".into(), id.0), IconName::X, "Remove", cx, move |this, _, cx| {
                this.store.update(cx, |store, cx| store.remove(id, cx))
            }));
        div()
            .id(ElementId::NamedInteger("debug-bp".into(), id.0))
            .group(group)
            .relative()
            .flex()
            .flex_col()
            .min_w_0()
            .mx(px(4.))
            .pl(px(2.))
            .pr(px(4.))
            .rounded(metrics::radius_md())
            .text_size(typography::text_sm())
            .hover(|style| style.bg(colors.accent))
            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.open_location(open_path.clone(), line, cx)))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .h(row_height())
                    .min_w_0()
                    .child(dot)
                    .child(
                        div()
                            .flex_none()
                            .max_w(px(200.))
                            .truncate()
                            .text_color(if breakpoint.enabled { colors.foreground } else { colors.subtle_foreground })
                            .child(format!("{}:{line}", file_name(path))),
                    )
                    .child(div().flex_1().min_w_0().truncate().text_color(colors.subtle_foreground).child(directory)),
            )
            .when_some(editing, |this, edit| {
                let label = match edit.field {
                    BreakpointField::Condition => "if",
                    BreakpointField::HitCondition => "hits",
                    BreakpointField::LogMessage => "log",
                };
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .mb(px(4.))
                        .ml(px(16.))
                        .px(px(6.))
                        .h(row_height())
                        .rounded(metrics::radius_md())
                        .bg(colors.field)
                        .border_1()
                        .border_color(colors.focus_ring)
                        .child(div().flex_none().text_color(colors.subtle_foreground).child(label))
                        .child(div().flex_1().min_w_0().child(edit.input.clone())),
                )
            })
            .when(editing.is_none() && !detail.is_empty(), |this| {
                this.child(
                    div()
                        .ml(px(16.))
                        .mb(px(4.))
                        .truncate()
                        .font_family(typography::MONO_FONT)
                        .text_color(if unverified { colors.warning } else { colors.muted_foreground })
                        .child(detail),
                )
            })
            .child(actions)
            .into_any_element()
    }

    fn render_breakpoints(&self, session: Option<&DebugSession>, cx: &Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let mut rows = Vec::new();
        if let Some(session) = session.filter(|session| session.is_active()) {
            for filter in session.capabilities().exception_breakpoint_filters.clone() {
                let enabled = session.exception_filter_enabled(&filter.filter);
                let name = filter.filter.clone();
                rows.push(
                    row(ElementId::Name(format!("debug-exception-{}", filter.filter).into()), 0, &colors)
                        .child(
                            div()
                                .flex()
                                .flex_none()
                                .size(px(14.))
                                .items_center()
                                .justify_center()
                                .rounded(metrics::radius())
                                .border_1()
                                .border_color(if enabled { colors.primary } else { colors.border_strong })
                                .when(enabled, |this| {
                                    this.bg(colors.primary).child(Icon::new(IconName::Check).size(IconSize::Custom(px(10.))).color(colors.primary_foreground))
                                }),
                        )
                        .child(div().flex_1().min_w_0().truncate().text_color(colors.muted_foreground).child(filter.label.clone()))
                        .when_some(filter.description.clone(), |this, description| this.anchored_tooltip({ let text: gpui::SharedString = (description).into(); move || ui::Tooltip::new(text.clone()) }))
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.set_exception_filter(name.clone(), !enabled, cx)))
                        .into_any_element(),
                );
            }
        }
        let files: Vec<(std::path::PathBuf, Vec<Breakpoint>)> =
            self.store.read(cx).files().map(|(path, breakpoints)| (path.to_path_buf(), breakpoints.to_vec())).collect();
        let root = self.project_root().to_path_buf();
        for (path, breakpoints) in &files {
            for breakpoint in breakpoints {
                rows.push(self.render_breakpoint(path, breakpoint, &root, cx));
            }
        }
        if files.is_empty() && rows.is_empty() {
            rows.push(empty(EMPTY_BREAKPOINTS, &colors));
        }
        rows
    }

    /// The adapter's output, with the evaluate field under it while a session runs.
    fn render_console(&self, session: Option<&DebugSession>, cx: &Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let lines: Vec<AnyElement> = session
            .map(|session| {
                session
                    .output()
                    .iter()
                    .enumerate()
                    .map(|(index, line)| {
                        let (color, prefix) = match line.category {
                            OutputCategory::Stdout | OutputCategory::Result => (colors.subtle_foreground, ""),
                            OutputCategory::Stderr | OutputCategory::Error => (colors.destructive, ""),
                            OutputCategory::Important => (colors.warning, ""),
                            OutputCategory::Input => (colors.muted_foreground, "› "),
                            OutputCategory::Console | OutputCategory::Log => (colors.subtle_foreground, ""),
                        };
                        div()
                            .id(ElementId::NamedInteger("debug-console-line".into(), index as u64))
                            .px(px(12.))
                            .py(px(4.))
                            .text_color(color)
                            .child(format!("{prefix}{}", line.text.trim_end()))
                            .into_any_element()
                    })
                    .collect()
            })
            .unwrap_or_default();
        let has_session = session.is_some_and(|session| session.is_active());
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .child(
                div()
                    .id("debug-console-output")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .track_scroll(&self.console_scroll)
                    .py(px(4.))
                    .font_family(typography::MONO_FONT)
                    .text_size(typography::text_sm())
                    .when(lines.is_empty(), |this| this.font_family(typography::ui_font()).child(empty(EMPTY_CONSOLE, &colors)))
                    .children(lines),
            )
            .when(has_session, |this| {
                this.child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .h(px(30.))
                        .px(px(8.))
                        .border_t_1()
                        .border_color(colors.divider)
                        .text_size(typography::text_sm())
                        .font_family(typography::MONO_FONT)
                        .child(div().flex_1().min_w_0().child(self.console_input.clone())),
                )
            })
            .into_any_element()
    }
}

impl Render for DebuggerView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let cx: &Context<Self> = cx;
        let session_entity = self.session.clone();
        let session = session_entity.as_ref().map(|session| session.read(cx));
        let colors = cx.theme().colors.clone();

        let bar = self.render_bar(session, cx).into_any_element();
        let aside = self.render_aside(session, cx).into_any_element();
        let content: AnyElement = match self.panel {
            Panel::Console => self.render_console(session, cx),
            panel => {
                let rows = match panel {
                    Panel::Stack => self.render_call_stack(session, cx),
                    Panel::Variables => self.render_variables(session, cx),
                    Panel::Watch => self.render_watches(session, cx),
                    _ => self.render_breakpoints(session, cx),
                };
                div()
                    .id("debug-panel-content")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .py(px(4.))
                    .gap(px(1.))
                    .children(rows)
                    .into_any_element()
            }
        };

        div()
            .key_context("DebuggerView")
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::on_start))
            .on_action(cx.listener(Self::on_stop))
            .on_action(cx.listener(Self::on_restart))
            .on_action(cx.listener(Self::on_pause))
            .on_action(cx.listener(Self::on_step_over))
            .on_action(cx.listener(Self::on_step_into))
            .on_action(cx.listener(Self::on_step_out))
            .on_action(cx.listener(Self::select_configuration))
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(colors.background)
            .text_color(colors.foreground)
            .font_family(typography::ui_font())
            .child(bar)
            .child(div().flex().flex_1().min_h_0().child(aside).child(div().flex().flex_col().flex_1().min_w_0().min_h_0().child(content)))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}
