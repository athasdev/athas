#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
pub fn disable_macos_autofill_heuristics() {
   use objc::{
      class, msg_send,
      runtime::{NO, Object},
      sel, sel_impl,
   };
   use std::ffi::CString;

   // Disables macOS AutoFill heuristics in the app webview process.
   // This is known to reduce extra AutoFill subprocess activity.
   unsafe {
      let key_cstr = match CString::new("NSAutoFillHeuristicControllerEnabled") {
         Ok(value) => value,
         Err(_) => return,
      };

      let key: *mut Object = msg_send![class!(NSString), stringWithUTF8String: key_cstr.as_ptr()];
      if key.is_null() {
         return;
      }

      let user_defaults: *mut Object = msg_send![class!(NSUserDefaults), standardUserDefaults];
      if user_defaults.is_null() {
         return;
      }

      let existing_value: *mut Object = msg_send![user_defaults, objectForKey: key];
      if existing_value.is_null() {
         let false_value: *mut Object = msg_send![class!(NSNumber), numberWithBool: NO];
         if false_value.is_null() {
            return;
         }

         let _: () = msg_send![user_defaults, setObject: false_value forKey: key];
      }
   }
}
