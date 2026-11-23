//! Terminal colours: the theme's 16 ANSI colours, the 256-colour cube and truecolor.

use alacritty_terminal::{
    term::color::Colors,
    vte::ansi::{Color, NamedColor, Rgb},
};
use gpui::{Hsla, Rgba};
use theme::Theme;

/// The colours a terminal draws with when the program has not overridden them (OSC 4/10/11/12).
#[derive(Clone, Debug)]
pub(crate) struct Palette {
    pub ansi: [Hsla; 16],
    pub foreground: Hsla,
    pub background: Hsla,
    pub cursor: Hsla,
    pub selection: Hsla,
}

impl Palette {
    pub fn from_theme(theme: &Theme) -> Self {
        let colors = &theme.colors;
        Self {
            ansi: colors.terminal,
            foreground: colors.foreground,
            background: colors.background,
            cursor: colors.cursor,
            selection: colors.selection,
        }
    }

    /// The colour a cell colour resolves to, honouring the program's palette overrides.
    pub fn resolve(&self, color: Color, overrides: &Colors) -> Hsla {
        match color {
            Color::Spec(rgb) => rgb_to_hsla(rgb),
            Color::Indexed(index) => match overrides[index as usize] {
                Some(rgb) => rgb_to_hsla(rgb),
                None => self.indexed(index),
            },
            Color::Named(named) => match overrides[named] {
                Some(rgb) => rgb_to_hsla(rgb),
                None => self.named(named),
            },
        }
    }

    pub fn named(&self, color: NamedColor) -> Hsla {
        match color {
            NamedColor::Foreground | NamedColor::BrightForeground => self.foreground,
            NamedColor::DimForeground => dim(self.foreground),
            NamedColor::Background => self.background,
            NamedColor::Cursor => self.cursor,
            NamedColor::DimBlack => dim(self.ansi[0]),
            NamedColor::DimRed => dim(self.ansi[1]),
            NamedColor::DimGreen => dim(self.ansi[2]),
            NamedColor::DimYellow => dim(self.ansi[3]),
            NamedColor::DimBlue => dim(self.ansi[4]),
            NamedColor::DimMagenta => dim(self.ansi[5]),
            NamedColor::DimCyan => dim(self.ansi[6]),
            NamedColor::DimWhite => dim(self.ansi[7]),
            named => self.ansi[(named as usize).min(15)],
        }
    }

    /// The xterm 256-colour palette: the 16 theme colours, a 6×6×6 cube and a grey ramp.
    pub fn indexed(&self, index: u8) -> Hsla {
        match index {
            0..=15 => self.ansi[index as usize],
            16..=231 => {
                let index = index - 16;
                let level = |value: u8| if value == 0 { 0 } else { 55 + value * 40 };
                rgb_to_hsla(Rgb { r: level(index / 36), g: level(index / 6 % 6), b: level(index % 6) })
            }
            232..=255 => {
                let value = 8 + (index - 232) * 10;
                rgb_to_hsla(Rgb { r: value, g: value, b: value })
            }
        }
    }
}

/// The faint (SGR 2) version of a colour.
pub(crate) fn dim(color: Hsla) -> Hsla {
    Hsla { a: color.a * 0.66, ..color }
}

fn relative_luminance(color: Hsla) -> f32 {
    let rgba = color.to_rgb();
    let channel = |value: f32| {
        let value = value.clamp(0., 1.);
        if value <= 0.03928 { value / 12.92 } else { ((value + 0.055) / 1.055).powf(2.4) }
    };
    0.2126 * channel(rgba.r) + 0.7152 * channel(rgba.g) + 0.0722 * channel(rgba.b)
}

