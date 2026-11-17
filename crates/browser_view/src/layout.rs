//! Where a page goes and whether it shows: the part of its slot on screen, the workbench UI over
//! it, and what to do about that UI on this platform.
//!
//! Ported from Athas's `features/browser/utils/browser-occlusion.ts` and the layout pass of
//! `browser-tab-manager.ts`.

pub use athas_browser::{BrowserCapabilities, PageRect as Rect};

/// The most holes a page takes; beyond it the page gets one hole around all of them.
const MAX_HOLES: usize = 24;

fn intersect(a: &Rect, b: &Rect) -> Option<Rect> {
    let left = a.x.max(b.x);
    let top = a.y.max(b.y);
    let right = (a.x + a.width).min(b.x + b.width);
    let bottom = (a.y + a.height).min(b.y + b.height);
    (right - left > 0.0 && bottom - top > 0.0).then(|| Rect::new(left, top, right - left, bottom - top))
}

/// The part of the slot inside `clip` (the window, and any scroll area around the slot). A native
/// page can't be clipped by the workbench, so a slot partly out of view shows only its visible part.
pub fn visible_slot_geometry(slot: Rect, clip: Rect) -> Option<Rect> {
    let left = slot.x.max(clip.x);
    let top = slot.y.max(clip.y);
    let right = (slot.x + slot.width).min(clip.x + clip.width);
    let bottom = (slot.y + slot.height).min(clip.y + clip.height);
    if right - left < 1.0 || bottom - top < 1.0 {
        return None;
    }
    Some(Rect::new(left.round(), top.round(), (right - left).round(), (bottom - top).round()))
}

/// Workbench UI over the page as holes relative to it, rounded outwards, without repeats.
pub fn local_holes(geometry: Rect, overlays: &[Rect]) -> Vec<Rect> {
    let mut holes: Vec<Rect> = Vec::new();
    for overlay in overlays {
        let Some(cut) = intersect(&geometry, overlay) else { continue };
        let left = (cut.x - geometry.x).floor().max(0.0);
        let top = (cut.y - geometry.y).floor().max(0.0);
        let right = (cut.x + cut.width - geometry.x).ceil().min(geometry.width);
        let bottom = (cut.y + cut.height - geometry.y).ceil().min(geometry.height);
        if right - left < 1.0 || bottom - top < 1.0 {
            continue;
        }
        let hole = Rect::new(left, top, right - left, bottom - top);
        if !holes.contains(&hole) {
            holes.push(hole);
        }
    }
    holes.sort_by(|a, b| {
        a.y.total_cmp(&b.y).then(a.x.total_cmp(&b.x)).then(a.width.total_cmp(&b.width)).then(a.height.total_cmp(&b.height))
    });
    if holes.len() > MAX_HOLES {
        let left = holes.iter().map(|hole| hole.x).fold(f64::INFINITY, f64::min);
        let top = holes.iter().map(|hole| hole.y).fold(f64::INFINITY, f64::min);
        let right = holes.iter().map(|hole| hole.x + hole.width).fold(f64::NEG_INFINITY, f64::max);
        let bottom = holes.iter().map(|hole| hole.y + hole.height).fold(f64::NEG_INFINITY, f64::max);
        return vec![Rect::new(left, top, right - left, bottom - top)];
    }
    holes
}

/// Whether the holes leave nothing of a page of this size to show.
pub fn is_covered(width: f64, height: f64, holes: &[Rect]) -> bool {
    !holes.is_empty() && athas_browser::visible_parts(width, height, holes).is_empty()
}

/// A point of the window over a part of the page workbench UI leaves uncovered, where a click into
/// the page landed as far as the workbench can tell. `None` when the holes cover the whole page.
pub fn uncovered_point(geometry: Rect, holes: &[Rect]) -> Option<(f64, f64)> {
    let holes = athas_browser::clip_holes(geometry.width, geometry.height, holes);
    let part = athas_browser::visible_parts(geometry.width, geometry.height, &holes).into_iter().next()?;
    Some((geometry.x + part.x + part.width / 2.0, geometry.y + part.y + part.height / 2.0))
}

/// Where a page stands against workbench UI over it: `Clear` shows the whole page, `Capturing`
/// waits for a picture of the page to go under the UI, `Covered` makes room for the UI.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Occlusion {
    #[default]
    Clear,
    Capturing,
    Covered,
}

