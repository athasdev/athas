//! Modal dialogs (`ui/dialog.tsx`, `ui/alert-dialog.tsx`). The workbench's modal layer draws the
//! scrim and places the dialog; these draw the card and handle its keys.

use std::rc::Rc;

use crate::scale::px;
use gpui::{
    AnyElement, App, BoxShadow, ClickEvent, Context, DismissEvent, ElementId, Entity, EventEmitter, FocusHandle,
    Focusable, KeyDownEvent, MouseButton, Pixels, SharedString, Window, div, point, prelude::*, relative,
};
use theme::ActiveTheme;

use crate::{Button, ButtonVariant, Icon, IconName, IconSize, TextInput, TextInputEvent, typography};

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DialogSize {
    /// 384px.
    Sm,
    /// 448px.
    #[default]
    Md,
    /// 512px.
    Lg,
    /// The settings window: up to 1152 by 768.
    Settings,
    /// A width the content asks for.
    Custom(Pixels),
}

/// How the dialog pads its body.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DialogLayout {
    #[default]
    Default,
    /// Fields spaced 16px apart.
    Form,
    /// No padding: content that brings its own.
    Flush,
}

/// The card a modal floats in: a title row with the close button, the body, then the footer's
/// buttons.
#[derive(IntoElement)]
pub struct Dialog {
    id: ElementId,
    title: SharedString,
    icon: Option<IconName>,
    size: DialogSize,
    layout: Option<DialogLayout>,
    scrollable: bool,
    hide_header: bool,
    header_actions: Vec<AnyElement>,
    footer: Vec<AnyElement>,
    children: Vec<AnyElement>,
    focus_handle: Option<FocusHandle>,
    on_close: Option<Handler>,
}

impl Dialog {
    pub fn new(id: impl Into<ElementId>, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            icon: None,
            size: DialogSize::default(),
            layout: None,
            scrollable: true,
            hide_header: false,
            header_actions: Vec::new(),
            footer: Vec::new(),
            children: Vec::new(),
            focus_handle: None,
            on_close: None,
        }
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn size(mut self, size: DialogSize) -> Self {
        self.size = size;
        self
    }

    pub fn layout(mut self, layout: DialogLayout) -> Self {
        self.layout = Some(layout);
        self
    }

    pub fn scrollable(mut self, scrollable: bool) -> Self {
        self.scrollable = scrollable;
        self
    }

    /// For content that brings its own header; the close button stays in the corner.
    pub fn hide_header(mut self) -> Self {
        self.hide_header = true;
        self
    }

    pub fn header_action(mut self, action: impl IntoElement) -> Self {
        self.header_actions.push(action.into_any_element());
        self
    }

    pub fn footer(mut self, footer: impl IntoIterator<Item = impl IntoElement>) -> Self {
        self.footer.extend(footer.into_iter().map(IntoElement::into_any_element));
        self
    }

    /// The dialog's view's focus: Escape inside it closes the dialog.
    pub fn track_focus(mut self, focus_handle: &FocusHandle) -> Self {
        self.focus_handle = Some(focus_handle.clone());
        self
    }

    pub fn on_close(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }

    fn close_button(&self) -> Button {
        let handler = self.on_close.clone();
        Button::icon("dialog-close", IconName::X).tooltip("Close dialog").on_click(move |_, window, cx| {
            if let Some(handler) = &handler {
                handler(window, cx);
            }
        })
    }
}

impl ParentElement for Dialog {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Dialog {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let viewport = window.viewport_size();
        let max_width = match self.size {
            DialogSize::Sm => px(384.),
            DialogSize::Md => px(448.),
            DialogSize::Lg => px(512.),
            DialogSize::Settings => px(1152.).min(viewport.width - px(64.)),
            DialogSize::Custom(width) => width,
        }
        .min(viewport.width - px(32.));
        let layout = self.layout.unwrap_or(if self.size == DialogSize::Settings && !self.scrollable {
            DialogLayout::Flush
        } else {
            DialogLayout::Default
        });
        let header_close = self.close_button();
        let corner_close = self.close_button();
        let Dialog { id, title, icon, size, scrollable, hide_header, header_actions, footer, children, focus_handle, on_close, .. } = self;

        let scroll = window.use_keyed_state((id.clone(), "dialog-scroll"), cx, |_, _| gpui::ScrollHandle::new()).read(cx).clone();
        let body = div()
            .id("dialog-body")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .when(scrollable, |this| this.overflow_y_scroll().track_scroll(&scroll))
            .map(|this| match layout {
                DialogLayout::Default => this.p(px(16.)),
                DialogLayout::Form => this.p(px(16.)).gap(px(16.)),
                DialogLayout::Flush => this,
            })
            .children(children);

