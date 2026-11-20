//! Voice input for the composer: speech from the microphone, written into the message as it is
//! recognised. macOS only, through `SFSpeechRecognizer` fed by an `AVAudioEngine` tap; the system
//! asks for speech recognition and microphone access the first time.
//!
//! Ported from Athas's `hooks/use-voice-input.ts`. As there, a build without the app bundle's
//! usage descriptions (a development binary) does not touch the microphone.

use futures::channel::mpsc::UnboundedSender;

/// What the recogniser reports.
#[derive(Clone, Debug, PartialEq)]
pub enum VoiceEvent {
    /// The user answered the speech recognition prompt (or had before).
    Authorized(bool),
    /// What was heard so far, not settled yet.
    Partial(String),
    /// What was heard, settled; the listening ends.
    Final(String),
    Error(String),
}

pub const MICROPHONE_ERROR: &str = "Microphone access failed. Check System Settings -> Privacy & Security -> Microphone.";
pub const DEV_BUILD_ERROR: &str = "Voice input is disabled in macOS dev mode. Test it in a packaged app build.";
pub const UNSUPPORTED_ERROR: &str = "Voice input is not supported on this platform.";

/// A running recognition; [`Listening::stop`] ends it and the last words arrive as
/// [`VoiceEvent::Final`].
pub struct Listening {
    #[cfg(target_os = "macos")]
    _inner: macos::Session,
}

impl Listening {
    pub fn stop(self) {
        drop(self);
    }
}

/// Whether this build may ask for the microphone: on macOS, an app bundle that says why.
pub fn supported() -> bool {
    #[cfg(target_os = "macos")]
    return macos::bundle_allows();
    #[cfg(not(target_os = "macos"))]
    false
}

/// Asks for speech recognition access; the answer comes as [`VoiceEvent::Authorized`].
pub fn request_authorization(events: UnboundedSender<VoiceEvent>) -> Result<(), &'static str> {
    #[cfg(target_os = "macos")]
    {
        if !macos::bundle_allows() {
            return Err(DEV_BUILD_ERROR);
        }
        macos::request_authorization(events);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        drop(events);
        Err(UNSUPPORTED_ERROR)
    }
}

