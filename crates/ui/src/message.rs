use std::rc::Rc;

use crate::scale::px;
use gpui::{
    AnyElement, App, BoxShadow, ClickEvent, ElementId, IntoElement, RenderOnce, SharedString, Window, div, point, prelude::*, relative,
};
use theme::ActiveTheme;

use crate::{Button, ButtonSize, Icon, IconName, metrics, typography};

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

/// One turn of a conversation (`ui/message.tsx`): an avatar beside the content, mirrored for
/// the user's own turns.
#[derive(IntoElement)]
pub struct Message {
    end: bool,
    leading: Option<AnyElement>,
    footer: Vec<AnyElement>,
    children: Vec<AnyElement>,
}

impl Message {
    pub fn new() -> Self {
        Self { end: false, leading: None, footer: Vec::new(), children: Vec::new() }
    }

    /// The user's own turn: set against the far edge.
    pub fn end(mut self) -> Self {
        self.end = true;
        self
    }

    /// An avatar or mark beside the content.
    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }

    /// Quiet actions under the content, such as copy and retry.
    pub fn footer(mut self, actions: impl IntoIterator<Item = impl IntoElement>) -> Self {
        self.footer.extend(actions.into_iter().map(IntoElement::into_any_element));
        self
    }
}

impl Default for Message {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for Message {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Message {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let end = self.end;
        div()
            .flex()
            .w_full()
            .min_w_0()
            .gap(px(8.))
            .when(end, |this| this.flex_row_reverse())
            .font_family(typography::ui_font())
            .text_size(typography::text_sm())
            .children(self.leading)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .w_full()
                    .min_w_0()
                    .gap(px(6.))
                    .when(end, |this| this.items_end())
                    .child(
                        div()
                            .pr(px(4.))
                            .line_height(relative(1.625))
                            .text_color(colors.foreground)
                            .children(self.children),
                    )
                    .when(!self.footer.is_empty(), |this| {
                        this.child(
                            div()
                                .flex()
                                .items_center()
                                .min_h(px(24.))
                                .gap(px(2.))
                                .text_color(colors.subtle_foreground)
                                .when(end, |this| this.justify_end())
                                .children(self.footer),
                        )
                    }),
            )
    }
}