        div()
            .id(id)
            .occlude()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .when_some(focus_handle, |this, handle| this.track_focus(&handle))
            .on_key_down(move |event: &KeyDownEvent, window, cx| {
                if event.keystroke.key == "escape"
                    && let Some(handler) = &on_close
                {
                    cx.stop_propagation();
                    handler(window, cx);
                }
            })
            .relative()
            .flex()
            .flex_col()
            .w_full()
            .max_w(max_width)
            .max_h(viewport.height * 0.9)
            .when(size == DialogSize::Settings, |this| this.h(px(768.).min(viewport.height - px(64.))))
            .overflow_hidden()
            .rounded(crate::metrics::overlay_radius())
            .bg(colors.overlay)
            .shadow(theme.shadows.dialog.clone())
            .font_family(typography::ui_font())
            .text_size(typography::text_sm())
            .text_color(colors.foreground)
            .when(!hide_header, |this| {
                this.child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_between()
                        .px(px(16.))
                        .py(px(12.))
                        .child(
                            div()
                                .flex()
                                .min_w_0()
                                .items_center()
                                .gap(px(8.))
                                .children(icon.map(|icon| Icon::new(icon).color(colors.muted_foreground)))
                                .child(
                                    div()
                                        .min_w_0()
                                        .truncate()
                                        .text_size(typography::text_base())
                                        .font_weight(typography::MEDIUM)
                                        .child(title),
                                ),
                        )
                        .child(div().flex().items_center().gap(px(4.)).children(header_actions).when(!hide_header, |this| this.child(header_close))),
                )
            })
            .map(|this| if scrollable { this.child(crate::with_scrollbar(body, crate::Scrollbar::new("dialog-scrollbar", &scroll))) } else { this.child(body) })
            .when(!footer.is_empty(), |this| {
                this.child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_end()
                        .gap(px(8.))
                        .px(px(16.))
                        .py(px(12.))
                        .children(footer),
                )
            })
            .when(hide_header, |this| this.child(div().absolute().top(px(10.)).right(px(10.)).child(corner_close)))
    }
}

/// The focus ring a keyboard-focused control wears, without moving it: 2px, enough to find
/// the focus by keyboard without the halo a 3px ring made.
pub fn focus_ring(focused: bool, cx: &App) -> gpui::Div {
    let ring = cx.theme().colors.focus_ring;
    div().flex_none().rounded_full().when(focused, |this| {
        this.shadow(vec![BoxShadow {
            color: ring,
            offset: point(px(0.), px(0.)),
            blur_radius: px(0.),
            spread_radius: px(2.),
            inset: false,
        }])
    })
}

/// A button in an alert dialog's footer.
pub struct AlertAction {
    label: SharedString,
    variant: ButtonVariant,
    cancel: bool,
    handler: Option<Handler>,
}

impl AlertAction {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self { label: label.into(), variant: ButtonVariant::Default, cancel: false, handler: None }
    }

    /// The button that dismisses without acting; Escape picks it too.
    pub fn cancel(label: impl Into<SharedString>) -> Self {
        Self { cancel: true, ..Self::new(label) }
    }

    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn on_click(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.handler = Some(Rc::new(handler));
        self
    }
}

/// A short question with its answers (`AlertDialog` and the `show*Dialog` helpers): an icon, a
/// title and a message over a row of buttons. Return presses the focused button, which starts on
/// the default one (on Cancel when the default destroys something); Tab and the arrows move it.
pub struct AlertDialog {
    focus_handle: FocusHandle,
    title: SharedString,
    message: SharedString,
    media: Option<IconName>,
    destructive_media: bool,
    actions: Vec<AlertAction>,
    focused: usize,
}

impl EventEmitter<DismissEvent> for AlertDialog {}

impl Focusable for AlertDialog {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

/// What a confirmation says on its buttons.
pub struct ConfirmOptions {
    pub confirm_label: SharedString,
    pub cancel_label: SharedString,
    /// The action deletes or discards something, so its button reads as dangerous.
    pub destructive: bool,
}

impl Default for ConfirmOptions {
    fn default() -> Self {
        Self { confirm_label: "Confirm".into(), cancel_label: "Cancel".into(), destructive: false }
    }
}

impl AlertDialog {
    pub fn new(title: impl Into<SharedString>, message: impl Into<SharedString>, cx: &mut Context<Self>) -> Self {
        Self {
            focus_handle: cx.focus_handle(),
            title: title.into(),
            message: message.into(),
            media: None,
            destructive_media: false,
            actions: Vec::new(),
            focused: 0,
        }
    }

