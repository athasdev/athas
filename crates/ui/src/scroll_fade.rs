//! The fade at a scrolling area's clipped edge.
//!
//! A list that runs past its box gives nothing away: the last row is cut mid-height if you are
//! lucky, and sits flush with the edge if you are not. The scrollbar only appears while you are
//! already scrolling, so before you touch it there is nothing to say the list goes on.
//!
//! So whichever edge is hiding something fades into the surface behind it. Flat when everything
//! fits -- the fade is the sign that there is more, and it is the same sign everywhere.

use gpui::{Div, Hsla, IntoElement, ParentElement, ScrollHandle, Styled, div, linear_color_stop, linear_gradient, prelude::*};

use crate::scale::px;

/// How far the fade reaches in. Deep enough to read as a fade rather than a line, shallow enough
/// to leave the row under it legible.
const DEPTH: f32 = 24.;

/// A pixel of slack: a list scrolled to its very end lands a hair short often enough that an
/// exact comparison leaves the fade on over nothing.
const SLACK: f32 = 1.;

/// Wraps a scrolling element so whichever edge hides content fades into `plane`, the colour of
/// the surface it sits on.
///
/// The wrapper does the positioning, so the element passed in keeps its own `overflow_y_scroll`,
/// its scroll handle and its scrollbar. The fades take no pointer events: they are unidentified
/// divs, which GPUI does not hit-test.
pub fn faded_scroll(content: impl IntoElement, handle: &ScrollHandle, plane: Hsla) -> Div {
    // `offset().y` is 0 at the top and goes negative as the content rises; `max_offset().y` is
    // how far it can go. Both are 0 before the first layout, which reads as "nothing hidden" --
    // the right answer for a frame that has not measured anything yet.
    let scrolled = -handle.offset().y;
    let furthest = handle.max_offset().y;
    let above = scrolled > px(SLACK);
    let below = scrolled < furthest - px(SLACK);
    let clear = Hsla { a: 0., ..plane };
    // No `flex_1` and no height of its own: the wrapper takes whatever shape the caller gives
    // it, so a panel that fills and a popup that grows to a maximum both keep theirs.
    div()
        .relative()
        .flex()
        .flex_col()
        .min_h_0()
        .min_w_0()
        .child(content)
        .when(above, |this| this.child(fade(plane, clear, true)))
        .when(below, |this| this.child(fade(plane, clear, false)))
}

/// The same for an area that scrolls sideways, fading its left and right edges.
pub fn faded_scroll_x(content: impl IntoElement, handle: &ScrollHandle, plane: Hsla) -> Div {
    let scrolled = -handle.offset().x;
    let furthest = handle.max_offset().x;
    let before = scrolled > px(SLACK);
    let after = scrolled < furthest - px(SLACK);
    let clear = Hsla { a: 0., ..plane };
    div()
        .relative()
        .flex()
        .min_h_0()
        .min_w_0()
        .child(content)
        .when(before, |this| this.child(side_fade(plane, clear, true)))
        .when(after, |this| this.child(side_fade(plane, clear, false)))
}

/// Solid against the edge it sits on, clear by the time it is `DEPTH` in.
fn fade(plane: Hsla, clear: Hsla, top: bool) -> Div {
    let angle = if top { 180. } else { 0. };
    div()
        .absolute()
        .left_0()
        .right_0()
        .h(px(DEPTH))
        .map(|this| if top { this.top_0() } else { this.bottom_0() })
        .bg(linear_gradient(angle, linear_color_stop(plane, 0.), linear_color_stop(clear, 1.)))
}

fn side_fade(plane: Hsla, clear: Hsla, left: bool) -> Div {
    let angle = if left { 90. } else { 270. };
    div()
        .absolute()
        .top_0()
        .bottom_0()
        .w(px(DEPTH))
        .map(|this| if left { this.left_0() } else { this.right_0() })
        .bg(linear_gradient(angle, linear_color_stop(plane, 0.), linear_color_stop(clear, 1.)))
}

/// The same for a `uniform_list`, which keeps its scroll state one layer in.
pub fn faded_uniform_scroll(content: impl IntoElement, handle: &gpui::UniformListScrollHandle, plane: Hsla) -> Div {
    let base = handle.0.borrow().base_handle.clone();
    faded_scroll(content, &base, plane)
}
