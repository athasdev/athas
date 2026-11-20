//! PDF documents, rasterized page by page on the CPU with `hayro`.

use std::sync::Arc;

use anyhow::{Result, anyhow};
use gpui::RenderImage;
use hayro::{
    PixmapSettings, RenderCache, RenderSettings,
    hayro_interpret::InterpreterSettings,
    hayro_syntax::{
        LoadPdfError, Pdf,
        object::{Array, Dict, MaybeRef, Name, Object, ObjectIdentifier, Rect},
    },
    render,
    vello_cpu::color::palette::css::WHITE,
};

/// The largest side a rendered page may have, in pixels (the rasterizer's limit is `u16`).
const MAX_PAGE_PIXELS: f32 = 8192.;

pub struct Document {
    pdf: Pdf,
    /// Each page's size in points, after its rotation and crop box.
    pub pages: Vec<(f32, f32)>,
    /// The document's title and author from its metadata; the viewer's status bar no longer shows
    /// them (the original's names the zoom, page and page size).
    #[allow(dead_code)]
    pub title: Option<String>,
    #[allow(dead_code)]
    pub author: Option<String>,
    /// Each page's link annotations, in points from the rendered page's top-left corner.
    pub links: Vec<Vec<Link>>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum LinkTarget {
    Url(String),
    /// A page of this document and, when the destination names one, the point from its top.
    Page { index: usize, top: Option<f32> },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Link {
    /// Left, top, right, bottom.
    pub rect: [f32; 4],
    pub target: LinkTarget,
}

pub fn open(bytes: Vec<u8>) -> Result<Document> {
    let pdf = Pdf::new(bytes).map_err(|error| match error {
        LoadPdfError::Decryption(_) => anyhow!("This PDF is encrypted"),
        _ => anyhow!("This file could not be read as a PDF"),
    })?;
    let pages = pdf.pages().iter().map(|page| page.render_dimensions()).collect();
    let text = |value: &Option<Box<[u8]>>| {
        value.as_ref().map(|bytes| decode_text(bytes)).filter(|text| !text.trim().is_empty())
    };
    let metadata = pdf.metadata();
    let (title, author) = (text(&metadata.title), text(&metadata.author));
    let links = page_links(&pdf);
    Ok(Document { pdf, pages, title, author, links })
}

fn page_links(pdf: &Pdf) -> Vec<Vec<Link>> {
    let pages = pdf.pages();
    let ids: Vec<Option<ObjectIdentifier>> = pages.iter().map(|page| page.raw().obj_id()).collect();
    let catalog = pdf.xref().get::<Dict<'_>>(pdf.xref().root_id());
    pages
        .iter()
        .map(|page| {
            let Some(annotations) = page.raw().get::<Array<'_>>(b"Annots") else { return Vec::new() };
            let transform = page.initial_transform(true).as_coeffs();
            let map = |x: f64, y: f64| {
                let [a, b, c, d, e, f] = transform;
                ((a * x + c * y + e) as f32, (b * x + d * y + f) as f32)
            };
            annotations
                .iter::<Dict<'_>>()
                .filter(|annotation| annotation.get::<Name<'_>>(b"Subtype").is_some_and(|name| name.as_str() == "Link"))
                .filter_map(|annotation| {
                    let rect = annotation.get::<Rect>(b"Rect")?;
                    let target = link_target(&annotation, &ids, catalog.as_ref())?;
                    let (x0, y0) = map(rect.x0, rect.y0);
                    let (x1, y1) = map(rect.x1, rect.y1);
                    Some(Link { rect: [x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)], target })
                })
                .collect()
        })
        .collect()
}

fn link_target(annotation: &Dict<'_>, pages: &[Option<ObjectIdentifier>], catalog: Option<&Dict<'_>>) -> Option<LinkTarget> {
    if let Some(action) = annotation.get::<Dict<'_>>(b"A") {
        let kind = action.get::<Name<'_>>(b"S")?;
        return match kind.as_str() {
            "URI" => {
                let uri = decode_text(action.get::<hayro::hayro_syntax::object::String<'_>>(b"URI")?.as_bytes());
                (!uri.trim().is_empty()).then(|| LinkTarget::Url(uri.trim().to_string()))
            }
            "GoTo" => destination(action.get::<Object<'_>>(b"D")?, pages, catalog),
            _ => None,
        };
    }
    destination(annotation.get::<Object<'_>>(b"Dest")?, pages, catalog)
}

/// An explicit destination array, a named one (catalog `/Dests` or the `/Names` tree), or a
/// dictionary holding either under `/D`.
fn destination(value: Object<'_>, pages: &[Option<ObjectIdentifier>], catalog: Option<&Dict<'_>>) -> Option<LinkTarget> {
    match value {
        Object::Array(array) => explicit_destination(&array, pages),
        Object::Dict(dict) => destination(dict.get::<Object<'_>>(b"D")?, pages, catalog),
        Object::Name(name) => named_destination(name.as_str().as_bytes(), pages, catalog?),
        Object::String(name) => named_destination(name.as_bytes(), pages, catalog?),
        _ => None,
    }
}

fn named_destination(name: &[u8], pages: &[Option<ObjectIdentifier>], catalog: &Dict<'_>) -> Option<LinkTarget> {
    if let Some(dests) = catalog.get::<Dict<'_>>(b"Dests") {
        if let Some(found) = dests.get::<Object<'_>>(name) {
            return destination(found, pages, None);
        }
    }
    let tree = catalog.get::<Dict<'_>>(b"Names")?.get::<Dict<'_>>(b"Dests")?;
    let found = find_in_name_tree(&tree, name, 0)?;
    destination(found, pages, None)
}

fn find_in_name_tree<'a>(node: &Dict<'a>, name: &[u8], depth: usize) -> Option<Object<'a>> {
    if depth > 32 {
        return None;
    }
    if let Some(names) = node.get::<Array<'a>>(b"Names") {
        let mut entries = names.iter::<Object<'a>>();
        while let (Some(key), Some(value)) = (entries.next(), entries.next()) {
            if matches!(&key, Object::String(key) if key.as_bytes() == name) {
                return Some(value);
            }
        }
    }
    node.get::<Array<'a>>(b"Kids")?.iter::<Dict<'a>>().find_map(|kid| find_in_name_tree(&kid, name, depth + 1))
}

