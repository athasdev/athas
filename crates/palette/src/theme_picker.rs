use std::{path::PathBuf, rc::Rc, sync::Arc};

use ui::scale::px;
use gpui::{AnyElement, App, Context, PathPromptOptions, SharedString, Window, div, prelude::*,};
use theme::{ActiveTheme, GlobalTheme, Theme};
use ui::{Button, ButtonSize, ButtonVariant, IconName, metrics};

use crate::{FuzzyMatch, Picker, PickerDelegate, PaletteRow, fuzzy_match};

/// Picks a colour theme, previewing each one as the selection moves (`theme-selector.tsx`).
pub struct ThemePickerDelegate {
    themes: Vec<Arc<Theme>>,
    original: Arc<Theme>,
    matches: Vec<(usize, FuzzyMatch)>,
    selected: usize,
    on_pick: Rc<dyn Fn(&Arc<Theme>, &mut Window, &mut App)>,
    /// Imports a theme file and returns the theme it picked.
    on_import: Option<Rc<dyn Fn(PathBuf, &mut App) -> Option<Arc<Theme>>>>,
    on_open_settings: Option<Rc<dyn Fn(&mut Window, &mut App)>>,
    on_back: Option<Rc<dyn Fn(&mut Window, &mut App)>>,
}

/// Up to four of a theme's colours side by side (`getThemePreviewColors`).
pub fn theme_preview(theme: &Theme) -> impl IntoElement + use<> {
    let colors = &theme.colors;
    let syntax = |name: &str| colors.syntax.get(name).copied();
    let swatches: Vec<gpui::Hsla> =
        [Some(theme.own_primary()), syntax("keyword"), syntax("string"), Some(colors.surface), Some(colors.foreground), Some(colors.background)]
            .into_iter()
            .flatten()
            .take(4)
            .collect();
    div()
        .flex()
        .flex_none()
        .size(px(24.))
        .rounded(metrics::radius_md())
        .overflow_hidden()
        .border_1()
        .border_color(colors.border)
        .bg(colors.background)
        .children(swatches.into_iter().map(|color| div().h_full().flex_1().min_w_0().bg(color)))
}

impl ThemePickerDelegate {
    pub fn new(
        themes: Vec<Arc<Theme>>,
        cx: &App,
        on_pick: impl Fn(&Arc<Theme>, &mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            themes,
            original: cx.theme().clone(),
            matches: Vec::new(),
            selected: 0,
            on_pick: Rc::new(on_pick),
            on_import: None,
            on_open_settings: None,
            on_back: None,
        }
    }

    /// Shows the back button in front of the search field (the palette's `popView`).
    pub fn on_back(mut self, back: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_back = Some(Rc::new(back));
        self
    }

    /// Shows the upload button, which imports a theme file and picks it.
    pub fn on_import(mut self, import: impl Fn(PathBuf, &mut App) -> Option<Arc<Theme>> + 'static) -> Self {
        self.on_import = Some(Rc::new(import));
        self
    }

    /// Shows the button that opens Appearance settings.
    pub fn on_open_settings(mut self, open: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_open_settings = Some(Rc::new(open));
        self
    }

    fn preview(&self, cx: &mut App) {
        if let Some((index, _)) = self.matches.get(self.selected) {
            theme::activate(self.themes[*index].clone(), cx);
            cx.refresh_windows();
        }
    }
}

impl PickerDelegate for ThemePickerDelegate {
    fn placeholder(&self) -> SharedString {
        "Search themes...".into()
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
            .filter_map(|(index, theme)| {
                fuzzy_match(query, &theme.name).map(|matched| (index, matched)).or_else(|| {
                    let description = theme.description.as_deref().unwrap_or_default();
                    fuzzy_match(query, description).map(|matched| (index, FuzzyMatch { positions: Vec::new(), ..matched }))
                })
            })
            .collect();
        if query.trim().is_empty() {
            // Start on the theme in use.
            self.selected = self.matches.iter().position(|(index, _)| self.themes[*index].id == self.original.id).unwrap_or(0);
        } else {
            self.matches.sort_by(|a, b| b.1.score.cmp(&a.1.score));
            self.selected = 0;
        }
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, _: &mut Context<Picker<Self>>) -> AnyElement {
        let (theme_index, matched) = &self.matches[index];
        let theme = &self.themes[*theme_index];
        let category = if theme.appearance.is_dark() { "Dark" } else { "Light" };
        let mut row = PaletteRow::new(theme.name.clone())
            .leading(theme_preview(theme))
            .description(theme.description.clone().filter(|description| !description.is_empty()).unwrap_or_else(|| category.into()))
            .highlights(matched.positions.clone())
            .selected(selected);
        if theme.id == self.original.id {
            row = row.badge("Current");
        }
        row.into_any_element()
    }

    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some((theme_index, _)) = self.matches.get(index) else { return false };
        let theme = self.themes[*theme_index].clone();
        theme::activate(theme.clone(), cx);
        (self.on_pick)(&theme, window, cx);
        cx.refresh_windows();
        true
    }

    fn dismissed(&mut self, _: &mut Window, cx: &mut Context<Picker<Self>>) {
        cx.set_global(GlobalTheme(self.original.clone()));
        cx.refresh_windows();
    }

    fn leading_icon(&self) -> IconName {
        IconName::Palette
    }

    fn shows_return_hint(&self) -> bool {
        false
    }

    fn leading_element(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Option<AnyElement> {
        let back = self.on_back.clone()?;
        Some(
            Button::icon("theme-picker-back", IconName::ChevronLeft)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .tooltip("Back to commands")
                .on_click(cx.listener(move |picker, _, window, cx| {
                    picker.dismiss(window, cx);
                    let back = back.clone();
                    window.defer(cx, move |window, cx| back(window, cx));
                }))
                .into_any_element(),
        )
    }

    fn header_actions(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Vec<AnyElement> {
        let mut actions = Vec::new();
        if let Some(import) = self.on_import.clone() {
            actions.push(
                Button::icon("theme-picker-upload", IconName::Upload)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .tooltip("Upload theme")
                    .on_click(cx.listener(move |_, _, window, cx| {
                        let paths = cx.prompt_for_paths(PathPromptOptions { files: true, directories: false, multiple: false, prompt: Some("Import".into()) });
                        let import = import.clone();
                        cx.spawn_in(window, async move |this, cx| {
                            let Ok(Ok(Some(paths))) = paths.await else { return };
                            let Some(path) = paths.into_iter().next() else { return };
                            this.update_in(cx, |picker, window, cx| {
                                if let Some(theme) = import(path, cx) {
                                    picker.delegate.original = theme;
                                    picker.dismiss(window, cx);
                                }
                            })
                            .ok();
                        })
                        .detach();
                    }))
                    .into_any_element(),
            );
        }
        if let Some(open) = self.on_open_settings.clone() {
            actions.push(
                Button::icon("theme-picker-settings", IconName::Settings)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .tooltip("Open appearance settings")
                    .on_click(cx.listener(move |picker, _, window, cx| {
                        picker.dismiss(window, cx);
                        let open = open.clone();
                        window.defer(cx, move |window, cx| open(window, cx));
                    }))
                    .into_any_element(),
            );
        }
        actions
    }
}
