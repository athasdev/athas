//! The workbench's spacing and sizes (`--athas-*` in `styles/theme.css`).

use gpui::{Pixels, px};

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
    use super::{Pixels, px};

    /// Touching: a dot against its label.
    pub const HAIR: Pixels = px(1.);
    /// Inside one control, between parts that belong to each other.
    pub const TIGHT: Pixels = px(2.);
    /// An icon from its label; a row's vertical padding.
    pub const SNUG: Pixels = px(4.);
    /// Between controls in a group; a dense row's inline padding.
    pub const COZY: Pixels = px(6.);
    /// The default: most gaps and most padding inside a row or a control.
    pub const BASE: Pixels = px(8.);
    /// A touch looser than the default, where `BASE` crowds.
    pub const COMFY: Pixels = px(10.);
    /// Between the parts of a pane: a header from its list, a field from the next.
    pub const SECTION: Pixels = px(12.);
    /// Between sections of a page.
    pub const GROUP: Pixels = px(16.);
    /// A page's inset from its pane.
    pub const PAGE: Pixels = px(20.);
    /// Around a dialog's content, and between a page's major blocks.
    pub const WIDE: Pixels = px(24.);
    /// The widest step: an empty state's breathing room.
    pub const BROAD: Pixels = px(32.);

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
pub const PANE_HEADER: Pixels = px(40.);
/// A bar at the top of a pane's content, such as a search field (`ChromeBar region="content"`).
pub const CONTENT_HEADER: Pixels = px(28.);
/// One row of a list: sessions, files, branches and every other sidebar or dock list.
pub const LIST_ROW: Pixels = px(28.);
pub const TAB: Pixels = px(24.);
pub const TAB_MAX_WIDTH: Pixels = px(200.);
/// The one gutter: around the workbench and between its columns and stacked panes.
pub const WORKBENCH_GAP: Pixels = px(6.);
/// Islands round a little more than controls, so they read as cards set into the window.
pub const ISLAND_RADIUS: Pixels = px(10.);
/// Where a pane's first item starts from its island's edge.
pub const PANE_INSET: Pixels = px(12.);
pub const CHROME_CONTROL: Pixels = px(24.);
/// The activity bar's controls, and the bar's width: one trigger wide, no slack around it, so a
/// rail icon measures the same as the list row beside it.
pub const RAIL_CONTROL: Pixels = px(28.);
pub const CHROME_HIT_TARGET: Pixels = px(28.);
pub const CHROME_GAP_TIGHT: Pixels = px(2.);
pub const CHROME_GAP: Pixels = px(4.);
pub const CHROME_PADDING_INLINE: Pixels = px(6.);
/// The radius ladder. A corner belongs to the surface it is on: the smaller the thing, the
/// tighter the corner, so a key cap and a command palette do not round the same way.
/// Smallest things: a key cap, a chip inside a row.
pub const RADIUS_SM: Pixels = px(2.);
/// The base: buttons, fields, rows and anything else a pointer acts on.
pub const RADIUS: Pixels = px(4.);
/// A little softer, for popovers and surfaces that sit over content.
pub const RADIUS_MD: Pixels = px(6.);
pub const RADIUS_LG: Pixels = px(8.);
/// A block of content rather than a control: a message bubble, a grouped panel.
pub const RADIUS_XL: Pixels = px(12.);
/// What floats clear of the window: the command palette and the surfaces like it.
pub const OVERLAY_RADIUS: Pixels = px(16.);
/// The macOS traffic lights take this much of the top-left row. AppKit places them from
/// `options`' x 16 and spaces them itself: the three 14px buttons centre at 23, 46 and 69, so the
/// last ends at 76. One inline padding after that keeps the first trigger clear of them.
pub const TRAFFIC_LIGHTS_INSET: Pixels = px(82.);
pub const SIDEBAR_DEFAULT_WIDTH: Pixels = px(220.);
pub const SIDEBAR_MIN_WIDTH: Pixels = px(140.);
/// The column of session boxes the dock shows while no tool pane is open.
pub const SESSION_BOXES_WIDTH: Pixels = px(288.);
pub const DOCK_DEFAULT_WIDTH: Pixels = px(420.);
pub const MIN_CENTRE_WIDTH: Pixels = px(360.);
/// Below this window width the sidebar floats over the centre instead of taking a column.
pub const NARROW_WINDOW: Pixels = px(760.);
