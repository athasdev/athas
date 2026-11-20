//! A dialog an extension opened (`extension-dialog.tsx`): its title, a close button, and the
//! extension's view for the dialog's id. Closing it tells the host.

use extension_host::Dialog;
use gpui::{Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, Render, Window, div, prelude::*, px};
use ui::DialogSize;

use crate::extension_view::{ExtensionView, Surface};
use crate::ui_extensions::{self, UiExtensions};

pub struct ExtensionDialog {
    dialog: Dialog,
    view: Entity<ExtensionView>,
    focus_handle: FocusHandle,
    _observe: gpui::Subscription,
}

impl ExtensionDialog {
    pub fn new(dialog: Dialog, cx: &mut Context<Self>) -> Self {
        let view = cx.new(|cx| ExtensionView::for_extension(dialog.extension_id.clone(), dialog.id.clone(), Surface::Embedded, cx));
        // The extension closing it, or stopping, dismisses it.
        let observe = cx.observe_global::<UiExtensions>(|this: &mut Self, cx| {
            if !ui_extensions::dialogs(cx).iter().any(|open| open.id == this.dialog.id) {
                cx.emit(DismissEvent);
            }
        });
        // Put away by the workbench (a click outside, another modal): the extension hears of it.
        cx.on_release(|this: &mut Self, cx| ui_extensions::close_dialog(&this.dialog.id, cx)).detach();
        Self { dialog, view, focus_handle: cx.focus_handle(), _observe: observe }
    }

    pub fn id(&self) -> &str {
        &self.dialog.id
    }

    fn close(&mut self, cx: &mut Context<Self>) {
        ui_extensions::close_dialog(&self.dialog.id, cx);
        cx.emit(DismissEvent);
    }
}

impl EventEmitter<DismissEvent> for ExtensionDialog {}

impl Focusable for ExtensionDialog {
    fn focus_handle(&self, _: &gpui::App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for ExtensionDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let width = px(self.dialog.width.unwrap_or(480.) as f32);
        let height = px(self.dialog.height.unwrap_or(600.) as f32);
        let weak = cx.weak_entity();
        ui::Dialog::new("extension-dialog", self.dialog.title.clone())
            .size(DialogSize::Custom(width))
            .track_focus(&self.focus_handle)
            .on_close(move |_, cx| {
                weak.update(cx, |this, cx| this.close(cx)).ok();
            })
            .child(div().flex().flex_col().max_h(height - px(52.)).child(self.view.clone()))
    }
}
