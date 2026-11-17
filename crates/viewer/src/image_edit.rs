//! Image editing (`viewer/image/editor`): rotate, flip, resize and convert, each a new entry in an
//! undo history of encoded images, saved through a Save dialog.

use std::{io::Cursor, path::Path, sync::Arc};

use anyhow::{Result, anyhow, bail};
use gpui::RenderImage;
use image::{DynamicImage, ImageFormat as Codec, imageops::FilterType};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Jpeg,
    Webp,
    Avif,
}

impl ImageFormat {
    pub const ALL: [ImageFormat; 4] = [ImageFormat::Png, ImageFormat::Jpeg, ImageFormat::Webp, ImageFormat::Avif];

    pub fn label(self) -> &'static str {
        match self {
            ImageFormat::Png => "PNG",
            ImageFormat::Jpeg => "JPEG",
            ImageFormat::Webp => "WebP",
            ImageFormat::Avif => "AVIF",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            ImageFormat::Png => "Lossless compression, supports transparency",
            ImageFormat::Jpeg => "Lossy compression, smaller file sizes",
            ImageFormat::Webp => "Modern format, best compression",
            ImageFormat::Avif => "Next-gen format, excellent compression",
        }
    }

    pub fn supports_quality(self) -> bool {
        self != ImageFormat::Png
    }

    pub fn extension(self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Webp => "webp",
            ImageFormat::Avif => "avif",
        }
    }

    /// `EXTENSION_FORMATS`: the formats a saved file's extension can name.
    pub fn from_extension(extension: &str) -> Option<Self> {
        match extension.to_ascii_lowercase().as_str() {
            "png" => Some(ImageFormat::Png),
            "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
            "webp" => Some(ImageFormat::Webp),
            "avif" => Some(ImageFormat::Avif),
            _ => None,
        }
    }

    fn of(codec: Codec) -> Option<Self> {
        match codec {
            Codec::Png => Some(ImageFormat::Png),
            Codec::Jpeg => Some(ImageFormat::Jpeg),
            Codec::WebP => Some(ImageFormat::Webp),
            Codec::Avif => Some(ImageFormat::Avif),
            _ => None,
        }
    }
}

/// The quality presets of the Convert dialog, the recommended one second.
pub const QUALITY_PRESETS: [(&str, f32); 4] = [("High Quality", 0.9), ("Recommended", 0.85), ("Balanced", 0.75), ("Small Size", 0.6)];
pub const RECOMMENDED_QUALITY: f32 = 0.85;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Operation {
    Rotate(u16),
    FlipHorizontal,
    FlipVertical,
    Resize { width: u32, height: u32 },
    Convert { format: ImageFormat, quality: Option<f32> },
}

/// One state of the image: its encoded bytes, and how GPUI draws them.
#[derive(Clone)]
pub struct EditedImage {
    pub bytes: Arc<Vec<u8>>,
    pub format: ImageFormat,
    pub size: (u32, u32),
    pub render: Arc<RenderImage>,
}

fn decode(bytes: &[u8]) -> Result<(DynamicImage, Option<Codec>)> {
    let reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let codec = reader.format();
    Ok((reader.decode()?, codec))
}

/// Encodes like the canvas's `toBlob`: PNG losslessly, JPEG at `quality`; WebP only losslessly
/// here, and AVIF not at all, as a webview without that encoder reports.
pub fn encode(image: &DynamicImage, format: ImageFormat, quality: Option<f32>) -> Result<Vec<u8>> {
    let mut out = Cursor::new(Vec::new());
    match format {
        ImageFormat::Png => image.write_to(&mut out, Codec::Png)?,
        ImageFormat::Jpeg => {
            let quality = (quality.unwrap_or(0.9).clamp(0., 1.) * 100.).round() as u8;
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality.max(1));
            image.to_rgb8().write_with_encoder(encoder)?;
        }
        ImageFormat::Webp => image.to_rgba8().write_with_encoder(image::codecs::webp::WebPEncoder::new_lossless(&mut out))?,
        ImageFormat::Avif => bail!("This system cannot encode AVIF images."),
    }
    Ok(out.into_inner())
}

fn render(image: &DynamicImage) -> Arc<RenderImage> {
    let mut buffer = image.to_rgba8();
    for pixel in buffer.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    Arc::new(RenderImage::new(vec![image::Frame::new(buffer)]))
}

impl EditedImage {
    pub fn read(bytes: Vec<u8>) -> Result<Self> {
        let (image, codec) = decode(&bytes)?;
        let format = codec.and_then(ImageFormat::of).unwrap_or(ImageFormat::Png);
        Ok(Self { size: (image.width(), image.height()), render: render(&image), bytes: Arc::new(bytes), format })
    }

    /// The image after `operation`, encoded in its format (or the one converted to).
    pub fn apply(&self, operation: Operation) -> Result<Self> {
        let (image, _) = decode(&self.bytes)?;
        let (image, format, quality) = match operation {
            Operation::Rotate(90) => (image.rotate90(), self.format, None),
            Operation::Rotate(180) => (image.rotate180(), self.format, None),
            Operation::Rotate(270) => (image.rotate270(), self.format, None),
            Operation::Rotate(degrees) => bail!("cannot rotate by {degrees} degrees"),
            Operation::FlipHorizontal => (image.fliph(), self.format, None),
            Operation::FlipVertical => (image.flipv(), self.format, None),
            Operation::Resize { width, height } => {
                if width == 0 || height == 0 {
                    bail!("Width and height must be at least 1 pixel");
                }
                (image.resize_exact(width, height, FilterType::Lanczos3), self.format, None)
            }
            Operation::Convert { format, quality } => (image, format, quality),
        };
        let format = if format == ImageFormat::Avif && !matches!(operation, Operation::Convert { .. }) { ImageFormat::Png } else { format };
        let bytes = encode(&image, format, quality.or(Some(0.92)))?;
        Ok(Self { size: (image.width(), image.height()), render: render(&image), bytes: Arc::new(bytes), format })
    }

