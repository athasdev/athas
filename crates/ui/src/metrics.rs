//! The workbench's spacing and sizes (`--athas-*` in `styles/theme.css`).

use gpui::Pixels;

use crate::scale;

/// The spacing scale: every gap, padding and margin in the app is one of these steps.
///
/// It is not an invention — 96% of the app's spacing already sits on these twelve values. Naming
/// them is what keeps the other 4% from coming back: a `gap(px(14.))` beside a `gap(px(12.))` in
/// the next panel is how two surfaces that should match stop matching. Sizes, widths and radii
/// are not spacing and are not on this scale; they have their own constants below.
///
/// Two steps apart is a visible difference, one step is a nudge. Reach for the next step up
/// rather than the half-step that is not here.
pub mod space {
    use super::{Pixels, scale};

    /// Touching: a dot against its label.
    pub fn hair() -> Pixels { scale::px(1.) }
    /// Inside one control, between parts that belong to each other.
    pub fn tight() -> Pixels { scale::px(2.) }
    /// An icon from its label; a row's vertical padding.
    pub fn snug() -> Pixels { scale::px(4.) }
    /// Between controls in a group; a dense row's inline padding.
    pub fn cozy() -> Pixels { scale::px(6.) }
    /// The default: most gaps and most padding inside a row or a control.
    pub fn base() -> Pixels { scale::px(8.) }
    /// A touch looser than the default, where `BASE` crowds.
    pub fn comfy() -> Pixels { scale::px(10.) }
    /// Between the parts of a pane: a header from its list, a field from the next.
    pub fn section() -> Pixels { scale::px(12.) }
    /// Between sections of a page.
    pub fn group() -> Pixels { scale::px(16.) }
    /// A page's inset from its pane.
    pub fn page() -> Pixels { scale::px(20.) }
    /// Around a dialog's content, and between a page's major blocks.
    pub fn wide() -> Pixels { scale::px(24.) }
    /// The widest step: an empty state's breathing room.
    pub fn broad() -> Pixels { scale::px(32.) }

    /// Every step, smallest first — what the design guard measures against.
    pub const STEPS: [f32; 12] = [0., 1., 2., 4., 6., 8., 10., 12., 16., 20., 24., 32.];

    /// Whether `value` is a step of the scale.
    pub fn is_on_scale(value: f32) -> bool {
        STEPS.contains(&value)
    }

    /// The step nearest `value`, for deciding what an off-scale spacing should become. Ties go
    /// to the tighter step: this is a dense UI, and loosening is the more visible mistake.
    pub fn nearest(value: f32) -> f32 {
        STEPS
            .iter()
            .copied()
            .min_by(|a, b| {
                let (da, db) = ((a - value).abs(), (b - value).abs());
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal).then(a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            })
            .unwrap_or(value)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn the_scale_is_ordered_and_distinct() {
            assert!(STEPS.windows(2).all(|pair| pair[0] < pair[1]));
            assert_eq!(STEPS.len(), 12);
        }

        #[test]
        fn knows_its_own_steps() {
            assert!(STEPS.iter().all(|step| is_on_scale(*step)));
            for off in [3., 5., 7., 9., 11., 14., 18., 22.] {
                assert!(!is_on_scale(off), "{off}");
            }
        }

        #[test]
        fn snaps_to_the_nearest_step_and_ties_tighten() {
            assert_eq!(nearest(3.), 2.);
            assert_eq!(nearest(5.), 4.);
            assert_eq!(nearest(7.), 6.);
            assert_eq!(nearest(11.), 10.);
            assert_eq!(nearest(14.), 12.);
            assert_eq!(nearest(18.), 16.);
            assert_eq!(nearest(22.), 20.);
            // Already a step: unchanged.
            assert_eq!(nearest(8.), 8.);
        }
    }
}

