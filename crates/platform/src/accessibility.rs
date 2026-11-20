//! Reads the system's accessibility display options (`get_system_accessibility_preferences`):
//! NSWorkspace on macOS; other platforms report none.

use theme::SystemAccessibility;

#[cfg(target_os = "macos")]
pub fn read() -> SystemAccessibility {
    use objc2::{class, msg_send, runtime::{AnyObject, Bool}};

    unsafe {
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return SystemAccessibility::default();
        }
        let reduce_transparency: Bool = msg_send![workspace, accessibilityDisplayShouldReduceTransparency];
        let increase_contrast: Bool = msg_send![workspace, accessibilityDisplayShouldIncreaseContrast];
        let differentiate_without_color: Bool = msg_send![workspace, accessibilityDisplayShouldDifferentiateWithoutColor];
        let reduce_motion: Bool = msg_send![workspace, accessibilityDisplayShouldReduceMotion];
        SystemAccessibility {
            reduce_transparency: reduce_transparency.as_bool(),
            increase_contrast: increase_contrast.as_bool(),
            differentiate_without_color: differentiate_without_color.as_bool(),
            reduce_motion: reduce_motion.as_bool(),
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn read() -> SystemAccessibility {
    SystemAccessibility::default()
}
