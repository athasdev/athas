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
/// A workbench pane: the sidebar, the centre, the editor. It rounds a little more than the cards
/// inside it, so it reads as the surface they are set into. A card on a page is `radius_lg`, not
/// this; mixing the two put 8px and 10px corners side by side on the same page.
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
/// tighter the corner, so a key cap and a command palette do not round the same way. Pick the
/// rung by what the thing *is* — two of a kind round alike, wherever they are drawn.
/// A key cap or a chip inside a row.
pub fn radius_sm() -> Pixels { scale::px(2.) }
/// Small marks a pointer acts on: a checkbox, a crumb, a drag chip, a slider step.
pub fn radius() -> Pixels { scale::px(4.) }
/// Controls and the rows a pointer runs down: a button, a list row, a menu item, a select
/// option, a tooltip.
pub fn radius_md() -> Pixels { scale::px(6.) }
/// What holds them: a card, a field, a menu or select panel.
pub fn radius_lg() -> Pixels { scale::px(8.) }
/// A block of content rather than a control: a message bubble, a grouped panel.
pub fn radius_xl() -> Pixels { scale::px(12.) }
/// What floats clear of the window: the command palette and the surfaces like it.
pub fn overlay_radius() -> Pixels { scale::px(16.) }
/// The macOS window buttons, as AppKit draws them. It holds its own size and spacing whatever
/// the window is zoomed to, so these do not scale. Measure them again with
/// `cargo run -p ui --example traffic_lights`.
///
/// The close button's left edge, which is the inset every other Mac app has.
pub const TRAFFIC_LIGHT_X: f32 = 9.;
/// One button, square.
pub const TRAFFIC_LIGHT_SIZE: f32 = 14.;
/// Where the last of the three ends: `9 + 3 * 14 + 2 * 9`.
pub const TRAFFIC_LIGHTS_END: f32 = 69.;

/// Where to ask AppKit for the window buttons so their row centres on `centre` below the window's
/// top. GPUI makes their container `TRAFFIC_LIGHT_SIZE + 2y` tall and puts them `y` up from its
/// bottom, so their centre lands `y + SIZE / 2` down from the top.
///
/// A window has to ask again whenever `centre` moves: AppKit leaves them wherever it was last
/// told, so a zoom that changes the title strip's height otherwise leaves them off it.
pub fn traffic_light_position(centre: Pixels) -> gpui::Point<Pixels> {
    gpui::point(gpui::px(TRAFFIC_LIGHT_X), centre - gpui::px(TRAFFIC_LIGHT_SIZE / 2.))
}

/// Where the workbench wants them: the middle of its title strip.
pub fn workbench_traffic_lights() -> gpui::Point<Pixels> {
    traffic_light_position(pane_header() / 2.)
}

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

    /// The strip grows with the zoom but the buttons do not, so the window asks for a new
    /// position each time: centred on the strip at every level, as the title row beside them is.
    /// The row's own inset moves only by its padding, since the buttons hold their size.
    #[test]
    fn the_buttons_and_the_row_line_up_at_every_zoom() {
        let _held = crate::scale::TEST_LOCK.lock().unwrap_or_else(|held| held.into_inner());
        crate::scale::set_zoom_for_test(1.0);
        // A 40px strip puts a 14px button at 13, which is what the window opens with.
        assert_eq!(workbench_traffic_lights(), gpui::point(gpui::px(TRAFFIC_LIGHT_X), gpui::px(13.)));
        let inset_at_100 = traffic_lights_inset();

        for zoom in [0.75, 1.5, 2.0] {
            crate::scale::set_zoom_for_test(zoom);
            let centre = pane_header() / 2.;
            assert_eq!(workbench_traffic_lights().y + gpui::px(TRAFFIC_LIGHT_SIZE / 2.), centre, "centred at {zoom}x");
            assert_eq!(workbench_traffic_lights().x, gpui::px(TRAFFIC_LIGHT_X), "the left inset holds at {zoom}x");
        }

        crate::scale::set_zoom_for_test(2.0);
        assert_eq!(traffic_lights_inset() - inset_at_100, chrome_padding_inline() / 2., "only the padding zooms");
        crate::scale::set_zoom_for_test(1.0);
    }

    #[test]
    fn the_row_starts_where_the_window_buttons_end() {
        let last_button_ends = CLOSE_X + BUTTON + GAP + BUTTON + GAP + BUTTON;
        assert_eq!(CLOSE_X, TRAFFIC_LIGHT_X);
        assert_eq!(BUTTON, TRAFFIC_LIGHT_SIZE);
        assert_eq!(last_button_ends, TRAFFIC_LIGHTS_END);
        assert_eq!(traffic_lights_inset(), gpui::px(TRAFFIC_LIGHTS_END) + chrome_padding_inline());
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