/// `[page /XYZ left top zoom]`, `[page /FitH top]` and the like; `page` is a reference or,
/// in some writers, a page number.
fn explicit_destination(array: &Array<'_>, pages: &[Option<ObjectIdentifier>]) -> Option<LinkTarget> {
    let mut items = array.raw_iter();
    let index = match items.next()? {
        MaybeRef::Ref(reference) => {
            let id: ObjectIdentifier = reference.into();
            pages.iter().position(|page| *page == Some(id))?
        }
        MaybeRef::NotRef(Object::Number(number)) => (number.as_f64().max(0.) as usize).min(pages.len().checked_sub(1)?),
        MaybeRef::NotRef(_) => return None,
    };
    let kind = match items.next() {
        Some(MaybeRef::NotRef(Object::Name(name))) => name.as_str().to_string(),
        _ => String::new(),
    };
    let number = |item: Option<MaybeRef<Object<'_>>>| match item {
        Some(MaybeRef::NotRef(Object::Number(number))) => Some(number.as_f64()),
        _ => None,
    };
    let y = match kind.as_str() {
        "XYZ" => {
            items.next();
            number(items.next())
        }
        "FitH" | "FitBH" => number(items.next()),
        "FitR" => {
            items.next();
            items.next();
            items.next();
            number(items.next())
        }
        _ => None,
    };
    Some(LinkTarget::Page { index, top: y.map(|y| y as f32) })
}

/// Converts a destination's PDF `y` (up from the bottom) on `page` into points from the rendered top.
pub fn destination_top(document: &Document, index: usize, y: f32) -> f32 {
    let Some(page) = document.pdf.pages().get(index) else { return 0. };
    let [_, b, _, d, _, f] = page.initial_transform(true).as_coeffs();
    let x = page.intersected_crop_box().x0;
    ((b * x + d * y as f64 + f) as f32).max(0.)
}

/// PDF text strings are PDFDocEncoding (close enough to Latin-1) or UTF-16BE with a byte order mark.
fn decode_text(bytes: &[u8]) -> String {
    if let Some(utf16) = bytes.strip_prefix(&[0xfe, 0xff]) {
        let units: Vec<u16> = utf16.chunks_exact(2).map(|pair| u16::from_be_bytes([pair[0], pair[1]])).collect();
        return String::from_utf16_lossy(&units);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => bytes.iter().map(|&byte| byte as char).collect(),
    }
}

/// The pixel scale a page renders at so it stays sharp at `zoom` on a `device_scale` display.
pub fn render_scale(page: (f32, f32), zoom: f32, device_scale: f32) -> f32 {
    let wanted = (zoom * device_scale).max(0.25);
    let largest = page.0.max(page.1).max(1.);
    wanted.min(MAX_PAGE_PIXELS / largest)
}

