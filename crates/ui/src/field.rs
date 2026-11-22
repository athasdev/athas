use gpui::{
    AnyElement, App, BoxShadow, FocusHandle, IntoElement, RenderOnce, SharedString, Window, div, point, prelude::*, px,
    relative,
};
use theme::ActiveTheme;

use crate::typography;

/// A control's name (`ui/label.tsx`).
#[derive(IntoElement)]
pub struct Label {
    text: SharedString,
    disabled: bool,
}

impl Label {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self { text: text.into(), disabled: false }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

impl RenderOnce for Label {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .text_size(typography::TEXT_SM)
            .font_weight(typography::MEDIUM)
            .line_height(relative(1.375))
            .text_color(cx.theme().colors.foreground)
            .when(self.disabled, |this| this.opacity(0.5))
            .child(self.text)
    }
}

/// A hairline between groups (`ui/separator.tsx`).
#[derive(IntoElement)]
pub struct Separator {
    vertical: bool,
}

impl Separator {
    pub fn horizontal() -> Self {
        Self { vertical: false }
    }

    pub fn vertical() -> Self {
        Self { vertical: true }
    }
}

impl RenderOnce for Separator {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let line = div().flex_none().bg(cx.theme().colors.divider);
        if self.vertical { line.w(px(1.)).h_full() } else { line.h(px(1.)).w_full() }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FieldOrientation {
    /// Label, control, then description, stacked.
    #[default]
    Vertical,
    /// Label and description on the left, the control on the right, as a settings row.
    Horizontal,
}

/// A control with its label, description and error (`ui/field.tsx`).
#[derive(IntoElement)]
pub struct Field {
    label: Option<SharedString>,
    description: Option<SharedString>,
    error: Option<SharedString>,
    control: Option<AnyElement>,
    orientation: FieldOrientation,
    disabled: bool,
}

impl Field {
    pub fn new() -> Self {
        Self { label: None, description: None, error: None, control: None, orientation: FieldOrientation::Vertical, disabled: false }
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn error(mut self, error: Option<impl Into<SharedString>>) -> Self {
        self.error = error.map(Into::into);
        self
    }

    pub fn control(mut self, control: impl IntoElement) -> Self {
        self.control = Some(control.into_any_element());
        self
    }

    pub fn orientation(mut self, orientation: FieldOrientation) -> Self {
        self.orientation = orientation;
        self
    }

    pub fn horizontal(self) -> Self {
        self.orientation(FieldOrientation::Horizontal)
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

impl Default for Field {
    fn default() -> Self {
        Self::new()
    }
}

impl RenderOnce for Field {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let title = self.label.map(|label| {
            div()
                .text_size(typography::TEXT_SM)
                .font_weight(typography::MEDIUM)
                .line_height(relative(1.375))
                .text_color(colors.foreground)
                .when(self.disabled, |this| this.opacity(0.5))
                .child(label)
        });
        let description = self.description.map(|description| {
            div().text_size(typography::TEXT_SM).line_height(relative(1.5)).text_color(colors.muted_foreground).child(description)
        });
        let error = self.error.map(|error| div().text_size(typography::TEXT_SM).text_color(colors.destructive).child(error));
        let field = div().flex().w_full().gap(px(8.)).font_family(typography::UI_FONT);
        match self.orientation {
            FieldOrientation::Vertical => field.flex_col().children(title).children(self.control).children(description).children(error),
            FieldOrientation::Horizontal => field
                .items_center()
                .when(description.is_some(), |this| this.items_start())
                .child(div().flex().flex_col().flex_1().min_w_0().gap(px(2.)).children(title).children(description).children(error))
                .children(self.control.map(|control| div().flex_none().child(control))),
        }
    }
}

/// A hairline across a form, with an optional word in its middle such as "or".
#[derive(IntoElement)]
pub struct FieldSeparator {
    label: Option<SharedString>,
}

impl FieldSeparator {
    pub fn new(label: Option<SharedString>) -> Self {
        Self { label }
    }
}

impl RenderOnce for FieldSeparator {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .relative()
            .flex()
            .items_center()
            .justify_center()
            .h(px(20.))
            .text_size(typography::TEXT_SM)
            .text_color(colors.subtle_foreground)
            .child(div().absolute().left_0().right_0().top(px(10.)).h(px(1.)).bg(colors.divider))
            .children(self.label.map(|label| div().relative().px(px(8.)).bg(colors.background).child(label)))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InputGroupVariant {
    #[default]
    Default,
    Surface,
}

/// A field with text or buttons attached inside its edges (`ui/input-group.tsx`). Pass the
/// inner control (a bare `TextInput` or a ghost `TextArea`) and its focus handle, so the group
/// wears the focus ring for it.
#[derive(IntoElement)]
pub struct InputGroup {
    variant: InputGroupVariant,
    start: Vec<AnyElement>,
    end: Vec<AnyElement>,
    block_start: Option<AnyElement>,
    block_end: Option<AnyElement>,
    control: Option<AnyElement>,
    focus: Option<FocusHandle>,
    multiline: bool,
    invalid: bool,
    disabled: bool,
}

impl InputGroup {
    pub fn new(control: impl IntoElement) -> Self {
        Self {
            variant: InputGroupVariant::Default,
            start: Vec::new(),
            end: Vec::new(),
            block_start: None,
            block_end: None,
            control: Some(control.into_any_element()),
            focus: None,
            multiline: false,
            invalid: false,
            disabled: false,
        }
    }

    pub fn variant(mut self, variant: InputGroupVariant) -> Self {
        self.variant = variant;
        self
    }

    /// Text, an icon or a button before the control.
    pub fn start(mut self, addon: impl IntoElement) -> Self {
        self.start.push(addon.into_any_element());
        self
    }

    pub fn end(mut self, addon: impl IntoElement) -> Self {
        self.end.push(addon.into_any_element());
        self
    }

    /// A row above the control; the group rounds like a card.
    pub fn block_start(mut self, addon: impl IntoElement) -> Self {
        self.block_start = Some(addon.into_any_element());
        self
    }

    /// A row of actions under the control, as a composer's.
    pub fn block_end(mut self, addon: impl IntoElement) -> Self {
        self.block_end = Some(addon.into_any_element());
        self
    }

    pub fn focus_handle(mut self, focus: &FocusHandle) -> Self {
        self.focus = Some(focus.clone());
        self
    }

    /// For a text area inside.
    pub fn multiline(mut self) -> Self {
        self.multiline = true;
        self
    }

    pub fn invalid(mut self, invalid: bool) -> Self {
        self.invalid = invalid;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

/// Muted text or an icon inside an input group's edge.
pub fn input_group_text(text: impl Into<SharedString>, cx: &App) -> gpui::Div {
    div()
        .flex()
        .items_center()
        .gap(px(8.))
        .text_size(typography::TEXT_SM)
        .font_weight(typography::MEDIUM)
        .text_color(cx.theme().colors.muted_foreground)
        .child(text.into())
}

impl RenderOnce for InputGroup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let focused = self.focus.as_ref().is_some_and(|focus| focus.contains_focused(window, cx));
        let ring = |color, spread| BoxShadow { color, offset: point(px(0.), px(0.)), blur_radius: px(0.), spread_radius: px(spread), inset: false };
        let mut shadow = if self.variant == InputGroupVariant::Default { theme.shadows.raised.clone() } else { Vec::new() };
        if focused {
            shadow.push(ring(colors.focus_ring, 1.));
        } else if self.invalid {
            shadow.push(ring(colors.destructive, 1.));
        }
        let block = self.multiline || self.block_start.is_some() || self.block_end.is_some();
        let addon = |side: &str, children: Vec<AnyElement>| {
            (!children.is_empty()).then(|| {
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .gap(px(8.))
                    .py(px(4.))
                    .when(side == "start", |this| this.pl(px(8.)))
                    .when(side == "end", |this| this.pr(px(8.)))
                    .text_size(typography::TEXT_SM)
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.muted_foreground)
                    .children(children)
            })
        };
        let control = div()
            .flex_1()
            .min_w_0()
            .when(!self.multiline, |this| this.px(px(12.)).py(px(4.)))
            .when(self.multiline, |this| this.px(px(8.)).py(px(4.)))
            .children(self.control);
        let row = div().flex().items_center().w_full().min_w_0().children(addon("start", self.start)).child(control).children(addon("end", self.end));
        div()
            .relative()
            .flex()
            .w_full()
            .min_w_0()
            .min_h(px(28.))
            .font_family(typography::UI_FONT)
            .text_size(typography::TEXT_SM)
            .text_color(colors.foreground)
            .when(self.variant == InputGroupVariant::Default, |this| this.bg(colors.raised))
            .when(self.variant == InputGroupVariant::Surface, |this| this.bg(colors.surface))
            .when(!shadow.is_empty(), |this| this.shadow(shadow))
            .when(self.disabled, |this| this.opacity(0.5))
            .map(|this| if block { this.flex_col().rounded(crate::metrics::RADIUS_LG) } else { this.items_center().rounded_full() })
            .children(self.block_start.map(|addon| div().flex().items_center().w_full().px(px(10.)).pt(px(8.)).child(addon)))
            .child(row)
            .children(self.block_end.map(|addon| div().flex().items_center().w_full().px(px(10.)).pb(px(8.)).child(addon)))
    }
}
