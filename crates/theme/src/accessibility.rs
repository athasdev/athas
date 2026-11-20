//! The system's accessibility display options (`use-system-accessibility.ts`): Increase contrast
//! sharpens text and lines, Reduce transparency keeps the window opaque, Differentiate without
//! colour outlines what is selected, Reduce motion stills animations. The desktop app installs a
//! reader for them; elsewhere they are all off.

use gpui::{App, Global};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SystemAccessibility {
    pub reduce_transparency: bool,
    pub increase_contrast: bool,
    pub differentiate_without_color: bool,
    pub reduce_motion: bool,
}

impl Global for SystemAccessibility {}

struct Reader(fn() -> SystemAccessibility);

impl Global for Reader {}

pub fn accessibility(cx: &App) -> SystemAccessibility {
    cx.try_global::<SystemAccessibility>().copied().unwrap_or_default()
}

/// Installs how the options are read, and reads them.
pub fn set_accessibility_reader(cx: &mut App, read: fn() -> SystemAccessibility) {
    cx.set_global(Reader(read));
    cx.set_global(read());
}

/// Reads the options again, as when a window comes to the front; true when they changed.
pub fn refresh_accessibility(cx: &mut App) -> bool {
    let Some(read) = cx.try_global::<Reader>().map(|reader| reader.0) else { return false };
    let current = read();
    if accessibility(cx) == current {
        return false;
    }
    cx.set_global(current);
    true
}