/// Starts listening, once access is granted.
pub fn start(events: UnboundedSender<VoiceEvent>) -> Result<Listening, String> {
    #[cfg(target_os = "macos")]
    {
        if !macos::bundle_allows() {
            return Err(DEV_BUILD_ERROR.into());
        }
        macos::Session::start(events).map(|inner| Listening { _inner: inner })
    }
    #[cfg(not(target_os = "macos"))]
    {
        drop(events);
        Err(UNSUPPORTED_ERROR.into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::{
        ffi::{CStr, c_char},
        ptr,
    };

    use block2::RcBlock;
    use futures::channel::mpsc::UnboundedSender;
    use objc2::{
        msg_send,
        rc::Retained,
        runtime::{AnyClass, AnyObject},
    };

    use super::{MICROPHONE_ERROR, VoiceEvent};

    #[link(name = "Speech", kind = "framework")]
    unsafe extern "C" {}

    #[link(name = "AVFoundation", kind = "framework")]
    unsafe extern "C" {}

    /// `SFSpeechRecognizerAuthorizationStatusAuthorized`.
    const AUTHORIZED: isize = 3;

    fn class(name: &CStr) -> Option<&'static AnyClass> {
        AnyClass::get(name)
    }

    unsafe fn ns_string(value: &CStr) -> *mut AnyObject {
        let Some(class) = class(c"NSString") else { return ptr::null_mut() };
        unsafe { msg_send![class, stringWithUTF8String: value.as_ptr()] }
    }

    unsafe fn rust_string(value: *mut AnyObject) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let bytes: *const c_char = unsafe { msg_send![value, UTF8String] };
        (!bytes.is_null()).then(|| unsafe { CStr::from_ptr(bytes) }.to_string_lossy().into_owned())
    }

    /// The main bundle has both usage descriptions; without them macOS ends the app when the
    /// microphone or recogniser is touched.
    pub fn bundle_allows() -> bool {
        let Some(bundle_class) = class(c"NSBundle") else { return false };
        unsafe {
            let bundle: *mut AnyObject = msg_send![bundle_class, mainBundle];
            if bundle.is_null() {
                return false;
            }
            [c"NSMicrophoneUsageDescription", c"NSSpeechRecognitionUsageDescription"].iter().all(|key| {
                let value: *mut AnyObject = msg_send![bundle, objectForInfoDictionaryKey: ns_string(key)];
                !value.is_null()
            })
        }
    }

    pub fn request_authorization(events: UnboundedSender<VoiceEvent>) {
        let Some(recognizer) = class(c"SFSpeechRecognizer") else {
            events.unbounded_send(VoiceEvent::Authorized(false)).ok();
            return;
        };
        let handler = RcBlock::new(move |status: isize| {
            events.unbounded_send(VoiceEvent::Authorized(status == AUTHORIZED)).ok();
        });
        unsafe {
            let _: () = msg_send![recognizer, requestAuthorization: &*handler];
        }
    }

    pub struct Session {
        stopped: bool,
        engine: Retained<AnyObject>,
        input: *mut AnyObject,
        request: Retained<AnyObject>,
        task: Option<Retained<AnyObject>>,
        _recognizer: Retained<AnyObject>,
    }

    impl Session {
        pub fn start(events: UnboundedSender<VoiceEvent>) -> Result<Self, String> {
            let (Some(recognizer_class), Some(request_class), Some(engine_class)) =
                (class(c"SFSpeechRecognizer"), class(c"SFSpeechAudioBufferRecognitionRequest"), class(c"AVAudioEngine"))
            else {
                return Err("Speech recognition is not available on this Mac.".into());
            };
            unsafe {
                let recognizer: Option<Retained<AnyObject>> = msg_send![recognizer_class, new];
                let recognizer = recognizer.ok_or("Speech recognition is not available for this language.")?;
                let available: bool = msg_send![&*recognizer, isAvailable];
                if !available {
                    return Err("Speech recognition is not available right now.".into());
                }
                let request: Option<Retained<AnyObject>> = msg_send![request_class, new];
                let request = request.ok_or("Voice input could not be started.")?;
                let _: () = msg_send![&*request, setShouldReportPartialResults: true];
                let engine: Option<Retained<AnyObject>> = msg_send![engine_class, new];
                let engine = engine.ok_or(MICROPHONE_ERROR)?;
                let input: *mut AnyObject = msg_send![&*engine, inputNode];
                if input.is_null() {
                    return Err(MICROPHONE_ERROR.into());
                }
                let format: *mut AnyObject = msg_send![input, outputFormatForBus: 0usize];
                let target: *mut AnyObject = Retained::as_ptr(&request) as *mut AnyObject;
                let tap = RcBlock::new(move |buffer: *mut AnyObject, _when: *mut AnyObject| {
                    if !buffer.is_null() {
                        let _: () = msg_send![target, appendAudioPCMBuffer: buffer];
                    }
                });
                let _: () = msg_send![input, installTapOnBus: 0usize, bufferSize: 1024u32, format: format, block: &*tap];
                let _: () = msg_send![&*engine, prepare];
                let mut error: *mut AnyObject = ptr::null_mut();
                let started: bool = msg_send![&*engine, startAndReturnError: &mut error];
                if !started {
                    let _: () = msg_send![input, removeTapOnBus: 0usize];
                    return Err(MICROPHONE_ERROR.into());
                }
                let results = events.clone();
                let handler = RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
                    if !result.is_null() {
                        let transcription: *mut AnyObject = msg_send![result, bestTranscription];
                        let text = if transcription.is_null() { None } else { rust_string(msg_send![transcription, formattedString]) };
                        let is_final: bool = msg_send![result, isFinal];
                        let text = text.unwrap_or_default();
                        let event = if is_final { VoiceEvent::Final(text) } else { VoiceEvent::Partial(text) };
                        results.unbounded_send(event).ok();
                    } else if !error.is_null() {
                        let message = rust_string(msg_send![error, localizedDescription]).unwrap_or_else(|| "Voice input stopped unexpectedly.".into());
                        results.unbounded_send(VoiceEvent::Error(message)).ok();
                    }
                });
                let task: Option<Retained<AnyObject>> = msg_send![&*recognizer, recognitionTaskWithRequest: &*request, resultHandler: &*handler];
                Ok(Self { stopped: false, engine, input, request, task, _recognizer: recognizer })
            }
        }

        fn stop(&mut self) {
            if std::mem::replace(&mut self.stopped, true) {
                return;
            }
            unsafe {
                let _: () = msg_send![&*self.engine, stop];
                let _: () = msg_send![self.input, removeTapOnBus: 0usize];
                let _: () = msg_send![&*self.request, endAudio];
                if let Some(task) = &self.task {
                    let _: () = msg_send![&**task, finish];
                }
            }
        }
    }

    impl Drop for Session {
        fn drop(&mut self) {
            self.stop();
        }
    }
}

