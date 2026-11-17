//! The workbench's spacing and sizes (`--athas-*` in `styles/theme.css`).

use gpui::{Pixels, px};

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
/// The activity bar's controls, and the bar's width.
pub const RAIL_CONTROL: Pixels = px(32.);
pub const CHROME_HIT_TARGET: Pixels = px(28.);
pub const CHROME_GAP_TIGHT: Pixels = px(2.);
pub const CHROME_GAP: Pixels = px(4.);
pub const CHROME_PADDING_INLINE: Pixels = px(6.);
pub const RADIUS: Pixels = px(4.);
pub const RADIUS_MD: Pixels = px(6.);
pub const RADIUS_LG: Pixels = px(8.);
/// The macOS traffic lights take this much of the top-left row.
pub const TRAFFIC_LIGHTS_INSET: Pixels = px(84.);
pub const SIDEBAR_DEFAULT_WIDTH: Pixels = px(220.);
pub const SIDEBAR_MIN_WIDTH: Pixels = px(140.);
/// The column of session boxes the dock shows while no tool pane is open.
pub const SESSION_BOXES_WIDTH: Pixels = px(288.);
pub const DOCK_DEFAULT_WIDTH: Pixels = px(420.);
pub const MIN_CENTRE_WIDTH: Pixels = px(360.);
/// Below this window width the sidebar floats over the centre instead of taking a column.
pub const NARROW_WINDOW: Pixels = px(760.);
