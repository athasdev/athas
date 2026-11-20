//! Themes and design tokens.
//!
//! A theme file supplies the base palette (background, surface, foreground, muted and subtle
//! foreground, border, accent, selected, primary, and optionally the status, git, cursor and
//! terminal colours). Every other token is derived here, as `styles/theme.css` derives it in the
//! web workbench, so every theme, including custom ones, renders the same system.

mod accessibility;
mod color;
mod glass;
pub mod theme_file;

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::Arc,
};

use gpui::{App, BoxShadow, Global, Hsla, Rgba, point, px};
use serde::{Deserialize, Serialize};

pub use accessibility::{SystemAccessibility, accessibility, refresh_accessibility, set_accessibility_reader};
pub use color::{mix, parse_color, with_alpha};
pub use glass::{activate, glass, options, set_glass};
use theme_file::{ThemeData, normalize_theme_colors};
use color::{TRANSPARENT, black, white};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    Light,
    Dark,
}

impl Appearance {
    pub fn is_dark(self) -> bool {
        self == Appearance::Dark
    }
}

#[derive(Debug, Deserialize)]
struct ThemeFile {
    name: String,
    #[serde(default)]
    author: Option<String>,
    themes: Vec<ThemeVariantFile>,
}

#[derive(Debug, Deserialize)]
struct ThemeVariantFile {
    id: String,
    name: String,
    appearance: Appearance,
    #[serde(default)]
    description: Option<String>,
    colors: HashMap<String, String>,
    #[serde(default)]
    syntax: HashMap<String, String>,
}

/// The planes of the workbench, from recessed to floating, and the tokens drawn on them.
#[derive(Clone, Debug)]
pub struct ThemeColors {
    /// The window plane the workbench sits on: the surface, or a light tint of it over the
    /// desktop with window transparency on.
    pub window: Hsla,
    /// Chrome: the page around the workbench island, with the rail and the sidebar on it.
    pub surface: Hsla,
    /// Content: the editor and document areas.
    pub background: Hsla,
    /// Cards, fields and buttons that sit on a plane.
    pub raised: Hsla,
    /// Floating: menus, popovers, tooltips, dialogs.
    pub overlay: Hsla,
    pub field: Hsla,
    pub scrim: Hsla,

    pub foreground: Hsla,
    pub muted_foreground: Hsla,
    pub subtle_foreground: Hsla,

    pub border: Hsla,
    pub divider: Hsla,
    pub border_strong: Hsla,
    /// The hairline ring tinted from the foreground that edges raised and floating things.
    pub edge: Hsla,

    /// Hover fill.
    pub accent: Hsla,
    /// Active or selected fill.
    pub selected: Hsla,
    /// Selected fill while its list has focus in the key window.
    pub selected_emphasized: Hsla,
    pub selection: Hsla,
    pub focus_ring: Hsla,
    pub segment_track: Hsla,
    pub segment_knob: Hsla,
    pub knob: Hsla,

    pub primary: Hsla,
    pub primary_hover: Hsla,
    pub primary_soft: Hsla,
    pub primary_foreground: Hsla,

    pub destructive: Hsla,
    pub destructive_soft: Hsla,
    pub success: Hsla,
    pub success_soft: Hsla,
    pub warning: Hsla,
    pub warning_soft: Hsla,
    pub info: Hsla,
    pub info_soft: Hsla,
    pub merged: Hsla,
    pub merged_soft: Hsla,

    pub git_added: Hsla,
    pub git_modified: Hsla,
    pub git_modified_staged: Hsla,
    pub git_deleted: Hsla,
    pub git_untracked: Hsla,
    pub git_renamed: Hsla,

    pub cursor: Hsla,
    pub terminal: [Hsla; 16],
    pub syntax: HashMap<String, Hsla>,
}

/// The ring and drop shadows of raised and floating things.
#[derive(Clone, Debug)]
pub struct ThemeShadows {
    pub raised: Vec<BoxShadow>,
    pub raised_inset: Vec<BoxShadow>,
    pub popover: Vec<BoxShadow>,
    pub dialog: Vec<BoxShadow>,
}

#[derive(Clone, Debug)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub family: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub appearance: Appearance,
    pub colors: ThemeColors,
    pub shadows: ThemeShadows,
    /// The colours and syntax colours as the theme file gives them, for a new theme based on it.
    pub source_colors: BTreeMap<String, String>,
    pub source_syntax: BTreeMap<String, String>,
}