/// The composer's voice input while it runs.
pub(crate) struct VoiceInput {
    listening: Option<Listening>,
    pub interim: String,
    _events: gpui::Task<()>,
}

impl VoiceInput {
    pub fn is_listening(&self) -> bool {
        self.listening.is_some()
    }
}

impl crate::session_view::SessionView {
    /// Starts or stops voice input (`useVoiceInput`'s toggle): asks for access first, then
    /// writes what is heard into the message.
    pub(crate) fn toggle_voice(&mut self, window: &mut gpui::Window, cx: &mut gpui::Context<Self>) {
        if let Some(voice) = &mut self.voice
            && let Some(listening) = voice.listening.take()
        {
            listening.stop();
            voice.interim.clear();
            cx.notify();
            return;
        }
        let (sender, mut events) = futures::channel::mpsc::unbounded::<VoiceEvent>();
        if let Err(error) = request_authorization(sender.clone()) {
            notifications::notify(cx, notifications::NotificationKind::Warning, notifications::NotificationCategory::Agent, error, None, None);
            return;
        }
        let task = cx.spawn_in(window, async move |this, cx| {
            use futures::StreamExt as _;
            while let Some(event) = events.next().await {
                let keep_going = this
                    .update_in(cx, |this, window, cx| {
                        let Some(voice) = this.voice.as_mut() else { return false };
                        match event {
                            VoiceEvent::Authorized(true) => match start(sender.clone()) {
                                Ok(listening) => {
                                    voice.listening = Some(listening);
                                    let focus = gpui::Focusable::focus_handle(this.composer.read(cx), cx);
                                    window.focus(&focus, cx);
                                }
                                Err(error) => {
                                    notifications::error(cx, error, None);
                                    this.voice = None;
                                }
                            },
                            VoiceEvent::Authorized(false) => {
                                notifications::error(cx, MICROPHONE_ERROR, None);
                                this.voice = None;
                            }
                            VoiceEvent::Partial(text) => voice.interim = text,
                            VoiceEvent::Final(text) => {
                                this.voice = None;
                                // `insertTextAtCursor`: runs of whitespace become one space, and a
                                // space parts the words from text typed before them.
                                let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
                                if !text.is_empty() {
                                    this.composer.update(cx, |composer, cx| {
                                        let cursor = composer.cursor();
                                        let current = composer.text();
                                        let prefix = if !current.trim().is_empty() && !current[..cursor].ends_with(char::is_whitespace) && cursor > 0 { " " } else { "" };
                                        composer.replace_range(cursor..cursor, &format!("{prefix}{text} "), cx);
                                    });
                                }
                            }
                            VoiceEvent::Error(message) => {
                                if voice.listening.is_some() {
                                    notifications::error(cx, "Voice input stopped unexpectedly.", Some(message.into()));
                                }
                                this.voice = None;
                            }
                        }
                        cx.notify();
                        this.voice.is_some()
                    })
                    .unwrap_or(false);
                if !keep_going {
                    return;
                }
            }
        });
        self.voice = Some(VoiceInput { listening: None, interim: String::new(), _events: task });
        cx.notify();
    }
}
