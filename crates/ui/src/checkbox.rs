use std::rc::Rc;

use gpui::{App, ElementId, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, px};
use theme::ActiveTheme;

use crate::{Icon, IconName, IconSize, typography};

type ChangeHandler = Rc<dyn Fn(bool, &mut Window, &mut App)>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CheckboxSize {
    /// The form control: 16px.
    #[default]
    Md,
    /// The quiet in-row control for dense lists such as staging rows: 12px, a hairline edge.
    Sm,
}

/// A checkbox (`ui/checkbox.tsx`), with an optional label that toggles it too.
#[derive(IntoElement)]
pub struct Checkbox {
    id: ElementId,
    checked: bool,
    size: CheckboxSize,
    disabled: bool,
    invalid: bool,
    label: Option<SharedString>,
    forced_hover: bool,
    on_change: Option<ChangeHandler>,
}

impl Checkbox {
    pub fn new(id: impl Into<ElementId>, checked: bool) -> Self {
        Self { id: id.into(), checked, size: CheckboxSize::Md, disabled: false, invalid: false, label: None, forced_hover: false, on_change: None }
    }

    /// Draws the hover state without the pointer (state galleries and snapshots).
    pub fn force_hover(mut self, hovered: bool) -> Self {
        self.forced_hover = hovered;
        self
    }

    pub fn size(mut self, size: CheckboxSize) -> Self {
        self.size = size;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn invalid(mut self, invalid: bool) -> Self {
        self.invalid = invalid;
        self
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn on_change(mut self, handler: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Checkbox {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let checked = self.checked;
        let (size, check, border, hover_border) = match self.size {
            CheckboxSize::Md => (px(16.), px(14.), colors.border_strong, colors.foreground),
            CheckboxSize::Sm => (px(12.), px(10.), colors.border, colors.border_strong),
        };
        let border = if checked {
            colors.primary
        } else if self.invalid {
            colors.destructive
        } else {
            border
        };
        let group = SharedString::from(format!("checkbox-{}", self.id));
        let hover_border = if checked { colors.primary } else { hover_border };
        let box_ = div()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(size)
            .rounded(crate::metrics::RADIUS)
            .border_1()
            .border_color(if self.forced_hover && !self.disabled { hover_border } else { border })
            .bg(if checked { colors.primary } else { colors.surface })
            .when(!self.disabled, |this| this.group_hover(group.clone(), move |style| style.border_color(hover_border)))
            .when(checked, |this| this.child(Icon::new(IconName::Check).size(IconSize::Custom(check)).color(colors.primary_foreground)));
        div()
            .id(self.id)
            .group(group)
            .flex()
            .flex_none()
            .items_center()
            .gap(px(8.))
            .when(self.disabled, |this| this.opacity(0.5))
            .child(box_)
            .children(self.label.map(|label| {
                div()
                    .text_size(typography::TEXT_SM)
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.foreground)
                    .child(label)
            }))
            .when_some(self.on_change.filter(|_| !self.disabled), |this, handler| {
                this.on_click(move |_, window, cx| handler(!checked, window, cx))
            })
    }
}