/// How a theme is turned into tokens: the options the user picks in Appearance settings.
#[derive(Clone, Copy, Debug, Default)]
pub struct ThemeOptions {
    /// Follow the system accent (macOS) instead of the theme's primary.
    pub system_accent: Option<Rgba>,
    pub increase_contrast: bool,
}

impl Theme {
    /// The theme's own accent, as its file gives it, whatever the system accent: what a theme's
    /// swatch shows (`getThemeScopeStyle` scopes the theme's colours to the swatch).
    pub fn own_primary(&self) -> Hsla {
        self.source_colors.get("primary").and_then(|value| parse_color(value)).map_or(self.colors.primary, Into::into)
    }

    fn from_variant(family: &ThemeFile, variant: &ThemeVariantFile, options: ThemeOptions) -> Self {
        let dark = variant.appearance.is_dark();
        let source_colors = normalize_theme_colors(&variant.colors);
        let get = |key: &str| source_colors.get(key).and_then(|value| parse_color(value));
        let foreground = get("foreground").unwrap_or(if dark { white() } else { Rgba { r: 0.1, g: 0.1, b: 0.1, a: 1.0 } });
        let background = get("background").unwrap_or(if dark { Rgba { r: 0.1, g: 0.1, b: 0.1, a: 1.0 } } else { white() });
        let surface = get("surface").unwrap_or(background);
        let mut muted = get("muted-foreground").unwrap_or(mix(foreground, 0.7, background));
        let mut subtle = get("subtle-foreground").unwrap_or(mix(foreground, 0.55, background));
        let mut border = get("border").unwrap_or(mix(foreground, 0.12, background));
        let accent = get("accent").unwrap_or(mix(foreground, 0.06, background));
        let selected = get("selected").unwrap_or(mix(foreground, 0.1, background));
        let primary = options.system_accent.or(get("primary")).unwrap_or(foreground);

        let terminal_key = |name: &str| get(&format!("terminal-{name}"));
        let destructive = get("destructive").or(terminal_key("red")).unwrap_or(primary);
        let success = get("success").or(terminal_key("green")).unwrap_or(primary);
        let warning = get("warning").or(terminal_key("yellow")).unwrap_or(primary);
        let info = get("info").or(terminal_key("blue")).unwrap_or(primary);
        let merged = get("merged").or(terminal_key("magenta")).unwrap_or(primary);

        if options.increase_contrast {
            muted = mix(muted, 0.7, foreground);
            subtle = mix(subtle, 0.6, foreground);
            border = mix(border, 0.55, foreground);
        }

        let (raised, overlay, field, scrim, divider, segment_track, segment_knob, edge) = if dark {
            (
                mix(background, 0.95, foreground),
                mix(background, 0.92, foreground),
                mix(background, 0.94, foreground),
                Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.4 },
                mix(border, 0.8, TRANSPARENT),
                mix(foreground, 0.06, TRANSPARENT),
                mix(background, 0.8, foreground),
                mix(foreground, 0.07, TRANSPARENT),
            )
        } else {
            (
                background,
                background,
                mix(background, 0.82, surface),
                Rgba { r: 0.0, g: 0.0, b: 0.0, a: 0.16 },
                mix(border, 0.72, TRANSPARENT),
                mix(foreground, 0.07, TRANSPARENT),
                background,
                mix(foreground, 0.08, TRANSPARENT),
            )
        };
        let edge = if options.increase_contrast { mix(foreground, 0.24, TRANSPARENT) } else { edge };
        let divider = if options.increase_contrast { border } else { divider };

        let soft = |color: Rgba, amount: f32| mix(color, amount, TRANSPARENT);
        let git = |key: &str, fallback: Rgba| get(key).unwrap_or(fallback);
        let git_added = git("git-added", success);
        let git_modified = git("git-modified", warning);
        let git_deleted = git("git-deleted", destructive);

        let terminal_names = [
            "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
            "bright-black", "bright-red", "bright-green", "bright-yellow", "bright-blue",
            "bright-magenta", "bright-cyan", "bright-white",
        ];
        let terminal = terminal_names.map(|name| terminal_key(name).unwrap_or(foreground).into());

        let syntax = normalize_syntax(&variant.syntax, foreground, dark)
            .into_iter()
            .filter_map(|(key, value)| Some((key, parse_color(&value)?.into())))
            .collect();