fn contrast_ratio(a: Hsla, b: Hsla) -> f32 {
    let (a, b) = (relative_luminance(a), relative_luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

/// xterm's `minimumContrastRatio`: text too close to its background moves towards white on dark
/// backgrounds and black on light ones until it reads.
pub(crate) fn ensure_contrast(foreground: Hsla, background: Hsla, ratio: f32) -> Hsla {
    if ratio <= 1. || foreground.a < 1. || contrast_ratio(foreground, background) >= ratio {
        return foreground;
    }
    let lighten = relative_luminance(background) < 0.5;
    let mut adjusted = foreground;
    for _ in 0..20 {
        adjusted.l = if lighten { (adjusted.l + 0.05).min(1.) } else { (adjusted.l - 0.05).max(0.) };
        if contrast_ratio(adjusted, background) >= ratio || adjusted.l <= 0. || adjusted.l >= 1. {
            break;
        }
    }
    adjusted
}

pub(crate) fn rgb_to_hsla(rgb: Rgb) -> Hsla {
    Rgba { r: rgb.r as f32 / 255., g: rgb.g as f32 / 255., b: rgb.b as f32 / 255., a: 1. }.into()
}

/// The `Rgb` a palette colour reports back to programs that query it (OSC 4/10/11).
pub(crate) fn hsla_to_rgb(color: Hsla) -> Rgb {
    let rgba = color.to_rgb();
    let channel = |value: f32| (value.clamp(0., 1.) * 255.).round() as u8;
    Rgb { r: channel(rgba.r), g: channel(rgba.g), b: channel(rgba.b) }
}

/// A palette the tests of this crate draw and answer queries with.
#[cfg(test)]
pub(crate) fn test_palette() -> Palette {
    use gpui::hsla;

    let mut ansi = [hsla(0., 0., 0., 1.); 16];
    for (index, color) in ansi.iter_mut().enumerate() {
        *color = hsla(index as f32 / 16., 0.5, 0.5, 1.);
    }
    Palette {
        ansi,
        foreground: hsla(0., 0., 0.9, 1.),
        background: hsla(0., 0., 0.1, 1.),
        cursor: hsla(0.5, 0.5, 0.5, 1.),
        selection: hsla(0.6, 0.5, 0.5, 0.3),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::hsla;

    fn palette() -> Palette {
        test_palette()
    }

    fn rgb(color: Hsla) -> (u8, u8, u8) {
        let rgb = hsla_to_rgb(color);
        (rgb.r, rgb.g, rgb.b)
    }

    #[test]
    fn named_colors_come_from_the_theme() {
        let palette = palette();
        let colors = Colors::default();
        assert_eq!(palette.resolve(Color::Named(NamedColor::Red), &colors), palette.ansi[1]);
        assert_eq!(palette.resolve(Color::Named(NamedColor::BrightBlue), &colors), palette.ansi[12]);
        assert_eq!(palette.resolve(Color::Named(NamedColor::Foreground), &colors), palette.foreground);
        assert_eq!(palette.resolve(Color::Named(NamedColor::Background), &colors), palette.background);
        assert_eq!(palette.resolve(Color::Named(NamedColor::Cursor), &colors), palette.cursor);
        assert_eq!(palette.resolve(Color::Named(NamedColor::DimGreen), &colors), dim(palette.ansi[2]));
    }

    #[test]
    fn indexed_colors_cover_the_256_palette() {
        let palette = palette();
        let colors = Colors::default();
        assert_eq!(palette.resolve(Color::Indexed(9), &colors), palette.ansi[9]);
        assert_eq!(rgb(palette.indexed(16)), (0, 0, 0));
        assert_eq!(rgb(palette.indexed(196)), (255, 0, 0));
        assert_eq!(rgb(palette.indexed(21)), (0, 0, 255));
        assert_eq!(rgb(palette.indexed(110)), (135, 175, 215));
        assert_eq!(rgb(palette.indexed(231)), (255, 255, 255));
        assert_eq!(rgb(palette.indexed(232)), (8, 8, 8));
        assert_eq!(rgb(palette.indexed(255)), (238, 238, 238));
    }

    #[test]
    fn raises_contrast_to_the_minimum() {
        let background = hsla(0., 0., 0.1, 1.);
        let faint = hsla(0., 0., 0.2, 1.);
        assert!(contrast_ratio(ensure_contrast(faint, background, 4.5), background) >= 4.5);
        let readable = hsla(0., 0., 0.9, 1.);
        assert_eq!(ensure_contrast(readable, background, 4.5), readable);
        assert_eq!(ensure_contrast(faint, background, 1.), faint);
    }

    #[test]
    fn truecolor_and_program_overrides() {
        let palette = palette();
        let mut colors = Colors::default();
        assert_eq!(rgb(palette.resolve(Color::Spec(Rgb { r: 12, g: 200, b: 99 }), &colors)), (12, 200, 99));

        colors[NamedColor::Red] = Some(Rgb { r: 1, g: 2, b: 3 });
        colors[200] = Some(Rgb { r: 4, g: 5, b: 6 });
        assert_eq!(rgb(palette.resolve(Color::Named(NamedColor::Red), &colors)), (1, 2, 3));
        assert_eq!(rgb(palette.resolve(Color::Indexed(200), &colors)), (4, 5, 6));
    }
}
