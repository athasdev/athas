//! Images previews load from the web (`![](https://…)`, `<img src="https://…">`), fetched once per
//! URL for the whole app and kept while it runs.

use std::{collections::HashMap, sync::Arc};

use gpui::{App, AppContext as _, Global, Image, ImageFormat};

#[derive(Clone)]
pub(crate) enum RemoteImage {
    Loading,
    Ready(Arc<Image>),
    Failed,
}

#[derive(Default)]
struct RemoteImages(HashMap<String, RemoteImage>);

impl Global for RemoteImages {}

/// The image at `url`, starting its download the first time it is asked for. Windows redraw once
/// it arrives.
pub(crate) fn remote_image(url: &str, cx: &mut App) -> RemoteImage {
    if let Some(image) = cx.default_global::<RemoteImages>().0.get(url) {
        return image.clone();
    }
    cx.global_mut::<RemoteImages>().0.insert(url.to_string(), RemoteImage::Loading);
    let fetch_url = url.to_string();
    let download = cx.background_spawn(async move { fetch(&fetch_url) });
    let url = url.to_string();
    cx.spawn(async move |cx| {
        let image = match download.await {
            Some((format, bytes)) => RemoteImage::Ready(Arc::new(Image::from_bytes(format, bytes))),
            None => RemoteImage::Failed,
        };
        cx.update(|cx| {
            cx.global_mut::<RemoteImages>().0.insert(url, image);
            cx.refresh_windows();
        });
    })
    .detach();
    RemoteImage::Loading
}

/// The image format of `bytes`, from their signature.
#[cfg(not(target_family = "wasm"))]
pub(crate) fn sniff_format(bytes: &[u8]) -> Option<ImageFormat> {
    let head = &bytes[..bytes.len().min(512)];
    Some(match head {
        [0x89, b'P', b'N', b'G', ..] => ImageFormat::Png,
        [0xFF, 0xD8, 0xFF, ..] => ImageFormat::Jpeg,
        [b'G', b'I', b'F', b'8', ..] => ImageFormat::Gif,
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => ImageFormat::Webp,
        [b'B', b'M', ..] => ImageFormat::Bmp,
        [b'I', b'I', 42, 0, ..] | [b'M', b'M', 0, 42, ..] => ImageFormat::Tiff,
        [0, 0, 1, 0, ..] => ImageFormat::Ico,
        _ if String::from_utf8_lossy(head).contains("<svg") => ImageFormat::Svg,
        _ => return None,
    })
}

#[cfg(not(target_family = "wasm"))]
fn fetch(url: &str) -> Option<(ImageFormat, Vec<u8>)> {
    use std::io::Read as _;
    const MAX_BYTES: u64 = 16 * 1024 * 1024;
    let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(20)).user_agent("Athas").build().ok()?;
    let response = client.get(url).send().ok()?.error_for_status().ok()?;
    let mut bytes = Vec::new();
    response.take(MAX_BYTES + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_BYTES {
        return None;
    }
    Some((sniff_format(&bytes)?, bytes))
}

#[cfg(target_family = "wasm")]
fn fetch(_: &str) -> Option<(ImageFormat, Vec<u8>)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_from_signatures() {
        assert_eq!(sniff_format(b"\x89PNG\r\n\x1a\n...."), Some(ImageFormat::Png));
        assert_eq!(sniff_format(b"GIF89a"), Some(ImageFormat::Gif));
        assert_eq!(sniff_format(b"RIFF\0\0\0\0WEBPVP8 "), Some(ImageFormat::Webp));
        assert_eq!(sniff_format(b"<?xml version=\"1.0\"?><svg xmlns=\"\"></svg>"), Some(ImageFormat::Svg));
        assert_eq!(sniff_format(b"<html>"), None);
    }
}