        let colors = ThemeColors {
            window: surface.into(),
            surface: surface.into(),
            background: background.into(),
            raised: raised.into(),
            overlay: overlay.into(),
            field: field.into(),
            scrim: scrim.into(),
            foreground: foreground.into(),
            muted_foreground: muted.into(),
            subtle_foreground: subtle.into(),
            border: border.into(),
            divider: divider.into(),
            border_strong: mix(border, if options.increase_contrast { 0.25 } else { 0.6 }, foreground).into(),
            edge: edge.into(),
            accent: accent.into(),
            selected: selected.into(),
            selected_emphasized: mix(primary, 0.18, selected).into(),
            selection: get("selection").unwrap_or(soft(primary, 0.25)).into(),
            focus_ring: soft(primary, 0.8).into(),
            segment_track: segment_track.into(),
            segment_knob: segment_knob.into(),
            knob: white().into(),
            primary: primary.into(),
            primary_hover: mix(primary, 0.88, foreground).into(),
            primary_soft: soft(primary, 0.12).into(),
            primary_foreground: if options.system_accent.is_some() { white().into() } else { background.into() },
            destructive: destructive.into(),
            destructive_soft: soft(destructive, 0.12).into(),
            success: success.into(),
            success_soft: soft(success, 0.12).into(),
            warning: warning.into(),
            warning_soft: soft(warning, 0.14).into(),
            info: info.into(),
            info_soft: soft(info, 0.12).into(),
            merged: merged.into(),
            merged_soft: soft(merged, 0.12).into(),
            git_added: git_added.into(),
            git_modified: git_modified.into(),
            git_modified_staged: git("git-modified-staged", git_modified).into(),
            git_deleted: git_deleted.into(),
            git_untracked: git("git-untracked", info).into(),
            git_renamed: git("git-renamed", merged).into(),
            cursor: get("cursor").unwrap_or(foreground).into(),
            terminal,
            syntax,
        };

        let shadows = shadows(dark, colors.edge);

        Theme {
            id: variant.id.clone(),
            name: variant.name.clone(),
            family: family.name.clone(),
            author: family.author.clone(),
            description: variant.description.clone(),
            appearance: variant.appearance,
            colors,
            shadows,
            source_syntax: variant.syntax.iter().map(|(key, value)| (key.clone(), value.clone())).collect(),
            source_colors,
        }
    }
}

/// Syntax colours a theme leaves out, or sets to its text colour, per appearance
/// (`FALLBACK_SYNTAX_BY_APPEARANCE`).
const FALLBACK_SYNTAX: [(&str, &str, &str); 18] = [
    ("comment", "#8e9299", "#777b84"),
    ("keyword", "#b85d48", "#e0795f"),
    ("string", "#527ca8", "#7aa6d8"),
    ("number", "#a77b32", "#d5a24a"),
    ("function", "#2f7d55", "#93b584"),
    ("variable", "#8a5f9e", "#c8a7db"),
    ("tag", "#5f7c57", "#80a36f"),
    ("attribute", "#b85d48", "#e0795f"),
    ("punctuation", "#7e838b", "#9fa2aa"),
    ("constant", "#b85d48", "#e0795f"),
    ("property", "#2d67a9", "#93bde9"),
    ("type", "#5b754a", "#abc59b"),
    ("operator", "#7e838b", "#9fa2aa"),
    ("boolean", "#b85d48", "#e0795f"),
    ("null", "#8c6ba8", "#b693ce"),
    ("regex", "#5c899b", "#88b5c6"),
    ("jsx", "#527ca8", "#7aa6d8"),
    ("jsx-attribute", "#b85d48", "#e0795f"),
];

/// `normalizeSyntaxColors`: names without their `--syntax-` prefixes, and the fallback for each
/// token the theme leaves out or draws in (nearly) its text colour.
fn normalize_syntax(syntax: &HashMap<String, String>, foreground: Rgba, dark: bool) -> HashMap<String, String> {
    let mut normalized: HashMap<String, String> = syntax
        .iter()
        .map(|(key, value)| {
            let key = key.strip_prefix("--color-syntax-").or_else(|| key.strip_prefix("--syntax-")).unwrap_or(key);
            (key.to_string(), value.clone())
        })
        .collect();
    let near_text = |value: &str| {
        parse_color(value).is_some_and(|color| {
            let distance = ((color.r - foreground.r).powi(2) + (color.g - foreground.g).powi(2) + (color.b - foreground.b).powi(2)).sqrt() * 255.;
            distance < 28.
        })
    };
    for (key, light, dark_value) in FALLBACK_SYNTAX {
        if normalized.get(key).is_none_or(|value| value.trim().is_empty() || near_text(value)) {
            normalized.insert(key.to_string(), if dark { dark_value } else { light }.to_string());
        }
    }
    normalized
}

