//! Holes in a browser tab where workbench UI shows through.
//!
//! A tab is a native view drawn above the workbench, so a menu, toast or dialog
//! the workbench opens over it would be hidden. The workbench measures that UI
//! and sends it as holes relative to the page; the native layer then masks the
//! page around them and lets the pointer through to the workbench there.

use serde::Serialize;

/// A rectangle in CSS pixels, relative to the page's top left corner.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageRect {
   pub x: f64,
   pub y: f64,
   pub width: f64,
   pub height: f64,
}

impl PageRect {
   pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
      Self {
         x,
         y,
         width,
         height,
      }
   }

   fn right(&self) -> f64 {
      self.x + self.width
   }

   fn bottom(&self) -> f64 {
      self.y + self.height
   }

   fn is_empty(&self) -> bool {
      !(self.width > 0.0 && self.height > 0.0)
   }

   fn intersect(&self, other: &PageRect) -> Option<PageRect> {
      let left = self.x.max(other.x);
      let top = self.y.max(other.y);
      let right = self.right().min(other.right());
      let bottom = self.bottom().min(other.bottom());
      let cut = PageRect::new(left, top, right - left, bottom - top);
      (!cut.is_empty()).then_some(cut)
   }

   fn contains(&self, x: f64, y: f64) -> bool {
      x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
   }
}

/// The holes that fall on a page of `width` by `height`, clipped to it.
pub fn clip_holes(width: f64, height: f64, holes: &[PageRect]) -> Vec<PageRect> {
   let page = PageRect::new(0.0, 0.0, width, height);
   holes
      .iter()
      .filter(|hole| hole.x.is_finite() && hole.y.is_finite())
      .filter_map(|hole| page.intersect(hole))
      .collect()
}

/// The parts of a page of `width` by `height` that no hole covers, as
/// rectangles that don't overlap. Their union is what the page still shows.
pub fn visible_parts(width: f64, height: f64, holes: &[PageRect]) -> Vec<PageRect> {
   let mut pieces = vec![PageRect::new(0.0, 0.0, width, height)];
   if pieces[0].is_empty() {
      return Vec::new();
   }
   for hole in holes {
      let mut next = Vec::with_capacity(pieces.len() + 3);
      for piece in pieces {
         let Some(cut) = piece.intersect(hole) else {
            next.push(piece);
            continue;
         };
         if cut.y > piece.y {
            next.push(PageRect::new(
               piece.x,
               piece.y,
               piece.width,
               cut.y - piece.y,
            ));
         }
         if cut.bottom() < piece.bottom() {
            next.push(PageRect::new(
               piece.x,
               cut.bottom(),
               piece.width,
               piece.bottom() - cut.bottom(),
            ));
         }
         if cut.x > piece.x {
            next.push(PageRect::new(piece.x, cut.y, cut.x - piece.x, cut.height));
         }
         if cut.right() < piece.right() {
            next.push(PageRect::new(
               cut.right(),
               cut.y,
               piece.right() - cut.right(),
               cut.height,
            ));
         }
      }
      pieces = next;
      if pieces.is_empty() {
         break;
      }
   }
   pieces
}

/// Whether the point, relative to the page, falls in a hole, where the pointer
/// belongs to the workbench UI shown there.
pub fn is_in_hole(holes: &[PageRect], x: f64, y: f64) -> bool {
   holes.iter().any(|hole| hole.contains(x, y))
}

/// How this platform lets workbench UI show over browser tabs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
pub struct BrowserCapabilities {
   /// Pages can be cut around workbench UI, which then shows and takes the
   /// pointer there. Without it, pages hide while UI covers them.
   pub holes: bool,
   /// `browser_snapshot` works, so a picture can stand in under the cut-out parts.
   pub snapshots: bool,
}

impl BrowserCapabilities {
   /// Windows clips the page's window with a region to cut holes. macOS hides a
   /// covered page behind a picture of it instead: letting the pointer through a
   /// hole needs a runtime subclass of WebKit's view, which AppKit aborts on when
   /// the page is resized. Linux hosts pages in a GTK box that can't be cut.
   pub const fn current() -> Self {
      Self {
         holes: cfg!(target_os = "windows"),
         snapshots: cfg!(target_os = "macos"),
      }
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   fn area(rects: &[PageRect]) -> f64 {
      rects.iter().map(|rect| rect.width * rect.height).sum()
   }

   fn overlaps(rects: &[PageRect]) -> bool {
      rects.iter().enumerate().any(|(index, rect)| {
         rects[index + 1..]
            .iter()
            .any(|other| rect.intersect(other).is_some())
      })
   }

   #[test]
   fn keeps_the_whole_page_without_holes() {
      assert_eq!(
         visible_parts(300.0, 200.0, &[]),
         vec![PageRect::new(0.0, 0.0, 300.0, 200.0)]
      );
   }

   #[test]
   fn shows_the_page_around_a_menu() {
      let parts = visible_parts(300.0, 200.0, &[PageRect::new(200.0, 0.0, 80.0, 120.0)]);
      assert_eq!(area(&parts), 300.0 * 200.0 - 80.0 * 120.0);
      assert!(!overlaps(&parts));
      assert!(parts.iter().all(|part| !is_in_hole(
         &[PageRect::new(200.0, 0.0, 80.0, 120.0)],
         part.x + part.width / 2.0,
         part.y + part.height / 2.0
      )));
   }

   #[test]
   fn handles_holes_that_overlap() {
      let holes = [
         PageRect::new(0.0, 0.0, 60.0, 40.0),
         PageRect::new(30.0, 20.0, 60.0, 40.0),
      ];
      let parts = visible_parts(100.0, 80.0, &holes);
      assert_eq!(
         area(&parts),
         100.0 * 80.0 - (60.0 * 40.0 * 2.0 - 30.0 * 20.0)
      );
      assert!(!overlaps(&parts));
   }

   #[test]
   fn shows_nothing_under_a_hole_over_the_whole_page() {
      let holes = [PageRect::new(-10.0, -10.0, 500.0, 500.0)];
      assert!(visible_parts(300.0, 200.0, &holes).is_empty());
      assert!(visible_parts(0.0, 200.0, &[]).is_empty());
   }

   #[test]
   fn clips_holes_to_the_page() {
      let holes = [
         PageRect::new(250.0, -20.0, 100.0, 60.0),
         PageRect::new(400.0, 0.0, 10.0, 10.0),
         PageRect::new(f64::NAN, 0.0, 10.0, 10.0),
      ];
      assert_eq!(
         clip_holes(300.0, 200.0, &holes),
         vec![PageRect::new(250.0, 0.0, 50.0, 40.0)]
      );
   }

   #[test]
   fn passes_the_pointer_through_holes_only() {
      let holes = [PageRect::new(10.0, 10.0, 20.0, 20.0)];
      assert!(is_in_hole(&holes, 10.0, 10.0));
      assert!(is_in_hole(&holes, 29.5, 29.5));
      assert!(!is_in_hole(&holes, 30.0, 15.0));
      assert!(!is_in_hole(&[], 15.0, 15.0));
   }

   #[test]
   fn reports_what_this_platform_supports() {
      let capabilities = BrowserCapabilities::current();
      assert_eq!(capabilities.holes, cfg!(target_os = "windows"));
      assert_eq!(capabilities.snapshots, cfg!(target_os = "macos"));
   }
}