/// What a page's native view does this frame.
#[derive(Clone, Debug, PartialEq)]
pub enum Plan {
    /// Its slot is not on screen: hide it, and show the whole page next time.
    Hide,
    /// Make the native page now, over this part of the window.
    Create(Rect),
    /// Nothing covers it: show all of it here.
    Show(Rect),
    /// Leave it as it is: it has no page yet, or a picture of it is on its way.
    Wait,
    /// Take a picture of it to stand in under the UI, then cover it.
    Capture,
    /// Make room for the UI: show it here with these holes cut out, or hide it (`None`).
    Cover(Option<(Rect, Vec<Rect>)>),
}

/// What a page does, from the visible part of its slot, the holes workbench UI makes in it, and
/// its own state.
pub struct PlanInput<'a> {
    pub geometry: Option<Rect>,
    pub holes: &'a [Rect],
    pub created: bool,
    /// It has an address to load once it shows.
    pub pending: bool,
    /// The native page is on screen now.
    pub shown: bool,
    pub occlusion: Occlusion,
    pub capabilities: BrowserCapabilities,
}

pub fn plan(input: PlanInput) -> Plan {
    let Some(geometry) = input.geometry else { return Plan::Hide };
    let holes = input.holes;
    let hidden = !holes.is_empty() && (!input.capabilities.holes || is_covered(geometry.width, geometry.height, holes));
    if !input.created {
        return if !hidden && input.pending { Plan::Create(geometry) } else { Plan::Wait };
    }
    if holes.is_empty() {
        return Plan::Show(geometry);
    }
    match input.occlusion {
        Occlusion::Capturing => Plan::Wait,
        Occlusion::Clear if input.capabilities.snapshots && input.shown => Plan::Capture,
        _ => Plan::Cover((!hidden).then(|| (geometry, holes.to_vec()))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAC: BrowserCapabilities = BrowserCapabilities { holes: false, snapshots: true };
    const WINDOWS: BrowserCapabilities = BrowserCapabilities { holes: true, snapshots: false };
    const NONE: BrowserCapabilities = BrowserCapabilities { holes: false, snapshots: false };

    fn input(geometry: Option<Rect>, holes: &[Rect], capabilities: BrowserCapabilities) -> PlanInput<'_> {
        PlanInput { geometry, holes, created: true, pending: false, shown: true, occlusion: Occlusion::Clear, capabilities }
    }

    #[test]
    fn clips_the_slot_to_what_is_on_screen() {
        let window = Rect::new(0.0, 0.0, 1280.0, 820.0);
        assert_eq!(visible_slot_geometry(Rect::new(10.4, 20.6, 400.0, 300.0), window), Some(Rect::new(10.0, 21.0, 400.0, 300.0)));
        assert_eq!(visible_slot_geometry(Rect::new(1000.0, 700.0, 400.0, 300.0), window), Some(Rect::new(1000.0, 700.0, 280.0, 120.0)));
        assert_eq!(visible_slot_geometry(Rect::new(-50.0, 0.0, 100.0, 50.0), window), Some(Rect::new(0.0, 0.0, 50.0, 50.0)));
        assert_eq!(visible_slot_geometry(Rect::new(1300.0, 0.0, 100.0, 50.0), window), None);
        assert_eq!(visible_slot_geometry(Rect::new(10.0, 10.0, 0.5, 50.0), window), None);
    }

    #[test]
    fn turns_overlays_into_holes_relative_to_the_page_rounded_outwards() {
        let geometry = Rect::new(100.0, 50.0, 400.0, 300.0);
        let holes = local_holes(
            geometry,
            &[Rect::new(450.4, 40.0, 100.0, 30.2), Rect::new(450.4, 40.0, 100.0, 30.2), Rect::new(0.0, 0.0, 50.0, 50.0)],
        );
        assert_eq!(holes, vec![Rect::new(350.0, 0.0, 50.0, 21.0)]);
    }

    #[test]
    fn merges_a_crowd_of_holes_into_one() {
        let geometry = Rect::new(0.0, 0.0, 1000.0, 1000.0);
        let overlays: Vec<Rect> = (0..40).map(|index| Rect::new(index as f64 * 20.0, index as f64 * 10.0, 10.0, 10.0)).collect();
        assert_eq!(local_holes(geometry, &overlays), vec![Rect::new(0.0, 0.0, 790.0, 400.0)]);
    }

    #[test]
    fn knows_when_holes_cover_the_whole_page() {
        assert!(!is_covered(100.0, 80.0, &[]));
        assert!(!is_covered(100.0, 80.0, &[Rect::new(0.0, 0.0, 50.0, 80.0)]));
        assert!(is_covered(100.0, 80.0, &[Rect::new(0.0, 0.0, 50.0, 80.0), Rect::new(50.0, 0.0, 50.0, 80.0)]));
    }

    #[test]
    fn finds_a_point_of_the_page_outside_the_ui_over_it() {
        let geometry = Rect::new(100.0, 50.0, 400.0, 300.0);
        let menu = Rect::new(300.0, 0.0, 100.0, 120.0);
        let (x, y) = uncovered_point(geometry, &[menu]).expect("the page shows around the menu");
        assert!(x >= geometry.x && x <= geometry.x + geometry.width && y >= geometry.y && y <= geometry.y + geometry.height);
        assert!(!athas_browser::is_in_hole(&[menu], x - geometry.x, y - geometry.y));
        assert_eq!(uncovered_point(geometry, &[]), Some((300.0, 200.0)));
        assert_eq!(uncovered_point(geometry, &[Rect::new(-10.0, -10.0, 500.0, 500.0)]), None);
    }

    #[test]
    fn hides_a_page_whose_slot_is_not_shown() {
        assert_eq!(plan(input(None, &[], MAC)), Plan::Hide);
    }

    #[test]
    fn makes_the_page_the_first_time_its_slot_shows() {
        let geometry = Rect::new(0.0, 40.0, 800.0, 600.0);
        let mut first = input(Some(geometry), &[], MAC);
        first.created = false;
        first.pending = true;
        assert_eq!(plan(first), Plan::Create(geometry));
        let mut blank = input(Some(geometry), &[], MAC);
        blank.created = false;
        assert_eq!(plan(blank), Plan::Wait);
        let menu = [Rect::new(0.0, 0.0, 800.0, 600.0)];
        let mut covered = input(Some(geometry), &menu, MAC);
        covered.created = false;
        covered.pending = true;
        assert_eq!(plan(covered), Plan::Wait);
    }

    #[test]
    fn shows_the_whole_page_when_nothing_covers_it() {
        let geometry = Rect::new(0.0, 40.0, 800.0, 600.0);
        assert_eq!(plan(input(Some(geometry), &[], NONE)), Plan::Show(geometry));
    }

    #[test]
    fn takes_a_picture_before_making_room_on_macos() {
        let geometry = Rect::new(0.0, 40.0, 800.0, 600.0);
        let menu = [Rect::new(600.0, 0.0, 200.0, 150.0)];
        assert_eq!(plan(input(Some(geometry), &menu, MAC)), Plan::Capture);
        let mut capturing = input(Some(geometry), &menu, MAC);
        capturing.occlusion = Occlusion::Capturing;
        assert_eq!(plan(capturing), Plan::Wait);
        let mut pictured = input(Some(geometry), &menu, MAC);
        pictured.occlusion = Occlusion::Covered;
        assert_eq!(plan(pictured), Plan::Cover(None));
        let mut hidden = input(Some(geometry), &menu, MAC);
        hidden.shown = false;
        assert_eq!(plan(hidden), Plan::Cover(None));
    }

    #[test]
    fn cuts_holes_where_the_platform_can() {
        let geometry = Rect::new(0.0, 40.0, 800.0, 600.0);
        let menu = [Rect::new(600.0, 0.0, 200.0, 150.0)];
        assert_eq!(plan(input(Some(geometry), &menu, WINDOWS)), Plan::Cover(Some((geometry, menu.to_vec()))));
        let dialog = [Rect::new(0.0, 0.0, 800.0, 600.0)];
        assert_eq!(plan(input(Some(geometry), &dialog, WINDOWS)), Plan::Cover(None));
        assert_eq!(plan(input(Some(geometry), &menu, NONE)), Plan::Cover(None));
    }
}