fn shadow(color: Hsla, y: f32, blur: f32, spread: f32, inset: bool) -> BoxShadow {
    BoxShadow {
        color,
        offset: point(px(0.), px(y)),
        blur_radius: px(blur),
        spread_radius: px(spread),
        inset,
    }
}

fn shadows(dark: bool, edge: Hsla) -> ThemeShadows {
    if dark {
        ThemeShadows {
            raised: vec![
                shadow(edge, 0., 0., 1., true),
                shadow(black(0.22), 0., 0., 1., false),
                shadow(black(0.2), 1., 2., 0., false),
                shadow(black(0.12), 2., 4., 0., false),
            ],
            raised_inset: vec![shadow(edge, 0., 0., 1., true), shadow(black(0.25), -1., 0., 0., true)],
            // Few, soft layers: stacked wide blurs band into visible rings in GPUI, and a solid
            // dark ring outside the inner edge reads as a second border.
            popover: vec![
                shadow(edge, 0., 0., 1., true),
                shadow(black(0.18), 0., 0., 1., false),
                shadow(black(0.16), 1., 3., 0., false),
                shadow(black(0.26), 6., 18., -4., false),
            ],
            dialog: vec![
                shadow(edge, 0., 0., 1., true),
                shadow(black(0.2), 0., 0., 1., false),
                shadow(black(0.18), 2., 6., 0., false),
                shadow(black(0.34), 16., 40., -10., false),
            ],
        }
    } else {
        ThemeShadows {
            raised: vec![
                shadow(edge, 0., 0., 1., false),
                shadow(black(0.06), 1., 2., -1., false),
                shadow(black(0.03), 2., 4., 0., false),
            ],
            raised_inset: vec![shadow(edge, 0., 0., 1., true), shadow(black(0.05), -1., 0., 0., true)],
            popover: vec![
                shadow(edge, 0., 0., 1., false),
                shadow(black(0.04), 2., 4., 0., false),
                shadow(black(0.08), 8., 16., -4., false),
                shadow(black(0.06), 16., 32., -8., false),
            ],
            dialog: vec![
                shadow(edge, 0., 0., 1., false),
                shadow(black(0.04), 2., 6., 0., false),
                shadow(black(0.08), 12., 24., -6., false),
                shadow(black(0.12), 32., 64., -12., false),
            ],
        }
    }
}

/// Every theme Athas ships, and the ones the user installed.
#[derive(Default)]
pub struct ThemeRegistry {
    themes: Vec<Arc<Theme>>,
    /// Ids of themes the user created or imported.
    custom: HashSet<String>,
}

/// The family custom themes are listed under.
pub const CUSTOM_THEME_FAMILY: &str = "Custom";

/// In the original's load order (`theme-loader.ts`), which is the order pickers list them in.
pub const BUILTIN_THEME_FILES: &[(&str, &str)] = &[
    ("ayu", include_str!("../../../assets/themes/ayu.json")),
    ("athas", include_str!("../../../assets/themes/athas.json")),
    ("catppuccin", include_str!("../../../assets/themes/catppuccin.json")),
    ("christmas", include_str!("../../../assets/themes/christmas.json")),
    ("contrast", include_str!("../../../assets/themes/contrast-themes.json")),
    ("dracula", include_str!("../../../assets/themes/dracula.json")),
    ("github", include_str!("../../../assets/themes/github.json")),
    ("nord", include_str!("../../../assets/themes/nord.json")),
    ("one", include_str!("../../../assets/themes/one.json")),
    ("solarized", include_str!("../../../assets/themes/solarized.json")),
    ("tokyo-night", include_str!("../../../assets/themes/tokyo-night.json")),
    ("vitesse", include_str!("../../../assets/themes/vitesse.json")),
];

impl ThemeRegistry {
    pub fn builtin(options: ThemeOptions) -> Self {
        let mut registry = Self::default();
        for (_, source) in BUILTIN_THEME_FILES {
            if let Err(error) = registry.load_json(source, options) {
                log_error(&error);
            }
        }
        registry
    }

    pub fn load_json(&mut self, source: &str, options: ThemeOptions) -> anyhow::Result<()> {
        let file: ThemeFile = serde_json::from_str(source)?;
        for variant in &file.themes {
            self.themes.push(Arc::new(Theme::from_variant(&file, variant, options)));
        }
        Ok(())
    }

