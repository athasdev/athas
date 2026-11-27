//! The writing pieces the views share: the Markdown field (`markdown::MarkdownField`) under the
//! names this panel uses, the label and assignee pickers (`github-metadata-pickers.tsx`), and the
//! confirmation a view floats over itself.

use crate::gh::Label;
use ui::scale::px;
use gpui::{
    Anchor, AnyView, App, ClickEvent, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, KeyDownEvent, Pixels, Point, Render,
    SharedString, Subscription, Window, anchored, deferred, div, prelude::*,
};
use theme::{ActiveTheme, ThemeColors};
use ui::{AlertDialog, Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, InputAppearance, TextInput, TextInputEvent, metrics, typography};

use crate::{menus, mutation, widgets};

/// The one editable Markdown field in Athas; the panel's views know it under these names.
pub use markdown::{FieldEvent as EditorEvent, MarkdownField as MarkdownEditor};

/// "Markdown supported · ⌘↵ to send" under a composer.
pub fn composer_hint(action: &str, colors: &ThemeColors) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap(px(6.))
        .text_size(typography::text_sm())
        .text_color(colors.subtle_foreground)
        .child("Markdown supported")
        .child(ui::Kbd::new("⌘↩"))
        .child(format!("to {action}"))
}

/// The new-comment box at the bottom of a conversation: the viewer's avatar on the timeline,
/// the field, then the hint and the button.
#[allow(clippy::too_many_arguments)]
pub fn composer(
    id: &str,
    editor: &Entity<MarkdownEditor>,
    current_user: Option<&str>,
    busy: bool,
    can_submit: bool,
    error: Option<SharedString>,
    on_submit: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    colors: &ThemeColors,
) -> impl IntoElement {
    let marker = match current_user {
        Some(login) => widgets::avatar(login, 24.).into_any_element(),
        None => div().into_any_element(),
    };
    div()
        .flex()
        .items_start()
        .gap(px(12.))
        .min_w_0()
        .child(div().mt(px(8.)).child(widgets::timeline_marker(marker, colors)))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(8.))
                .child(editor.clone())
                .child(
                    div().flex().flex_wrap().items_center().justify_between().gap(px(8.)).child(composer_hint("send", colors)).child(
                        Button::new(SharedString::from(format!("{id}-submit")), if busy { "Posting…" } else { "Comment" })
                            .variant(if can_submit { ButtonVariant::Accent } else { ButtonVariant::Default })
                            .size(ButtonSize::Small)
                            .disabled(!can_submit || busy)
                            .on_click(on_submit),
                    ),
                )
                .children(error.map(|error| div().text_size(typography::text_sm()).text_color(colors.destructive).child(error))),
        )
}

/// Cancel and Save under an inline editor.
pub fn save_row(id: &str, busy: bool, can_save: bool, save_label: &str, on_cancel: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static, on_save: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> impl IntoElement {
    div()
        .flex()
        .justify_end()
        .gap(px(8.))
        .child(Button::new(SharedString::from(format!("{id}-cancel")), "Cancel").variant(ButtonVariant::Ghost).size(ButtonSize::Small).disabled(busy).shortcut("⎋").on_click(on_cancel))
        .child(
            Button::new(SharedString::from(format!("{id}-save")), if busy { "Saving…".to_string() } else { save_label.to_string() })
                .variant(ButtonVariant::Accent)
                .size(ButtonSize::Small)
                .disabled(busy || !can_save)
                .shortcut("⌘↩")
                .on_click(on_save),
        )
}

#[derive(Clone, Debug, PartialEq)]
pub enum PickerEvent {
    Changed(Vec<String>),
}

/// The repository's labels with a search field; each click adds or removes one.
pub struct LabelPicker {
    focus_handle: FocusHandle,
    search: Entity<TextInput>,
    labels: Vec<Label>,
    selected: Vec<String>,
    loading: bool,
    highlighted: usize,
    _subscription: Subscription,
}

impl EventEmitter<PickerEvent> for LabelPicker {}
impl EventEmitter<DismissEvent> for LabelPicker {}

impl Focusable for LabelPicker {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.search.focus_handle(cx)
    }
}

impl LabelPicker {
    pub fn new(labels: Vec<Label>, selected: Vec<String>, loading: bool, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| TextInput::new(window, cx).placeholder("Search labels").appearance(InputAppearance::Bare).leading_icon(IconName::Search));
        let subscription = cx.subscribe_in(&search, window, |this, _, event: &TextInputEvent, _, cx| match event {
            TextInputEvent::Changed(_) => {
                this.highlighted = 0;
                cx.notify();
            }
            TextInputEvent::Confirmed => {
                if let Some(name) = this.matching(cx).get(this.highlighted).map(|label| label.name.clone()) {
                    this.toggle(&name, cx);
                }
            }
            TextInputEvent::Cancelled => cx.emit(DismissEvent),
            _ => {}
        });
        window.focus(&search.focus_handle(cx), cx);
        Self { focus_handle: cx.focus_handle(), search, labels, selected, loading, highlighted: 0, _subscription: subscription }
    }

    fn matching(&self, cx: &App) -> Vec<&Label> {
        let query = self.search.read(cx).text().trim().to_lowercase();
        self.labels.iter().filter(|label| query.is_empty() || label.name.to_lowercase().contains(&query)).collect()
    }

    fn toggle(&mut self, name: &str, cx: &mut Context<Self>) {
        self.selected = mutation::toggle(&self.selected, name);
        cx.emit(PickerEvent::Changed(self.selected.clone()));
        cx.notify();
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let count = self.matching(cx).len();
        match event.keystroke.key.as_str() {
            "down" if count > 0 => self.highlighted = (self.highlighted + 1) % count,
            "up" if count > 0 => self.highlighted = (self.highlighted + count - 1) % count,
            _ => return,
        }
        cx.stop_propagation();
        cx.notify();
    }
}