/// Every pane header (editor tabs, sessions, dock panes, the bottom pane) is this one row.
pub fn pane_header() -> Pixels { scale::px(40.) }
/// A bar at the top of a pane's content, such as a search field (`ChromeBar region="content"`).
pub fn content_header() -> Pixels { scale::px(28.) }
/// One row of a list: sessions, files, branches and every other sidebar or dock list.
pub fn list_row() -> Pixels { scale::px(28.) }
pub fn tab() -> Pixels { scale::px(24.) }
pub fn tab_max_width() -> Pixels { scale::px(200.) }
/// The one gutter: around the workbench and between its columns and stacked panes.
pub fn workbench_gap() -> Pixels { scale::px(6.) }
/// Islands round a little more than controls, so they read as cards set into the window.
pub fn island_radius() -> Pixels { scale::px(10.) }
/// Where a pane's first item starts from its island's edge.
pub fn pane_inset() -> Pixels { scale::px(12.) }
pub fn chrome_control() -> Pixels { scale::px(24.) }
/// The activity bar's controls, and the bar's width: one trigger wide, no slack around it, so a
/// rail icon measures the same as the list row beside it.
pub fn rail_control() -> Pixels { scale::px(28.) }
pub fn chrome_hit_target() -> Pixels { scale::px(28.) }
pub fn chrome_gap_tight() -> Pixels { scale::px(2.) }
pub fn chrome_gap() -> Pixels { scale::px(4.) }
pub fn chrome_padding_inline() -> Pixels { scale::px(6.) }
/// The radius ladder. A corner belongs to the surface it is on: the smaller the thing, the
/// tighter the corner, so a key cap and a command palette do not round the same way.
/// Smallest things: a key cap, a chip inside a row.
pub fn radius_sm() -> Pixels { scale::px(2.) }
/// The base: buttons, fields, rows and anything else a pointer acts on.
pub fn radius() -> Pixels { scale::px(4.) }
/// A little softer, for popovers and surfaces that sit over content.
pub fn radius_md() -> Pixels { scale::px(6.) }
pub fn radius_lg() -> Pixels { scale::px(8.) }
/// A block of content rather than a control: a message bubble, a grouped panel.
pub fn radius_xl() -> Pixels { scale::px(12.) }
/// What floats clear of the window: the command palette and the surfaces like it.
pub fn overlay_radius() -> Pixels { scale::px(16.) }
/// Where the macOS window buttons end. AppKit draws them at its own size whatever the window is
/// zoomed to: from `traffic_light_position`'s x 9, three 14px buttons 9 apart, so the last ends
/// at 69. Measure it again with `cargo run -p ui --example traffic_lights`.
pub const TRAFFIC_LIGHTS_END: f32 = 69.;

/// What the first thing in the title row clears: the window buttons, which hold their size at
/// every zoom, and one inline padding, which does not.
pub fn traffic_lights_inset() -> Pixels { gpui::px(TRAFFIC_LIGHTS_END) + chrome_padding_inline() }

#[cfg(test)]
mod traffic_lights {
    use super::*;

    /// What `cargo run -p ui --example traffic_lights` reads off a plain macOS window: the close
    /// button at x 9, three 14px buttons 9 apart. The workbench asks AppKit for the same x, so
    /// its buttons land where every other app's do and the row after them starts clear of 69.
    const CLOSE_X: f32 = 9.;
    const BUTTON: f32 = 14.;
    const GAP: f32 = 9.;

    #[test]
    fn the_row_starts_where_the_window_buttons_end() {
        let last_button_ends = CLOSE_X + BUTTON + GAP + BUTTON + GAP + BUTTON;
        assert_eq!(last_button_ends, TRAFFIC_LIGHTS_END);
        assert_eq!(traffic_lights_inset(), gpui::px(TRAFFIC_LIGHTS_END) + chrome_padding_inline());
    }

    /// The buttons keep AppKit's size at every zoom, so the inset only zooms the padding after
    /// them. Zooming the whole inset would walk the title row away from the buttons.
    #[test]
    fn zoom_moves_the_padding_and_not_the_buttons() {
        let at_100 = traffic_lights_inset();
        crate::scale::set_zoom_for_test(2.0);
        let at_200 = traffic_lights_inset();
        crate::scale::set_zoom_for_test(1.0);
        assert_eq!(at_200 - at_100, chrome_padding_inline());
    }
}
pub fn sidebar_default_width() -> Pixels { scale::px(220.) }
pub fn sidebar_min_width() -> Pixels { scale::px(140.) }
/// The column of session boxes the dock shows while no tool pane is open.
pub fn session_boxes_width() -> Pixels { scale::px(288.) }
pub fn dock_default_width() -> Pixels { scale::px(420.) }
pub fn min_centre_width() -> Pixels { scale::px(360.) }
/// Below this window width the sidebar floats over the centre instead of taking a column.
pub fn narrow_window() -> Pixels { scale::px(760.) }