    /// Adds the user's themes, each replacing a theme of the same id.
    pub fn load_custom(&mut self, themes: &[ThemeData], options: ThemeOptions) {
        let family = ThemeFile { name: CUSTOM_THEME_FAMILY.into(), author: None, themes: Vec::new() };
        for theme in themes {
            let variant = ThemeVariantFile {
                id: theme.id.clone(),
                name: theme.name.clone(),
                appearance: theme.appearance,
                description: theme.description.clone(),
                colors: theme.colors.iter().map(|(key, value)| (key.clone(), value.clone())).collect(),
                syntax: theme.syntax.iter().flatten().map(|(key, value)| (key.clone(), value.clone())).collect(),
            };
            self.themes.retain(|existing| existing.id != theme.id);
            self.themes.push(Arc::new(Theme::from_variant(&family, &variant, options)));
            self.custom.insert(theme.id.clone());
        }
    }

    pub fn is_custom(&self, id: &str) -> bool {
        self.custom.contains(id)
    }

    pub fn custom_themes(&self) -> impl Iterator<Item = &Arc<Theme>> {
        self.themes.iter().filter(|theme| self.custom.contains(&theme.id))
    }

    pub fn get(&self, id: &str) -> Option<Arc<Theme>> {
        self.themes.iter().find(|theme| theme.id == id).cloned()
    }

    pub fn themes(&self) -> &[Arc<Theme>] {
        &self.themes
    }
}

fn log_error(error: &anyhow::Error) {
    eprintln!("theme: {error:#}");
}

/// The theme the workbench draws with.
pub struct GlobalTheme(pub Arc<Theme>);

impl Global for GlobalTheme {}

pub trait ActiveTheme {
    fn theme(&self) -> &Arc<Theme>;
}

impl ActiveTheme for App {
    fn theme(&self) -> &Arc<Theme> {
        &self.global::<GlobalTheme>().0
    }
}

/// The accent macOS draws controls with by default (System Settings > Appearance > Accent colour:
/// multicolour).
pub fn macos_default_accent(appearance: Appearance) -> Rgba {
    match appearance {
        Appearance::Dark => Rgba { r: 10. / 255., g: 132. / 255., b: 1., a: 1. },
        Appearance::Light => Rgba { r: 0., g: 122. / 255., b: 1., a: 1. },
    }
}

/// Every theme on offer, built with the options in use.
pub struct GlobalThemeRegistry(pub Arc<ThemeRegistry>);

impl Global for GlobalThemeRegistry {}

pub fn registry(cx: &App) -> Arc<ThemeRegistry> {
    cx.try_global::<GlobalThemeRegistry>().map(|registry| registry.0.clone()).unwrap_or_default()
}

/// Picks the theme for `id`, or the Athas theme of the given appearance.
///
/// The system accent applies to the theme of the system's appearance, as macOS draws controls
/// with it.
pub fn init(cx: &mut App, id: Option<&str>, appearance: Appearance, system_accent: bool) {
    let accent = system_accent.then(|| macos_default_accent(appearance));
    let registry = Arc::new(ThemeRegistry::builtin(options(accent, cx)));
    let fallback = match appearance {
        Appearance::Dark => "athas-dark",
        Appearance::Light => "athas-light",
    };
    let theme = id
        .and_then(|id| registry.get(id))
        .or_else(|| registry.get(fallback))
        .expect("the Athas theme is built in");
    activate(theme, cx);
    cx.set_global(GlobalThemeRegistry(registry));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_text_coloured_syntax_falls_back() {
        let foreground = parse_color("#eeeeee").unwrap();
        let syntax: HashMap<String, String> =
            [("--syntax-keyword".to_string(), "#ff79c6".to_string()), ("string".to_string(), "#efefef".to_string())].into_iter().collect();
        let normalized = normalize_syntax(&syntax, foreground, true);
        assert_eq!(normalized["keyword"], "#ff79c6");
        assert_eq!(normalized["string"], "#7aa6d8", "too close to the text colour");
        assert_eq!(normalized["comment"], "#777b84");
        assert_eq!(normalize_syntax(&HashMap::new(), foreground, false)["comment"], "#8e9299");
    }

    #[test]
    fn every_builtin_theme_parses() {
        let registry = ThemeRegistry::builtin(ThemeOptions::default());
        assert!(registry.themes().len() >= 30, "{}", registry.themes().len());
        assert!(registry.get("athas-dark").is_some());
        assert!(registry.get("athas-light").is_some());
    }
}