    /// The bytes for a file with `path`'s extension, converted when it names another format.
    pub fn bytes_for(&self, path: &Path) -> Result<Vec<u8>> {
        let extension = path.extension().map(|extension| extension.to_string_lossy().into_owned()).unwrap_or_default();
        let format = ImageFormat::from_extension(&extension).ok_or_else(|| anyhow!("Choose a PNG, JPEG, WebP, or AVIF file extension."))?;
        if format == self.format {
            return Ok(self.bytes.to_vec());
        }
        let (image, _) = decode(&self.bytes)?;
        encode(&image, format, None)
    }
}

/// The edits made so far (`ImageEditSession`): undo and redo walk it, a new edit drops the
/// redo side.
#[derive(Clone, Default)]
pub struct History {
    entries: Vec<EditedImage>,
    index: usize,
    saved: usize,
}

impl History {
    pub fn new(original: EditedImage) -> Self {
        Self { entries: vec![original], index: 0, saved: 0 }
    }

    pub fn current(&self) -> Option<&EditedImage> {
        self.entries.get(self.index)
    }

    pub fn push(&mut self, image: EditedImage) {
        self.entries.truncate(self.index + 1);
        if self.current().is_some_and(|current| current.bytes == image.bytes) {
            return;
        }
        self.entries.push(image);
        self.index = self.entries.len() - 1;
    }

    pub fn can_undo(&self) -> bool {
        self.index > 0
    }

    pub fn can_redo(&self) -> bool {
        self.index + 1 < self.entries.len()
    }

    pub fn undo(&mut self) {
        if self.can_undo() {
            self.index -= 1;
        }
    }

    pub fn redo(&mut self) {
        if self.can_redo() {
            self.index += 1;
        }
    }

    /// Whether the image differs from what was last saved (or opened).
    pub fn has_changes(&self) -> bool {
        match (self.entries.get(self.index), self.entries.get(self.saved)) {
            (Some(current), Some(saved)) => current.bytes != saved.bytes,
            _ => false,
        }
    }

    pub fn mark_saved(&mut self) {
        self.saved = self.index;
    }
}

/// The other side for a new width or height when the aspect ratio is kept.
pub fn keep_aspect(original: (u32, u32), width: Option<u32>, height: Option<u32>) -> (u32, u32) {
    let (original_width, original_height) = (original.0.max(1) as f64, original.1.max(1) as f64);
    match (width, height) {
        (Some(width), _) => (width, ((width as f64) * original_height / original_width).round().max(1.) as u32),
        (None, Some(height)) => (((height as f64) * original_width / original_height).round().max(1.) as u32, height),
        (None, None) => original,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> EditedImage {
        let mut image = image::RgbaImage::new(4, 2);
        image.put_pixel(0, 0, image::Rgba([255, 0, 0, 255]));
        EditedImage::read(encode(&DynamicImage::ImageRgba8(image), ImageFormat::Png, None).unwrap()).unwrap()
    }

    #[test]
    fn rotates_flips_and_resizes() {
        let original = sample();
        assert_eq!(original.format, ImageFormat::Png);
        let rotated = original.apply(Operation::Rotate(90)).unwrap();
        assert_eq!(rotated.size, (2, 4));
        let flipped = original.apply(Operation::FlipHorizontal).unwrap();
        let (decoded, _) = decode(&flipped.bytes).unwrap();
        assert_eq!(decoded.to_rgba8().get_pixel(3, 0).0, [255, 0, 0, 255]);
        assert_eq!(original.apply(Operation::Resize { width: 8, height: 4 }).unwrap().size, (8, 4));
        assert!(original.apply(Operation::Resize { width: 0, height: 4 }).is_err());
    }

    #[test]
    fn converts_and_refuses_avif() {
        let jpeg = sample().apply(Operation::Convert { format: ImageFormat::Jpeg, quality: Some(0.6) }).unwrap();
        assert_eq!(jpeg.format, ImageFormat::Jpeg);
        assert_eq!(EditedImage::read(jpeg.bytes.to_vec()).unwrap().format, ImageFormat::Jpeg);
        assert!(sample().apply(Operation::Convert { format: ImageFormat::Avif, quality: None }).is_err());
        assert!(sample().bytes_for(Path::new("out.gif")).is_err());
        assert_eq!(EditedImage::read(sample().bytes_for(Path::new("out.webp")).unwrap()).unwrap().format, ImageFormat::Webp);
    }

    #[test]
    fn undo_redo_and_unsaved_changes() {
        let original = sample();
        let mut history = History::new(original.clone());
        assert!(!history.has_changes() && !history.can_undo());
        history.push(original.apply(Operation::Rotate(180)).unwrap());
        assert!(history.has_changes() && history.can_undo());
        history.undo();
        assert!(!history.has_changes() && history.can_redo());
        history.redo();
        history.mark_saved();
        assert!(!history.has_changes());
        history.undo();
        history.push(original.apply(Operation::FlipVertical).unwrap());
        assert!(!history.can_redo());
    }

    #[test]
    fn keeps_the_aspect_ratio() {
        assert_eq!(keep_aspect((400, 200), Some(100), None), (100, 50));
        assert_eq!(keep_aspect((400, 200), None, Some(50)), (100, 50));
    }
}
