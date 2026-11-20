use std::rc::Rc;

use gpui::{App, ElementId, IntoElement, ParentElement, RenderOnce, Styled, Window, div, prelude::*, px};
use theme::ActiveTheme;

type ChangeHandler = Rc<dyn Fn(bool, &mut Window, &mut App)>;

/// An on/off switch: a 28×16 track with a white knob, the accent while on (`ui/switch.tsx`).
#[derive(IntoElement)]
pub struct Switch {
    id: ElementId,
    checked: bool,
    disabled: bool,
    on_change: Option<ChangeHandler>,
}

impl Switch {
    pub fn new(id: impl Into<ElementId>, checked: bool) -> Self {
        Self { id: id.into(), checked, disabled: false, on_change: None }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_change(mut self, handler: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Switch {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme();
        let colors = &theme.colors;
        let checked = self.checked;
        div()
            .id(self.id)
            .flex()
            .flex_none()
            .items_center()
            .w(px(28.))
            .h(px(16.))
            .p(px(2.))
            .rounded_full()
            .bg(if checked { colors.primary } else { colors.selected })
            .border_1()
            .border_color(if checked { colors.primary } else { colors.divider })
            .when(self.disabled, |this| this.opacity(0.5))
            .child(
                div()
                    .size(px(12.))
                    .ml(if checked { px(10.) } else { px(-1.) })
                    .rounded_full()
                    .bg(colors.knob)
                    .shadow(theme.shadows.raised.clone()),
            )
            .when_some(self.on_change.filter(|_| !self.disabled), |this, handler| {
                this.on_click(move |_, window, cx| handler(!checked, window, cx))
            })
    }
}