    pub fn media(mut self, icon: IconName) -> Self {
        self.media = Some(icon);
        self
    }

    pub fn destructive_media(mut self) -> Self {
        self.destructive_media = true;
        self
    }

    pub fn action(mut self, action: AlertAction) -> Self {
        self.actions.push(action);
        self.focused = self.actions.len() - 1;
        self
    }

    /// Which button Return presses when the dialog opens.
    pub fn focus_action(mut self, index: usize) -> Self {
        self.focused = index.min(self.actions.len().saturating_sub(1));
        self
    }

    /// A notice with one OK button.
    pub fn alert(title: impl Into<SharedString>, message: impl Into<SharedString>, cx: &mut App) -> Entity<Self> {
        let (title, message) = (title.into(), message.into());
        cx.new(|cx| {
            Self::new(title, message, cx)
                .media(IconName::Info)
                .action(AlertAction::new("OK").variant(ButtonVariant::Accent))
        })
    }

    /// Cancel and a confirming button; `on_confirm` runs only for the latter.
    pub fn confirm(
        title: impl Into<SharedString>,
        message: impl Into<SharedString>,
        options: ConfirmOptions,
        on_confirm: impl Fn(&mut Window, &mut App) + 'static,
        cx: &mut App,
    ) -> Entity<Self> {
        let (title, message) = (title.into(), message.into());
        cx.new(|cx| {
            let dialog = Self::new(title, message, cx)
                .media(if options.destructive { IconName::Warning } else { IconName::Question })
                .action(AlertAction::cancel(options.cancel_label))
                .action(
                    AlertAction::new(options.confirm_label)
                        .variant(if options.destructive { ButtonVariant::Destructive } else { ButtonVariant::Accent })
                        .on_click(on_confirm),
                );
            if options.destructive { dialog.destructive_media().focus_action(0) } else { dialog }
        })
    }

    /// Cancel and several answers. The accent answer (or the last) is the default and sits
    /// rightmost; focus starts on Cancel when the default is destructive.
    pub fn choice(
        title: impl Into<SharedString>,
        message: impl Into<SharedString>,
        choices: Vec<AlertAction>,
        cx: &mut App,
    ) -> Entity<Self> {
        let (title, message) = (title.into(), message.into());
        cx.new(|cx| {
            let mut choices = choices;
            let default = choices
                .iter()
                .position(|choice| choice.variant == ButtonVariant::Accent)
                .or(choices.len().checked_sub(1));
            let destructive = default.is_some_and(|index| choices[index].variant == ButtonVariant::Destructive);
            if let Some(index) = default {
                let choice = choices.remove(index);
                choices.push(choice);
            }
            let mut dialog = Self::new(title, message, cx).media(IconName::Warning).action(AlertAction::cancel("Cancel"));
            for choice in choices {
                dialog = dialog.action(choice);
            }
            if default.is_none() || destructive { dialog.focus_action(0) } else { dialog }
        })
    }

    fn press(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let handler = self.actions.get(index).and_then(|action| action.handler.clone());
        cx.emit(DismissEvent);
        if let Some(handler) = handler {
            handler(window, cx);
        }
    }

    fn cancel(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match self.actions.iter().position(|action| action.cancel) {
            Some(index) => self.press(index, window, cx),
            None if self.actions.len() == 1 => self.press(0, window, cx),
            None => cx.emit(DismissEvent),
        }
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let count = self.actions.len().max(1);
        match event.keystroke.key.as_str() {
            "escape" => self.cancel(window, cx),
            "enter" | "space" => self.press(self.focused, window, cx),
            "tab" if event.keystroke.modifiers.shift => self.focused = (self.focused + count - 1) % count,
            "tab" | "right" => self.focused = (self.focused + 1) % count,
            "left" => self.focused = (self.focused + count - 1) % count,
            _ => return,
        }
        cx.stop_propagation();
        cx.notify();
    }
}

impl Render for AlertDialog {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let viewport = window.viewport_size();
        let buttons: Vec<AnyElement> = self
            .actions
            .iter()
            .enumerate()
            .map(|(index, action)| {
                focus_ring(index == self.focused, cx)
                    .child(Button::new(("alert-action", index), action.label.clone()).variant(action.variant).on_click(
                        cx.listener(move |this, _: &ClickEvent, window, cx| this.press(index, window, cx)),
                    ))
                    .into_any_element()
            })
            .collect();

