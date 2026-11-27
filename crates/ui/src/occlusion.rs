//! Floating UI (menus, popovers, dialogs, toasts) reports where it paints each frame, so native
//! views placed over the window, such as browser pages, can make room for it.

use std::collections::HashMap;

use gpui::{App, Bounds, Global, IntoElement, Pixels, Point, Styled, Window, WindowId, canvas};

#[derive(Default)]
struct Overlays(HashMap<WindowId, Vec<Bounds<Pixels>>>);

impl Global for Overlays {}

/// Starts a frame of `window`: forgets the overlays of the last one. Only windows that start
/// frames keep reports.
pub fn begin_frame(window: &Window, cx: &mut App) {
    cx.default_global::<Overlays>().0.insert(window.window_handle().window_id(), Vec::new());
}

/// Floating UI paints over `bounds` this frame.
pub fn report(bounds: Bounds<Pixels>, window: &Window, cx: &mut App) {
    if let Some(overlays) = cx.default_global::<Overlays>().0.get_mut(&window.window_handle().window_id()) {
        overlays.push(bounds);
    }
}

/// Where floating UI paints in `window` this frame, as far as it has been laid out.
pub fn overlays(window: &Window, cx: &App) -> Vec<Bounds<Pixels>> {
    cx.try_global::<Overlays>().and_then(|overlays| overlays.0.get(&window.window_handle().window_id()).cloned()).unwrap_or_default()
}

/// Whether `point` falls on floating UI painted in `window`. A capture-phase handler runs
/// before the elements under the pointer and occlusion does not stop it, so one that treats a
/// press as a press on what it covers asks this first.
pub fn over_overlay(point: Point<Pixels>, window: &Window, cx: &App) -> bool {
    overlays(window, cx).iter().any(|bounds| bounds.contains(&point))
}

/// Reports its parent's bounds as floating UI. The parent must be positioned.
pub fn occluder() -> impl IntoElement {
    canvas(|bounds, window, cx| report(bounds, window, cx), |_, _, _, _| {}).absolute().inset_0()
}

#[cfg(test)]
mod tests {
    //! What an occluder reports has to be where its overlay paints. It did not: with no insets
    //! of its own, an absolute child sits where it would have been in flow -- under the content
    //! it is meant to cover -- so a card hanging above its anchor reported the empty band below
    //! it. The Quote card over a selection is the one that showed it: the session treats a press
    //! outside every overlay as a press on the transcript and closes the card, so the card closed
    //! on the press and its own button never heard the click.

    use std::{cell::Cell, rc::Rc};

    use gpui::{Anchor, Modifiers, MouseDownEvent, Render, canvas, div, point, prelude::*};

    use crate::scale::px;

    /// A card hanging above (200, 200), as the quote card hangs over a selection.
    const ANCHOR: f32 = 200.;

    struct Root {
        clicks: Rc<Cell<usize>>,
        saw_overlay: Rc<Cell<Option<bool>>>,
    }

    impl Render for Root {
        fn render(&mut self, _: &mut gpui::Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
            div()
                .size_full()
                // Stands in for the workbench's frame tracker, which starts the frame that
                // overlays report into.
                .child(canvas(|_, window, cx| super::begin_frame(window, cx), |_, _, _, _| {}).absolute().size_0())
                .capture_any_mouse_down(cx.listener(|this: &mut Root, event: &MouseDownEvent, window, cx| {
                    this.saw_overlay.set(Some(super::over_overlay(event.position, window, cx)));
                }))
                .child(crate::anchored_overlay(
                    point(px(ANCHOR), px(ANCHOR)),
                    Anchor::BottomLeft,
                    px(8.),
                    crate::Button::new("quote", "Quote").on_click(cx.listener(|this: &mut Root, _, _, _| this.clicks.set(this.clicks.get() + 1))),
                ))
        }
    }

    #[gpui::test]
    fn a_press_on_an_anchored_overlay_lands_on_it(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| theme::init(cx, None, theme::Appearance::Dark, false));
        let (clicks, saw_overlay) = (Rc::new(Cell::new(0)), Rc::new(Cell::new(None)));
        let (_root, cx) = cx.add_window_view({
            let (clicks, saw_overlay) = (clicks.clone(), saw_overlay.clone());
            |_, _| Root { clicks, saw_overlay }
        });
        cx.run_until_parked();

        let reported = cx.update(|window, cx| super::overlays(window, cx));
        assert_eq!(reported.len(), 1, "the overlay reported no bounds");
        let card = reported[0];
        assert!(card.bottom() <= px(ANCHOR), "the card hangs above its anchor, so its bounds must too: {card:?}");

        let center = card.center();
        cx.simulate_mouse_move(center, None, Modifiers::default());
        cx.run_until_parked();
        cx.simulate_click(center, Modifiers::default());
        assert_eq!(saw_overlay.get(), Some(true), "a press on the card read as a press outside it");
        assert_eq!(clicks.get(), 1, "the card's own button did not take the press");
    }
}
