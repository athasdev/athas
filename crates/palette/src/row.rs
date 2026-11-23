use ui::scale::px;
use gpui::{AnyElement, App, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, prelude::*,};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, Kbd, metrics, typography};

/// One result in a picker: an icon, a title with a quiet description under or beside it, and an
/// accessory such as a shortcut. The selected row takes the accent fill.
#[derive(IntoElement)]
pub struct PaletteRow {
    title: SharedString,
    description: Option<SharedString>,
    icon: Option<IconName>,
    icon_path: Option<&'static str>,
    file: Option<SharedString>,
    leading: Option<AnyElement>,
    shortcut: Option<SharedString>,
    accessory: Option<AnyElement>,
    badge: Option<SharedString>,
    /// Quiet text at the row's end, such as a date or a short hash.
    meta: Option<SharedString>,
    title_element: Option<AnyElement>,
    selected: bool,
    stacked: bool,
    highlights: Vec<usize>,
}

impl PaletteRow {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            description: None,
            icon: None,
            icon_path: None,
            file: None,
            leading: None,
            shortcut: None,
            accessory: None,
            badge: None,
            meta: None,
            title_element: None,
            selected: false,
            stacked: true,
            highlights: Vec::new(),
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

    pub fn icon_path(mut self, path: &'static str) -> Self {
        self.icon_path = Some(path);
        self
    }

    /// The icon theme's icon for a file name, or the generic file icon.
    pub fn file_icon(mut self, name: impl Into<SharedString>) -> Self {
        self.file = Some(name.into());
        self.icon = Some(IconName::File);
        self
    }

    /// Draws `element` where the icon goes, such as a theme's colours.
    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }

    pub fn shortcut(mut self, shortcut: Option<impl Into<SharedString>>) -> Self {
        self.shortcut = shortcut.map(Into::into);
        self
    }

    /// Controls at the row's end, such as per-row action buttons.
    pub fn accessory(mut self, element: impl IntoElement) -> Self {
        self.accessory = Some(element.into_any_element());
        self
    }

    /// Draws `element` in place of the title, such as a field renaming the row.
    pub fn title_element(mut self, element: impl IntoElement) -> Self {
        self.title_element = Some(element.into_any_element());
        self
    }

    /// Quiet text at the row's end, such as a date or a short hash. A shortcut is drawn as a
    /// key chip; meta is plain text, since "2d ago" is not a chord.
    pub fn meta(mut self, meta: impl Into<SharedString>) -> Self {
        self.meta = Some(meta.into());
        self
    }

    pub fn badge(mut self, badge: impl Into<SharedString>) -> Self {
        self.badge = Some(badge.into());
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    /// Puts the description beside the title instead of under it.
    pub fn inline(mut self) -> Self {
        self.stacked = false;
        self
    }

    /// Byte offsets of the title's characters the query matched, drawn stronger.
    pub fn highlights(mut self, positions: Vec<usize>) -> Self {
        self.highlights = positions;
        self
    }
}

impl RenderOnce for PaletteRow {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let (text, muted, subtle) = if self.selected {
            (colors.primary_foreground, colors.primary_foreground, colors.primary_foreground.opacity(0.8))
        } else {
            (colors.foreground, colors.muted_foreground, colors.subtle_foreground)
        };
        let file_icon = self.file.as_ref().and_then(|name| extensions::icon_for(name, false, false, cx));
        let icon: Option<AnyElement> = match (self.icon, self.icon_path) {
            _ if self.leading.is_some() => self.leading,
            _ if file_icon.is_some() => file_icon.map(|source| {
                div().flex().flex_none().size(px(16.)).items_center().justify_center().child(gpui::img(source).size(px(14.))).into_any_element()
            }),
            (_, Some(path)) => Some(Icon::from_path(path).size(IconSize::Small).color(muted).into_any_element()),
            (Some(icon), None) => Some(Icon::new(icon).size(IconSize::Small).color(muted).into_any_element()),
            _ => None,
        };
        let title = self.title_element.unwrap_or_else(|| highlighted(self.title, &self.highlights, text));
        let content = if self.stacked {
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .child(div().truncate().text_color(text).child(title))
                .children(self.description.map(|description| div().mt(px(2.)).truncate().text_color(muted).child(description)))
        } else {
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .flex_1()
                .min_w_0()
                .child(div().flex_none().max_w_full().truncate().text_color(text).child(title))
                .children(self.description.map(|description| div().min_w_0().truncate().text_color(subtle).child(description)))
        };
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .w_full()
            .min_h(px(28.))
            .mb(px(1.))
            .px(px(8.))
            .py(px(4.))
            .rounded(metrics::radius_md())
            .text_size(typography::text_sm())
            .line_height(gpui::relative(typography::LEADING_ROW))
            .when(self.selected, |this| this.bg(colors.primary))
            .children(icon.map(|icon| div().flex().flex_none().items_center().justify_center().size(px(16.)).child(icon)))
            .child(content)
            .children(self.badge.map(|badge| {
                div()
                    .flex_none()
                    .px(px(6.))
                    .rounded_full()
                    .bg(if self.selected { colors.primary_foreground.opacity(0.2) } else { colors.accent })
                    .text_size(typography::text_caption())
                    .text_color(muted)
                    .child(badge)
            }))
            .children(self.meta.map(|meta| {
                div().flex_none().whitespace_nowrap().text_size(typography::text_caption()).text_color(subtle).child(meta)
            }))
            .children(self.shortcut.map(|shortcut| div().flex_none().child(Kbd::new(shortcut).on_primary(self.selected))))
            .children(self.accessory.map(|accessory| div().flex().flex_none().items_center().gap(px(2.)).child(accessory)))
    }
}

/// The title with matched characters in the medium weight, as Athas's search highlight draws them.
fn highlighted(title: SharedString, positions: &[usize], color: gpui::Hsla) -> AnyElement {
    if positions.is_empty() {
        return div().child(title).into_any_element();
    }
    let mut runs = Vec::new();
    let mut plain = String::new();
    let mut strong = String::new();
    for (offset, character) in title.char_indices() {
        if positions.contains(&offset) {
            if !plain.is_empty() {
                runs.push((std::mem::take(&mut plain), false));
            }
            strong.push(character);
        } else {
            if !strong.is_empty() {
                runs.push((std::mem::take(&mut strong), true));
            }
            plain.push(character);
        }
    }
    if !plain.is_empty() {
        runs.push((plain, false));
    }
    if !strong.is_empty() {
        runs.push((strong, true));
    }
    div()
        .flex()
        .whitespace_nowrap()
        .children(runs.into_iter().map(|(text, strong)| {
            div()
                .when(strong, |this| this.font_weight(typography::SEMIBOLD).text_color(color))
                .child(text)
        }))
        .into_any_element()
}