/// An icon button in a message's footer.
pub fn message_action(id: impl Into<ElementId>, icon: IconName, label: impl Into<SharedString>) -> Button {
    Button::icon(id, icon).size(ButtonSize::Small).tooltip(label)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AttachmentState {
    /// A dashed slot waiting for a file.
    Idle,
    Uploading,
    Processing,
    Error,
    #[default]
    Done,
}

/// A file attached to a message or composer (`ui/attachment.tsx`): a media square and its name.
#[derive(IntoElement)]
pub struct Attachment {
    id: ElementId,
    title: SharedString,
    description: Option<SharedString>,
    icon: Option<IconName>,
    media: Option<AnyElement>,
    state: AttachmentState,
    vertical: bool,
    trailing: Option<AnyElement>,
    on_click: Option<ClickHandler>,
}

impl Attachment {
    pub fn new(id: impl Into<ElementId>, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            description: None,
            icon: None,
            media: None,
            state: AttachmentState::Done,
            vertical: false,
            trailing: None,
            on_click: None,
        }
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    /// A thumbnail in place of the icon.
    pub fn media(mut self, media: impl IntoElement) -> Self {
        self.media = Some(media.into_any_element());
        self
    }

    pub fn state(mut self, state: AttachmentState) -> Self {
        self.state = state;
        self
    }

    /// A tile with the media above the name.
    pub fn vertical(mut self) -> Self {
        self.vertical = true;
        self
    }

    /// A control after the name, such as a remove button.
    pub fn trailing(mut self, element: impl IntoElement) -> Self {
        self.trailing = Some(element.into_any_element());
        self
    }

    pub fn on_click(mut self, handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Attachment {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let error = self.state == AttachmentState::Error;
        let idle = self.state == AttachmentState::Idle;
        let busy = matches!(self.state, AttachmentState::Uploading | AttachmentState::Processing);
        let has_media = self.icon.is_some() || self.media.is_some();
        let ring = BoxShadow {
            color: if error { colors.destructive } else { colors.divider },
            offset: point(px(0.), px(0.)),
            blur_radius: px(0.),
            spread_radius: px(1.),
            inset: false,
        };
        let media = has_media.then(|| {
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .overflow_hidden()
                .rounded(metrics::radius())
                .bg(if error { colors.destructive_soft } else { colors.accent })
                .map(|this| if self.vertical { this.w_full().h(px(80.)) } else { this.size(px(32.)) })
                .when(busy, |this| this.opacity(0.6))
                .children(self.icon.map(|icon| {
                    Icon::new(icon)
                        .size(crate::IconSize::Custom(if self.vertical { px(24.) } else { px(16.) }))
                        .color(if error { colors.destructive } else { colors.muted_foreground })
                }))
                .children(self.media)
        });
        let hover = colors.accent;
        div()
            .id(self.id)
            .relative()
            .flex()
            .flex_none()
            .min_w_0()
            .gap(px(8.))
            .rounded(metrics::radius_md())
            .bg(colors.surface)
            .text_color(colors.foreground)
            .font_family(typography::ui_font())
            .text_size(typography::text_sm())
            .map(|this| {
                if self.vertical {
                    this.flex_col().w(px(120.))
                } else {
                    this.items_center().max_w(px(256.))
                }
            })
            .map(|this| if has_media { this.p(px(6.)) } else { this.px(px(8.)).py(px(6.)) })
            .map(|this| if idle { this.border_1().border_dashed().border_color(colors.border_strong) } else { this.shadow(vec![ring]) })
            .when_some(self.on_click, |this, handler| {
                this.hover(move |style| style.bg(hover)).on_click(move |event, window, cx| handler(event, window, cx))
            })
            .children(media)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .line_height(relative(1.25))
                    .when(self.vertical, |this| this.px(px(4.)))
                    .child(div().min_w_0().truncate().font_weight(typography::MEDIUM).when(busy, |this| this.opacity(0.7)).child(self.title))
                    .children(self.description.map(|description| {
                        div()
                            .mt(px(2.))
                            .min_w_0()
                            .truncate()
                            .text_color(if error { colors.destructive } else { colors.subtle_foreground })
                            .child(description)
                    })),
            )
            .children(self.trailing)
    }
}

/// A resource's heading (`ResourceSummary` in `ui/resource.tsx`): an icon, the title and badges,
/// a description and meta line, with its actions at the top right.
#[derive(IntoElement)]
pub struct ResourceSummary {
    title: SharedString,
    icon: Option<AnyElement>,
    badges: Vec<AnyElement>,
    description: Option<SharedString>,
    meta: Vec<AnyElement>,
    actions: Vec<AnyElement>,
}

impl ResourceSummary {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self { title: title.into(), icon: None, badges: Vec::new(), description: None, meta: Vec::new(), actions: Vec::new() }
    }

    pub fn icon(mut self, icon: impl IntoElement) -> Self {
        self.icon = Some(icon.into_any_element());
        self
    }

    pub fn badge(mut self, badge: impl IntoElement) -> Self {
        self.badges.push(badge.into_any_element());
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn meta(mut self, meta: impl IntoElement) -> Self {
        self.meta.push(meta.into_any_element());
        self
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }
}

impl RenderOnce for ResourceSummary {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .items_start()
            .min_w_0()
            .gap(px(24.))
            .font_family(typography::ui_font())
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .min_w_0()
                            .gap(px(8.))
                            .children(self.icon.map(|icon| div().flex().flex_none().items_center().child(icon)))
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .text_size(typography::text_lg())
                                    .font_weight(typography::SEMIBOLD)
                                    .text_color(colors.foreground)
                                    .child(self.title),
                            )
                            .when(!self.badges.is_empty(), |this| this.child(div().flex().flex_none().items_center().gap(px(6.)).children(self.badges))),
                    )
                    .children(self.description.map(|description| {
                        div().mt(px(4.)).truncate().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(description)
                    }))
                    .when(!self.meta.is_empty(), |this| {
                        this.child(
                            div()
                                .mt(px(6.))
                                .flex()
                                .flex_wrap()
                                .items_center()
                                .gap_x(px(12.))
                                .gap_y(px(4.))
                                .text_size(typography::text_sm())
                                .text_color(colors.muted_foreground)
                                .children(self.meta),
                        )
                    }),
            )
            .when(!self.actions.is_empty(), |this| {
                this.child(div().flex().flex_none().items_center().justify_end().gap(px(4.)).children(self.actions))
            })
    }
}

/// A titled block of a resource page, with an action beside the title.
#[derive(IntoElement)]
pub struct ResourceSection {
    title: SharedString,
    action: Option<AnyElement>,
    children: Vec<AnyElement>,
}

impl ResourceSection {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self { title: title.into(), action: None, children: Vec::new() }
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }
}

impl ParentElement for ResourceSection {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for ResourceSection {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(12.))
            .font_family(typography::ui_font())
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .min_w_0()
                    .gap(px(8.))
                    .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.muted_foreground).child(self.title))
                    .children(self.action),
            )
            .child(div().min_w_0().children(self.children))
    }
}
