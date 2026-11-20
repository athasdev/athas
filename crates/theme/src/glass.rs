//! Window transparency, "glass" (`window-transparency.css`): the window plane shows the desktop
//! through it, and the interaction tokens are remapped so every hover, selected fill, surface and
//! hairline reads the same over any wallpaper: they become tints of the foreground, never the
//! theme's opaque accent, while the islands keep the theme's background.

use std::sync::Arc;

use gpui::{App, Global, Hsla, Rgba};

use crate::{GlobalTheme, Theme, ThemeOptions, accessibility, color::{TRANSPARENT, mix}};

#[derive(Default)]
struct WindowGlass(bool);

impl Global for WindowGlass {}

/// Whether the windows are see-through: the setting is on, the system does not ask to reduce
/// transparency, and the platform has the material (macOS, Windows).
pub fn glass(cx: &App) -> bool {
    cx.try_global::<WindowGlass>().is_some_and(|glass| glass.0)
}

/// Sets whether the windows are see-through; true when it changed.
pub fn set_glass(cx: &mut App, on: bool) -> bool {
    let changed = glass(cx) != on;
    cx.set_global(WindowGlass(on));
    changed
}

/// How themes are built with the system's options: the accent, and Increase contrast.
pub fn options(system_accent: Option<Rgba>, cx: &App) -> ThemeOptions {
    ThemeOptions { system_accent, increase_contrast: accessibility(cx).increase_contrast }
}

/// Makes `theme` the one the workbench draws with, remapped for glass when it is on.
pub fn activate(theme: Arc<Theme>, cx: &mut App) {
    let theme = if glass(cx) { Arc::new(theme.glassed()) } else { theme };
    cx.set_global(GlobalTheme(theme));
}

fn tint(color: Hsla, amount: f32) -> Hsla {
    mix(Rgba::from(color), amount, TRANSPARENT).into()
}

impl Theme {
    /// The theme with the glass tokens: light themes tint the window more, as light vibrancy
    /// lets the wallpaper through strongly.
    pub fn glassed(&self) -> Theme {
        let dark = self.appearance.is_dark();
        let (shell, surface, border, border_strong, hover, active) =
            if dark { (0.12, 0.48, 0.14, 0.32, 0.09, 0.16) } else { (0.72, 0.62, 0.12, 0.28, 0.07, 0.13) };
        let mut theme = self.clone();
        let base = &self.colors;
        let colors = &mut theme.colors;
        colors.window = tint(base.surface, shell);
        colors.surface = tint(base.surface, surface);
        colors.accent = tint(base.foreground, hover);
        colors.selected = tint(base.foreground, active);
        colors.selected_emphasized = tint(base.primary, 0.22);
        colors.border = tint(base.foreground, border);
        colors.divider = tint(colors.border, 0.72);
        colors.border_strong = tint(base.foreground, border_strong);
        theme
    }
}

#[cfg(test)]
mod tests {
    use crate::{ThemeOptions, ThemeRegistry};

    #[test]
    fn glass_tints_the_shell_and_keeps_the_islands() {
        let registry = ThemeRegistry::builtin(ThemeOptions::default());
        for id in ["athas-dark", "athas-light"] {
            let theme = registry.get(id).unwrap();
            let glass = theme.glassed();
            assert_eq!(glass.colors.background, theme.colors.background);
            assert!(glass.colors.window.a < 1.);
            assert!(glass.colors.surface.a < 1.);
            assert!(glass.colors.accent.a < 0.2);
            assert!(glass.colors.border.a < 0.2);
            assert_eq!(theme.colors.window, theme.colors.surface);
        }
        let dark = registry.get("athas-dark").unwrap().glassed();
        let light = registry.get("athas-light").unwrap().glassed();
        assert!((dark.colors.window.a - 0.12).abs() < 0.01);
        assert!((light.colors.window.a - 0.72).abs() < 0.01);
    }
}