impl Render for LabelPicker {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let matching: Vec<Label> = self.matching(cx).into_iter().cloned().collect();
        let empty = if self.loading { "Loading labels..." } else { "No matching labels" };
        popover_frame("label-picker", &self.focus_handle, &theme, cx)
            .on_key_down(cx.listener(Self::on_key_down))
            .child(div().p(px(4.)).border_b_1().border_color(colors.divider).child(self.search.clone()))
            .child(
                div()
                    .id("label-picker-list")
                    .flex()
                    .flex_col()
                    .max_h(px(280.))
                    .overflow_y_scroll()
                    .p(px(4.))
                    .when(matching.is_empty(), |this| this.child(div().px(px(8.)).py(px(6.)).text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(empty)))
                    .children(matching.into_iter().enumerate().map(|(index, label)| {
                        let checked = self.selected.contains(&label.name);
                        let highlighted = index == self.highlighted;
                        let name = label.name.clone();
                        let swatch = crate::model::label_rgb(&label.color).map(|(r, g, b)| gpui::Rgba { r, g, b, a: 1. }.into()).unwrap_or(colors.subtle_foreground);
                        div()
                            .id(SharedString::from(format!("label-option-{index}")))
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .h(metrics::list_row())
                            .px(px(8.))
                            .rounded(metrics::radius_md())
                            .text_size(typography::text_sm())
                            .text_color(if highlighted { colors.primary_foreground } else { colors.foreground })
                            // The pointer moves the same cursor the keys do, as `ui::Select` does:
                            // one highlight, never a hovered row beside a highlighted one.
                            .when(highlighted, |this| this.bg(colors.primary))
                            .when(!highlighted && checked, |this| this.bg(colors.selected))
                            .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                                if *hovered && this.highlighted != index {
                                    this.highlighted = index;
                                    cx.notify();
                                }
                            }))
                            .child(div().size(px(10.)).flex_none().rounded_full().bg(swatch))
                            .child(div().flex_1().min_w_0().truncate().child(label.name.clone()))
                            .when(checked, |this| this.child(Icon::new(IconName::Check).size(IconSize::Small).color(if highlighted { colors.primary_foreground } else { colors.primary })))
                            .on_click(cx.listener(move |this, _, _, cx| this.toggle(&name, cx)))
                    })),
            )
    }
}

/// Usernames typed in, added on Return or comma, removed by clicking them.
pub struct AssigneePicker {
    focus_handle: FocusHandle,
    input: Entity<TextInput>,
    value: Vec<String>,
    _subscription: Subscription,
}

impl EventEmitter<PickerEvent> for AssigneePicker {}
impl EventEmitter<DismissEvent> for AssigneePicker {}

impl Focusable for AssigneePicker {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.input.focus_handle(cx)
    }
}

impl AssigneePicker {
    pub fn new(value: Vec<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| TextInput::new(window, cx).placeholder("GitHub username"));
        let subscription = cx.subscribe_in(&input, window, |this, input, event: &TextInputEvent, _, cx| match event {
            TextInputEvent::Changed(text) if text.ends_with(',') => this.add(cx),
            TextInputEvent::Confirmed => this.add(cx),
            TextInputEvent::Cancelled if input.read(cx).text().is_empty() => cx.emit(DismissEvent),
            TextInputEvent::Cancelled => input.update(cx, |input, cx| input.set_text("", cx)),
            _ => {}
        });
        window.focus(&input.focus_handle(cx), cx);
        Self { focus_handle: cx.focus_handle(), input, value, _subscription: subscription }
    }

    fn add(&mut self, cx: &mut Context<Self>) {
        let draft = self.input.read(cx).text().to_string();
        let next = mutation::add_assignees(&self.value, &draft);
        self.input.update(cx, |input, cx| input.set_text("", cx));
        if next != self.value {
            self.value = next;
            cx.emit(PickerEvent::Changed(self.value.clone()));
        }
        cx.notify();
    }

    fn remove(&mut self, login: &str, cx: &mut Context<Self>) {
        self.value.retain(|candidate| candidate != login);
        cx.emit(PickerEvent::Changed(self.value.clone()));
        cx.notify();
    }
}

