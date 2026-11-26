//! User verification before a passkey is made or used: Touch ID or the login password on macOS,
//! Windows Hello on Windows. A passkey signed after it carries the UV flag, as a platform
//! authenticator's does.

use futures::channel::oneshot;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verification {
    /// The owner of the device confirmed.
    Verified,
    /// The user backed out of the system prompt.
    Cancelled,
    /// The device has no way to verify (no password set, no Windows Hello); the click on Continue
    /// is all the presence there is.
    Unavailable,
}

/// Asks the system to verify the user for `reason`; resolves once they answer.
pub fn verify_user(reason: &str) -> oneshot::Receiver<Verification> {
    let (sender, receiver) = oneshot::channel();
    platform::verify(reason, sender);
    receiver
}

/// What the system prompt is called, for the button that starts it.
pub fn method_name() -> &'static str {
    platform::METHOD
}

#[cfg(target_os = "macos")]
mod platform {
    use std::sync::Mutex;

    use block2::RcBlock;
    use futures::channel::oneshot::Sender;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAError, LAPolicy};

    use super::Verification;

    pub const METHOD: &str = "Touch ID";

    pub fn verify(reason: &str, sender: Sender<Verification>) {
        // SAFETY: LAContext is thread-safe to create and evaluate; the reply block runs once on a
        // private queue and only sends on the channel.
        unsafe {
            let context = LAContext::new();
            let policy = LAPolicy::DeviceOwnerAuthentication;
            if context.canEvaluatePolicy_error(policy).is_err() {
                let _ = sender.send(Verification::Unavailable);
                return;
            }
            let sender = Mutex::new(Some(sender));
            let reply = RcBlock::new(move |success: Bool, error: *mut NSError| {
                let code = error.as_ref().map(|error| error.code());
                let result = if success.as_bool() {
                    Verification::Verified
                } else if code == Some(LAError::PasscodeNotSet.0) {
                    Verification::Unavailable
                } else {
                    Verification::Cancelled
                };
                if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                    let _ = sender.send(result);
                }
            });
            context.evaluatePolicy_localizedReason_reply(policy, &NSString::from_str(reason), &reply);
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use futures::channel::oneshot::Sender;
    use windows::{
        Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability},
        core::HSTRING,
    };

    use super::Verification;

    pub const METHOD: &str = "Windows Hello";

    pub fn verify(reason: &str, sender: Sender<Verification>) {
        let reason = HSTRING::from(reason);
        // The WinRT calls block until the user answers, so they wait off the main thread.
        std::thread::spawn(move || {
            let available = UserConsentVerifier::CheckAvailabilityAsync()
                .and_then(|operation| operation.join())
                .is_ok_and(|availability| availability == UserConsentVerifierAvailability::Available);
            let result = if !available {
                Verification::Unavailable
            } else {
                match UserConsentVerifier::RequestVerificationAsync(&reason).and_then(|operation| operation.join()) {
                    Ok(UserConsentVerificationResult::Verified) => Verification::Verified,
                    Ok(UserConsentVerificationResult::DeviceNotPresent | UserConsentVerificationResult::NotConfiguredForUser) => {
                        Verification::Unavailable
                    }
                    _ => Verification::Cancelled,
                }
            };
            let _ = sender.send(result);
        });
    }
}
