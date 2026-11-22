use std::rc::Rc;

use gpui::{AnyElement, App, ClickEvent, ElementId, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, px};
use theme::ActiveTheme;

use crate::{Icon, IconName, IconSize, typography};

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;
type SegmentHandler = Rc<dyn Fn(usize, &ClickEvent, &mut Window, &mut App)>;

fn separator(cx: &App) -> impl IntoElement {
    div().flex_none().child(Icon::new(IconName::ChevronRight).size(IconSize::XSmall).color(cx.theme().colors.subtle_foreground))
}

/// Where something sits in a hierarchy (`ui/breadcrumb.tsx`): muted links, chevrons between, the
/// current page last.
#[derive(IntoElement)]
pub struct Breadcrumb {
    id: ElementId,
    items: Vec<(SharedString, Option<ClickHandler>)>,
}

impl Breadcrumb {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), items: Vec::new() }
    }

    pub fn item(mut self, label: impl Into<SharedString>, on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.items.push((label.into(), Some(Rc::new(on_click))));
        self
    }

    /// The current page: plain text in the foreground.
    pub fn page(mut self, label: impl Into<SharedString>) -> Self {
        self.items.push((label.into(), None));
        self
    }
}

impl RenderOnce for Breadcrumb {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let count = self.items.len();
        let mut children: Vec<AnyElement> = Vec::new();
        for (index, (label, handler)) in self.items.into_iter().enumerate() {
            if index > 0 {
                children.push(separator(cx).into_any_element());
            }
            let last = index + 1 == count;
            children.push(match handler {
                Some(handler) => div()
                    .id(index)
                    .rounded(crate::metrics::RADIUS)
                    .text_color(colors.muted_foreground)
                    .hover(|style| style.text_color(colors.foreground))
                    .on_click(move |event, window, cx| handler(event, window, cx))
                    .child(label)
                    .into_any_element(),
                None => div().text_color(if last { colors.foreground } else { colors.muted_foreground }).child(label).into_any_element(),
            });
        }
        div()
            .id(self.id)
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(6.))
            .text_size(typography::TEXT_SM)
            .text_color(colors.muted_foreground)
            .children(children)
    }
}

/// A file path as breadcrumb segments (`ui/path-breadcrumb.tsx`), each optionally clickable.
#[derive(IntoElement)]
pub struct PathBreadcrumb {
    id: ElementId,
    segments: Vec<SharedString>,
    icons: Vec<Option<IconName>>,
    interactive: bool,
    on_segment_click: Option<SegmentHandler>,
}

impl PathBreadcrumb {
    pub fn new(id: impl Into<ElementId>, segments: impl IntoIterator<Item = impl Into<SharedString>>) -> Self {
        Self {
            id: id.into(),
            segments: segments.into_iter().map(Into::into).collect(),
            icons: Vec::new(),
            interactive: false,
            on_segment_click: None,
        }
    }

    /// Splits `path` on `/`, dropping empty segments.
    pub fn from_path(id: impl Into<ElementId>, path: &str) -> Self {
        Self::new(id, path.split('/').filter(|segment| !segment.is_empty()).map(|segment| SharedString::from(segment.to_string())))
    }

    pub fn icons(mut self, icons: Vec<Option<IconName>>) -> Self {
        self.icons = icons;
        self
    }

    pub fn on_segment_click(mut self, handler: impl Fn(usize, &ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.interactive = true;
        self.on_segment_click = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for PathBreadcrumb {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let count = self.segments.len();
        let mut children: Vec<AnyElement> = Vec::new();
        for (index, segment) in self.segments.into_iter().enumerate() {
            if index > 0 {
                children.push(separator(cx).into_any_element());
            }
            let last = index + 1 == count;
            let text = if last { colors.foreground } else { colors.subtle_foreground };
            let icon = self.icons.get(index).copied().flatten();
            let content = div()
                .flex()
                .flex_none()
                .min_w_0()
                .items_center()
                .gap(px(4.))
                .whitespace_nowrap()
                .text_color(text)
                .children(icon.map(|icon| Icon::new(icon).size(IconSize::XSmall).color(text)))
                .child(div().truncate().child(segment));
            children.push(match (&self.on_segment_click, self.interactive) {
                (Some(handler), true) => {
                    let handler = handler.clone();
                    let hover = colors.accent;
                    let foreground = colors.foreground;
                    content
                        .id(index)
                        .h(px(20.))
                        .px(px(6.))
                        .rounded_full()
                        .hover(move |style| style.bg(hover).text_color(foreground))
                        .on_click(move |event, window, cx| handler(index, event, window, cx))
                        .into_any_element()
                }
                _ => content.px(px(4.)).into_any_element(),
            });
        }
        div()
            .id(self.id)
            .flex()
            .flex_nowrap()
            .items_center()
            .min_w_0()
            .overflow_hidden()
            .text_size(typography::TEXT_SM)
            .text_color(colors.muted_foreground)
            .children(children)
    }
}
