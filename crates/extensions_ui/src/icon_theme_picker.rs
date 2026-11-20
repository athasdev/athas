//! Picks the file icon theme (`icon-theme-selector`), previewing each one in the file tree as
//! the selection moves.

use std::sync::Arc;

use extensions::IconTheme;
use gpui::{AnyElement, App, Context, SharedString, Window, div, img, prelude::*, px};
use palette::{FuzzyMatch, Picker, PickerDelegate, fuzzy_match};
use theme::ActiveTheme;
use ui::{IconName, metrics, typography};

/// A folder and files every theme draws in its row.
const PREVIEW: &[(&str, bool)] = &[("src", true), ("main.rs", false), ("index.ts", false), ("package.json", false)];

pub struct IconThemePickerDelegate {
    themes: Vec<Arc<IconTheme>>,
    original: String,
    matches: Vec<(usize, FuzzyMatch)>,
    selected: usize,
}

impl IconThemePickerDelegate {
    pub fn new(cx: &App) -> Self {
        Self {
            themes: extensions::get(cx).icon_themes().to_vec(),
            original: settings::get(cx).icon_theme.clone(),
            matches: Vec::new(),
            selected: 0,
        }
    }

    fn preview(&self, cx: &mut App) {
        if let Some((index, _)) = self.matches.get(self.selected) {
            extensions::preview_icon_theme(Some(&self.themes[*index].id), cx);
        }
    }
}

impl PickerDelegate for IconThemePickerDelegate {
    fn placeholder(&self) -> SharedString {
        "Select icon theme...".into()
    }

    fn match_count(&self) -> usize {
        self.matches.len()
    }

    fn selected_index(&self) -> usize {
        self.selected
    }

    fn set_selected_index(&mut self, index: usize, cx: &mut Context<Picker<Self>>) {
        self.selected = index;
        self.preview(cx);
    }

    fn update_matches(&mut self, query: &str, _: &mut Window, _: &mut Context<Picker<Self>>) {
        self.matches = self
            .themes
            .iter()
            .enumerate()
            .filter_map(|(index, theme)| fuzzy_match(query, &theme.name).map(|matched| (index, matched)))
            .collect();
        if query.trim().is_empty() {
            self.selected = self.matches.iter().position(|(index, _)| self.themes[*index].id == self.original).unwrap_or(0);
        } else {
            self.matches.sort_by(|a, b| b.1.score.cmp(&a.1.score));
            self.selected = 0;
        }
    }

    fn section_label(&self, index: usize) -> Option<SharedString> {
        let bundled = self.themes[self.matches.get(index)?.0].bundled;
        let previous = index.checked_sub(1).and_then(|previous| self.matches.get(previous));
        match previous {
            Some((previous, _)) if self.themes[*previous].bundled == bundled => None,
            _ => Some(if bundled { "Built in" } else { "Installed" }.into()),
        }
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, cx: &mut Context<Picker<Self>>) -> AnyElement {
        let (theme_index, _) = &self.matches[index];
        let theme = &self.themes[*theme_index];
        let colors = &cx.theme().colors;
        let dark = cx.theme().appearance.is_dark();
        let (text, subtle) = if selected {
            (colors.primary_foreground, colors.primary_foreground.opacity(0.8))
        } else {
            (colors.foreground, colors.subtle_foreground)
        };
        div()
            .flex()
            .items_center()
            .gap(px(10.))
            .w_full()
            .min_h(px(40.))
            .mb(px(2.))
            .px(px(10.))
            .py(px(6.))
            .rounded(metrics::RADIUS_MD)
            .text_size(typography::TEXT_SM)
            .when(selected, |this| this.bg(colors.primary))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(4.))
                    .p(px(4.))
                    .rounded(metrics::RADIUS)
                    .bg(colors.background)
                    .children(PREVIEW.iter().filter_map(|(name, is_dir)| {
                        Some(img(theme.icon(name, *is_dir, false, dark)?).size(px(16.)))
                    })),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(div().truncate().text_color(text).child(theme.name.clone()))
                    .children(theme.description.clone().map(|description| {
                        div().truncate().text_size(typography::TEXT_CAPTION).text_color(subtle).child(description)
                    })),
            )
            .when(theme.id == self.original, |this| {
                this.child(
                    div()
                        .flex_none()
                        .px(px(6.))
                        .rounded_full()
                        .bg(if selected { colors.primary_foreground.opacity(0.2) } else { colors.accent })
                        .text_size(typography::TEXT_CAPTION)
                        .text_color(subtle)
                        .child("Current"),
                )
            })
            .into_any_element()
    }

    fn confirm(&mut self, index: usize, _: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some((theme_index, _)) = self.matches.get(index) else { return false };
        let id = self.themes[*theme_index].id.clone();
        extensions::preview_icon_theme(None, cx);
        extensions::set_icon_theme(&id, cx);
        true
    }

    fn dismissed(&mut self, _: &mut Window, cx: &mut Context<Picker<Self>>) {
        extensions::preview_icon_theme(None, cx);
    }

    fn leading_icon(&self) -> IconName {
        IconName::Files
    }
}