/// Renders one page on a white background into an image GPUI can draw.
pub fn render_page(document: &Document, index: usize, scale: f32) -> Result<Arc<RenderImage>> {
    let pages = document.pdf.pages();
    let page = pages.get(index).ok_or_else(|| anyhow!("page {} is out of range", index + 1))?;
    let pixmap = render(
        page,
        &RenderCache::new(),
        &InterpreterSettings::default(),
        &RenderSettings::default(),
        &PixmapSettings { x_scale: scale, y_scale: scale, bg_color: WHITE },
    );
    let (width, height) = (pixmap.width() as u32, pixmap.height() as u32);
    // Opaque pixels, so premultiplied and straight alpha agree; GPUI wants BGRA.
    let mut data = pixmap.data_as_u8_slice().to_vec();
    for pixel in data.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    let buffer = image::RgbaImage::from_raw(width, height, data).ok_or_else(|| anyhow!("page {} did not render", index + 1))?;
    Ok(Arc::new(RenderImage::new(vec![image::Frame::new(buffer)])))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_pdf(objects: &[String], info: bool) -> Vec<u8> {
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(out.len());
            out.extend(format!("{} 0 obj\n{object}\nendobj\n", index + 1).bytes());
        }
        let xref = out.len();
        out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
        for offset in offsets {
            out.extend(format!("{offset:010} 00000 n \n").bytes());
        }
        let info = if info { format!(" /Info {} 0 R", objects.len()) } else { String::new() };
        out.extend(format!("trailer\n<< /Size {} /Root 1 0 R{info} >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).bytes());
        out
    }

    /// Two pages; the first links to a web page, to page 2 directly and to page 2 by name.
    fn linked_pdf() -> Vec<u8> {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R /Names << /Dests << /Names [(second) [4 0 R /XYZ 0 150 0]] >> >> >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [5 0 R 6 0 R 7 0 R 8 0 R] >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>".to_string(),
            "<< /Type /Annot /Subtype /Link /Rect [10 180 90 195] /A << /S /URI /URI (https://athas.dev) >> >>".to_string(),
            "<< /Type /Annot /Subtype /Link /Rect [10 10 50 30] /Dest [4 0 R /FitH 100] >>".to_string(),
            "<< /Type /Annot /Subtype /Link /Rect [60 10 90 30] /A << /S /GoTo /D (second) >> >>".to_string(),
            "<< /Type /Annot /Subtype /Text /Rect [0 0 5 5] >>".to_string(),
        ];
        write_pdf(&objects, false)
    }

    #[test]
    fn reads_link_annotations() {
        let document = open(linked_pdf()).unwrap();
        assert_eq!(document.links.len(), 2);
        assert!(document.links[1].is_empty());
        let links = &document.links[0];
        assert_eq!(links.len(), 3);
        assert_eq!(links[0], Link { rect: [10., 5., 90., 20.], target: LinkTarget::Url("https://athas.dev".into()) });
        assert_eq!(links[1].target, LinkTarget::Page { index: 1, top: Some(100.) });
        assert_eq!(links[1].rect, [10., 170., 50., 190.]);
        assert_eq!(links[2].target, LinkTarget::Page { index: 1, top: Some(150.) });
        assert_eq!(destination_top(&document, 1, 150.), 50.);
    }

    /// A one-page PDF with a filled rectangle, written out by hand (offsets computed below).
    fn sample_pdf() -> Vec<u8> {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>".to_string(),
            {
                let stream = "0 0 1 rg 10 10 50 50 re f";
                format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len())
            },
            "<< /Title (Sample) /Author <FEFF00410062> >>".to_string(),
        ];
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(out.len());
            out.extend(format!("{} 0 obj\n{object}\nendobj\n", index + 1).bytes());
        }
        let xref = out.len();
        out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
        for offset in offsets {
            out.extend(format!("{offset:010} 00000 n \n").bytes());
        }
        out.extend(
            format!("trailer\n<< /Size {} /Root 1 0 R /Info 5 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1)
                .bytes(),
        );
        out
    }

    #[test]
    fn reads_pages_and_metadata() {
        let document = open(sample_pdf()).unwrap();
        assert_eq!(document.pages, [(200., 100.)]);
        assert_eq!(document.title.as_deref(), Some("Sample"));
        assert_eq!(document.author.as_deref(), Some("Ab"));
        assert!(open(b"not a pdf".to_vec()).is_err());
    }

    #[test]
    fn renders_a_page_to_bgra() {
        let document = open(sample_pdf()).unwrap();
        let image = render_page(&document, 0, 2.).unwrap();
        let size = image.size(0);
        assert_eq!((size.width.0, size.height.0), (400, 200));
        let bytes = image.as_bytes(0).unwrap();
        // Bottom-left is the blue square (PDF y grows upwards); top-right stays white.
        let pixel = |x: usize, y: usize| &bytes[(y * 400 + x) * 4..(y * 400 + x) * 4 + 4];
        assert_eq!(pixel(40, 160), [255, 0, 0, 255]);
        assert_eq!(pixel(390, 10), [255, 255, 255, 255]);
        assert!(render_page(&document, 3, 1.).is_err());
    }

    #[test]
    fn caps_the_render_scale() {
        assert_eq!(render_scale((612., 792.), 1., 2.), 2.);
        assert!(render_scale((612., 792.), 10., 2.) * 792. <= MAX_PAGE_PIXELS);
        assert_eq!(render_scale((10., 10.), 0.01, 1.), 0.25);
    }
}
