//! Small pieces the catalog and the detail page share: extension icons, badges, progress.

use extensions::{CatalogEntry, ExtensionIcon, ExtensionKind, ExtensionStatus, Operation};
use ui::scale::px;
use gpui::{AnyElement, IntoElement, Pixels, div, img, prelude::*, relative, svg};
use theme::ThemeColors;
use ui::{Icon, IconName, IconSize, metrics};

pub(crate) fn kind_icon(kind: ExtensionKind) -> IconName {
    match kind {
        ExtensionKind::Language => IconName::Code,
        ExtensionKind::Theme => IconName::Palette,
        ExtensionKind::IconTheme => IconName::Files,
        ExtensionKind::Ai => IconName::Sparkle,
        ExtensionKind::Integration => IconName::PuzzlePiece,
        ExtensionKind::Mcp => IconName::PlugsConnected,
        ExtensionKind::Skill => IconName::Lightbulb,
        ExtensionKind::Agent => IconName::TerminalWindow,
    }
}

/// The extension's icon on a raised tile; its kind's icon when it has none.
pub(crate) fn extension_icon(entry: &CatalogEntry, size: Pixels, colors: &ThemeColors) -> AnyElement {
    let glyph = size * 0.6;
    let inner: AnyElement = match &entry.icon {
        Some(ExtensionIcon::Embedded { path, monochrome: true }) => {
            svg().path(path.clone()).size(glyph).text_color(colors.foreground).into_any_element()
        }
        Some(ExtensionIcon::Embedded { path, monochrome: false }) => img(path.clone()).size(glyph).into_any_element(),
        Some(ExtensionIcon::Remote(url)) => img(url.clone()).size(glyph).into_any_element(),
        None => Icon::new(kind_icon(entry.kind)).size(IconSize::Custom(glyph)).color(colors.muted_foreground).into_any_element(),
    };
    div()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(size)
        .rounded(if size > px(40.) { metrics::radius_lg() + px(2.) } else { metrics::radius_lg() })
        .bg(colors.raised)
        .border_1()
        .border_color(colors.divider)
        .child(inner)
        .into_any_element()
}

#[derive(Clone, Copy)]
pub(crate) enum Tone {
    Neutral,
    Success,
    Accent,
    Warning,
    Danger,
}

pub(crate) fn badge(label: &'static str, tone: Tone, _colors: &ThemeColors) -> impl IntoElement {
    ui::Badge::new(label).tone(match tone {
        Tone::Neutral => ui::Tone::Neutral,
        Tone::Success => ui::Tone::Success,
        Tone::Accent => ui::Tone::Info,
        Tone::Warning => ui::Tone::Warning,
        Tone::Danger => ui::Tone::Danger,
    })
}

/// The badge a catalog row shows for an extension's state, if any.
pub(crate) fn status_badge(status: &ExtensionStatus, colors: &ThemeColors) -> Option<AnyElement> {
    let (label, tone) = if status.error.is_some() {
        ("Failed", Tone::Danger)
    } else if status.update_available {
        ("Update", Tone::Accent)
    } else if status.installed && !status.enabled {
        ("Disabled", Tone::Neutral)
    } else if status.installed {
        ("Installed", Tone::Success)
    } else if status.blocked {
        ("Blocked", Tone::Warning)
    } else {
        return None;
    };
    Some(badge(label, tone, colors).into_any_element())
}

/// A thin bar filled to `fraction`.
pub(crate) fn progress_bar(fraction: f32, width: Pixels, colors: &ThemeColors) -> impl IntoElement {
    div()
        .flex_none()
        .w(width)
        .h(px(4.))
        .rounded_full()
        .bg(colors.segment_track)
        .child(div().h_full().rounded_full().bg(colors.primary).w(relative(fraction.clamp(0.04, 1.))))
}

pub(crate) fn operation_label(operation: Operation) -> String {
    match operation {
        Operation::Installing(fraction) if fraction > 0. => format!("Installing {}%", (fraction * 100.).round() as u32),
        Operation::Installing(_) => "Installing".into(),
        Operation::Uninstalling => "Removing".into(),
    }
}

pub(crate) fn format_size(bytes: u64) -> String {
    match bytes {
        0..1_000 => format!("{bytes} B"),
        1_000..1_000_000 => format!("{:.0} KB", bytes as f64 / 1_000.),
        _ => format!("{:.1} MB", bytes as f64 / 1_000_000.),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes() {
        assert_eq!(format_size(512), "512 B");
        assert_eq!(format_size(18_967), "19 KB");
        assert_eq!(format_size(12_337_474), "12.3 MB");
    }
}
