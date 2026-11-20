use std::borrow::Cow;

use anyhow::Result;
use gpui::{App, AssetSource, SharedString};
use include_dir::{Dir, include_dir};

/// Icons, fonts and themes, built into the binary so the desktop app and the web build load
/// them the same way.
static ASSETS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../../assets");

pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        Ok(ASSETS.get_file(path).map(|file| Cow::Borrowed(file.contents())))
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        Ok(ASSETS
            .get_dir(path)
            .map(|dir| {
                dir.files()
                    .map(|file| SharedString::from(file.path().to_string_lossy().into_owned()))
                    .collect()
            })
            .unwrap_or_default())
    }
}

/// Registers the UI font (Inter) and the editor font (JetBrains Mono).
pub fn load_fonts(cx: &mut App) -> Result<()> {
    let fonts = ASSETS
        .get_dir("fonts")
        .into_iter()
        .flat_map(|dir| dir.files())
        .filter(|file| file.path().extension().is_some_and(|ext| ext == "ttf"))
        .map(|file| Cow::Borrowed(file.contents()))
        .collect();
    cx.text_system().add_fonts(fonts)
}