        div()
            .id("alert-dialog")
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::on_key_down))
            .occlude()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .flex()
            .flex_col()
            .gap(px(20.))
            .w(px(384.).min(viewport.width - px(32.)))
            .p(px(16.))
            .rounded(crate::metrics::overlay_radius())
            .bg(colors.overlay)
            .shadow(theme.shadows.dialog.clone())
            .font_family(typography::ui_font())
            .text_color(colors.foreground)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .children(self.media.map(|icon| {
                        div().mb(px(4.)).size(px(20.)).flex().items_center().justify_center().child(
                            Icon::new(icon).size(IconSize::Custom(px(20.))).color(if self.destructive_media {
                                colors.destructive
                            } else {
                                colors.muted_foreground
                            }),
                        )
                    }))
                    .child(div().text_size(typography::text_base()).font_weight(typography::MEDIUM).child(self.title.clone()))
                    .child(
                        div()
                            .text_size(typography::text_sm())
                            .line_height(relative(1.625))
                            .text_color(colors.muted_foreground)
                            .child(self.message.clone()),
                    ),
            )
            .child(div().flex().justify_end().gap(px(8.)).children(buttons))
    }
}

type SubmitHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;

/// Asks for one line of text (`showPromptDialog`): the message over a field, Cancel and OK.
pub struct PromptDialog {
    title: SharedString,
    message: SharedString,
    confirm_label: SharedString,
    cancel_label: SharedString,
    input: Entity<TextInput>,
    on_submit: SubmitHandler,
    _subscription: gpui::Subscription,
}

impl EventEmitter<DismissEvent> for PromptDialog {}

impl Focusable for PromptDialog {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.input.focus_handle(cx)
    }
}

impl PromptDialog {
    pub fn new(
        title: impl Into<SharedString>,
        message: impl Into<SharedString>,
        default_value: impl Into<SharedString>,
        on_submit: impl Fn(SharedString, &mut Window, &mut App) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let default_value = default_value.into();
        let input = cx.new(|cx| {
            let mut input = TextInput::new(window, cx);
            input.set_text(default_value, cx);
            input.select_all_text(cx);
            input
        });
        let subscription = cx.subscribe_in(&input, window, |this, _, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Confirmed => this.submit(window, cx),
            TextInputEvent::Cancelled => cx.emit(DismissEvent),
            _ => {}
        });
        Self {
            title: title.into(),
            message: message.into(),
            confirm_label: "OK".into(),
            cancel_label: "Cancel".into(),
            input,
            on_submit: Rc::new(on_submit),
            _subscription: subscription,
        }
    }

    pub fn placeholder(self, placeholder: impl Into<SharedString>, cx: &mut Context<Self>) -> Self {
        self.input.update(cx, |input, cx| input.set_placeholder(placeholder, cx));
        self
    }

    pub fn labels(mut self, confirm: impl Into<SharedString>, cancel: impl Into<SharedString>) -> Self {
        self.confirm_label = confirm.into();
        self.cancel_label = cancel.into();
        self
    }

    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let value = self.input.read(cx).text().clone();
        cx.emit(DismissEvent);
        (self.on_submit)(value, window, cx);
    }
}

impl Render for PromptDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let dismiss = cx.listener(|_, _: &ClickEvent, _, cx| cx.emit(DismissEvent));
        let submit = cx.listener(|this, _: &ClickEvent, window, cx| this.submit(window, cx));
        let entity = cx.entity().downgrade();
        Dialog::new("prompt-dialog", self.title.clone())
            .icon(IconName::Warning)
            .size(DialogSize::Sm)
            .on_close(move |_, cx| {
                entity.update(cx, |_, cx| cx.emit(DismissEvent)).ok();
            })
            .footer([
                Button::new("prompt-cancel", self.cancel_label.clone()).on_click(dismiss).into_any_element(),
                Button::new("prompt-confirm", self.confirm_label.clone())
                    .variant(ButtonVariant::Accent)
                    .on_click(submit)
                    .into_any_element(),
            ])
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .text_size(typography::text_sm())
                    .text_color(colors.foreground)
                    .child(self.message.clone())
                    .child(self.input.clone()),
            )
    }
}