impl Render for AssigneePicker {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let empty_draft = self.input.read(cx).text().trim().is_empty();
        popover_frame("assignee-picker", &self.focus_handle, &theme, cx)
            .gap(px(8.))
            .p(px(8.))
            .child(
                div().flex().items_center().gap(px(6.)).child(div().flex_1().min_w_0().child(self.input.clone())).child(
                    Button::icon("assignee-add", IconName::Plus).size(ButtonSize::Small).tooltip("Add assignee").disabled(empty_draft).on_click(cx.listener(|this, _, _, cx| this.add(cx))),
                ),
            )
            .child(if self.value.is_empty() {
                div().px(px(4.)).text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("Type one or more GitHub usernames, then press Enter.").into_any_element()
            } else {
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(4.))
                    .children(self.value.iter().enumerate().map(|(index, login)| {
                        let login = login.clone();
                        Button::new(SharedString::from(format!("assignee-remove-{index}")), format!("@{login}"))
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .trailing_icon(IconName::X)
                            .tooltip(format!("Remove @{login}"))
                            .on_click(cx.listener(move |this, _, _, cx| this.remove(&login, cx)))
                    }))
                    .into_any_element()
            })
    }
}

/// The floating box a picker draws in; a click outside or Escape closes it.
fn popover_frame<V: EventEmitter<DismissEvent>>(id: &'static str, focus_handle: &FocusHandle, theme: &theme::Theme, cx: &mut Context<V>) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .track_focus(focus_handle)
        .occlude()
        .flex()
        .flex_col()
        .w(px(280.))
        .rounded(metrics::radius_lg())
        .bg(theme.colors.overlay)
        .shadow(theme.shadows.popover.clone())
        .font_family(typography::ui_font())
        .text_color(theme.colors.foreground)
        .on_mouse_down_out(cx.listener(|_, _, _, cx| cx.emit(DismissEvent)))
        .on_key_down(cx.listener(|_, event: &KeyDownEvent, _, cx| {
            if event.keystroke.key == "escape" {
                cx.emit(DismissEvent);
            }
        }))
}

/// A picker open over a view, hanging from the button that opened it.
pub struct Popover {
    pub key: &'static str,
    pub view: AnyView,
    position: Point<Pixels>,
    _subscriptions: Vec<Subscription>,
}

impl Popover {
    pub fn new(key: &'static str, view: AnyView, position: Point<Pixels>, subscriptions: Vec<Subscription>) -> Self {
        Self { key, view, position, _subscriptions: subscriptions }
    }

    pub fn render(&self) -> impl IntoElement {
        deferred(anchored().position(self.position).anchor(Anchor::TopRight).snap_to_window_with_margin(px(8.)).child(div().mt(px(4.)).child(self.view.clone()))).with_priority(1)
    }
}

/// Where a popover opened from a button hangs.
pub fn popover_position(event: &ClickEvent) -> Point<Pixels> {
    menus::below(event)
}

/// A confirmation floated over a view, with the scrim behind it.
pub struct Confirmation {
    dialog: Entity<AlertDialog>,
    _subscription: Subscription,
}

pub trait ConfirmHost: Focusable + Sized + 'static {
    fn confirmation_slot(&mut self) -> &mut Option<Confirmation>;
}

/// Asks before doing something that cannot be undone; `on_confirm` runs on the view.
#[allow(clippy::too_many_arguments)]
pub fn confirm<V: ConfirmHost>(
    this: &mut V,
    title: &str,
    message: &str,
    confirm_label: &str,
    destructive: bool,
    window: &mut Window,
    cx: &mut Context<V>,
    on_confirm: impl Fn(&mut V, &mut Window, &mut Context<V>) + 'static,
) {
    let view = cx.entity().downgrade();
    let dialog = AlertDialog::confirm(
        title.to_string(),
        message.to_string(),
        ui::ConfirmOptions { confirm_label: confirm_label.to_string().into(), cancel_label: "Cancel".into(), destructive },
        move |window, cx| {
            view.update(cx, |this, cx| on_confirm(this, window, cx)).ok();
        },
        cx,
    );
    host(this, dialog, window, cx);
}

/// Floats `dialog` over the view until it is answered. Answering it hands the keyboard back to
/// the view underneath: the dialog is gone, and a window with nothing focused answers no key.
pub fn host<V: ConfirmHost>(this: &mut V, dialog: Entity<AlertDialog>, window: &mut Window, cx: &mut Context<V>) {
    let subscription = cx.subscribe_in(&dialog, window, |this: &mut V, _, _: &DismissEvent, window, cx| {
        *this.confirmation_slot() = None;
        window.focus(&this.focus_handle(cx), cx);
        cx.notify();
    });
    window.focus(&dialog.focus_handle(cx), cx);
    *this.confirmation_slot() = Some(Confirmation { dialog, _subscription: subscription });
    cx.notify();
}

impl Confirmation {
    pub fn render(&self, cx: &App) -> impl IntoElement {
        let scrim = cx.theme().colors.scrim;
        deferred(div().id("github-confirm-layer").absolute().inset_0().bg(scrim).flex().items_center().justify_center().occlude().child(self.dialog.clone())).with_priority(2)
    }
}
