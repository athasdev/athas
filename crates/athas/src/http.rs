//! The HTTP client GPUI loads remote images with (commit authors' pictures, extension icons):
//! GET requests on a thread of their own, through the rustls `ureq` build the app already uses.

use std::sync::Arc;

use futures::{FutureExt as _, channel::oneshot, future::BoxFuture};
use http_client::{AsyncBody, HttpClient, Method, Request, Response, Url, http::HeaderValue};

pub struct ImageHttpClient {
    user_agent: HeaderValue,
}

impl ImageHttpClient {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { user_agent: HeaderValue::from_static(concat!("Athas/", env!("CARGO_PKG_VERSION"))) })
    }
}

fn get(uri: &str, user_agent: &str) -> anyhow::Result<Response<AsyncBody>> {
    let mut response = ureq::get(uri).header("User-Agent", user_agent).call()?;
    let status = response.status().as_u16();
    let bytes = response.body_mut().read_to_vec()?;
    Ok(Response::builder().status(status).body(AsyncBody::from(bytes))?)
}

impl HttpClient for ImageHttpClient {
    fn user_agent(&self) -> Option<&HeaderValue> {
        Some(&self.user_agent)
    }

    fn proxy(&self) -> Option<&Url> {
        None
    }

    fn send(&self, request: Request<AsyncBody>) -> BoxFuture<'static, anyhow::Result<Response<AsyncBody>>> {
        if request.method() != Method::GET {
            return async { Err(anyhow::anyhow!("only GET requests are supported")) }.boxed();
        }
        let uri = request.uri().to_string();
        let user_agent = self.user_agent.to_str().unwrap_or("Athas").to_string();
        let (sender, receiver) = oneshot::channel();
        std::thread::spawn(move || {
            let _ = sender.send(get(&uri, &user_agent));
        });
        async move { receiver.await.map_err(|_| anyhow::anyhow!("request cancelled"))? }.boxed()
    }
}
