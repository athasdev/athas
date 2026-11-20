//! The browser worker: each UI extension runs `runtime.js` in its own module Web Worker, with
//! the browser's own timers and console, and loads its entry module from a blob URL, as the
//! original did. Browsers give no memory cap; a hung worker is stopped by the host's timeouts.

use wasm_bindgen::JsCast as _;
use wasm_bindgen::prelude::*;
use web_sys::{Blob, BlobPropertyBag, MessageEvent, Url, Worker, WorkerOptions, WorkerType};

use crate::{Limits, RUNTIME_JS, WorkerSink, WorkerTransport};

pub struct WebWorker {
    worker: Worker,
    url: String,
    _on_message: Closure<dyn FnMut(MessageEvent)>,
    _on_error: Closure<dyn FnMut(JsValue)>,
}

// wasm32 runs the app on one thread; the host only needs `Send` for its desktop threads.
unsafe impl Send for WebWorker {}

impl WorkerTransport for WebWorker {
    fn post(&self, message: String) {
        self.worker.post_message(&JsValue::from_str(&message)).ok();
    }

    fn terminate(&self) {
        self.worker.terminate();
        Url::revoke_object_url(&self.url).ok();
    }
}

fn js_error(error: JsValue) -> anyhow::Error {
    anyhow::anyhow!("{error:?}")
}

pub fn spawn(name: &str, _limits: Limits, sink: WorkerSink) -> anyhow::Result<WebWorker> {
    let script = format!(
        "const post = self.postMessage.bind(self);\n\
         const listen = self.addEventListener.bind(self);\n\
         const BlobType = Blob;\n\
         const UrlType = URL;\n\
         const factory = {RUNTIME_JS}\n\
         const worker = factory({{\n\
           post,\n\
           timers: false,\n\
           importModule: (source) => import(UrlType.createObjectURL(new BlobType([source], {{ type: \"text/javascript\" }}))),\n\
         }});\n\
         listen(\"message\", (event) => worker.receive(event.data));\n"
    );
    let parts = js_sys::Array::of1(&JsValue::from_str(&script));
    let options = BlobPropertyBag::new();
    options.set_type("text/javascript");
    let blob = Blob::new_with_str_sequence_and_options(&parts, &options).map_err(js_error)?;
    let url = Url::create_object_url_with_blob(&blob).map_err(js_error)?;
    let worker_options = WorkerOptions::new();
    worker_options.set_name(name);
    worker_options.set_type(WorkerType::Module);
    let worker = Worker::new_with_options(&url, &worker_options).map_err(js_error)?;

    let message_sink = sink.clone();
    let on_message = Closure::<dyn FnMut(MessageEvent)>::new(move |event: MessageEvent| {
        if let Some(text) = event.data().as_string() {
            message_sink(text);
        }
    });
    worker.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
    let on_error = Closure::<dyn FnMut(JsValue)>::new(move |event: JsValue| {
        let message = js_sys::Reflect::get(&event, &JsValue::from_str("message")).ok().and_then(|value| value.as_string()).unwrap_or_else(|| "Integration worker failed".into());
        sink(serde_json::json!({ "type": "event", "event": "worker.error", "payload": { "message": message } }).to_string());
    });
    worker.set_onerror(Some(on_error.as_ref().unchecked_ref()));
    Ok(WebWorker { worker, url, _on_message: on_message, _on_error: on_error })
}
