//! The browser's `localStorage` and `fetch`, which the original used for generated extensions,
//! extension storage and HTTP. Off the browser there is no `localStorage`.

#[cfg(target_family = "wasm")]
fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

pub fn has_local_storage() -> bool {
    #[cfg(target_family = "wasm")]
    return storage().is_some();
    #[cfg(not(target_family = "wasm"))]
    return false;
}

pub fn local_get(key: &str) -> Option<String> {
    #[cfg(target_family = "wasm")]
    return storage()?.get_item(key).ok().flatten();
    #[cfg(not(target_family = "wasm"))]
    {
        let _ = key;
        None
    }
}

pub fn local_set(key: &str, value: &str) -> Result<(), String> {
    #[cfg(target_family = "wasm")]
    return storage().ok_or("Storage is not available")?.set_item(key, value).map_err(|error| format!("{error:?}"));
    #[cfg(not(target_family = "wasm"))]
    {
        let _ = (key, value);
        Err("Storage is not available".into())
    }
}

pub fn local_remove(key: &str) {
    #[cfg(target_family = "wasm")]
    if let Some(storage) = storage() {
        storage.remove_item(key).ok();
    }
    #[cfg(not(target_family = "wasm"))]
    let _ = key;
}

/// An extension's HTTP request through the browser's `fetch`: no redirects followed, the body
/// capped at 5 MB.
#[cfg(target_family = "wasm")]
pub async fn fetch(request: crate::services::HttpRequest) -> Result<crate::services::HttpResponse, String> {
    use wasm_bindgen::JsCast as _;
    use wasm_bindgen_futures::JsFuture;

    use crate::services::{HttpResponse, MAX_RESPONSE_BYTES};

    let js_error = |error: wasm_bindgen::JsValue| error.as_string().unwrap_or_else(|| format!("{error:?}"));
    let method = request.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    if !["GET", "POST", "PUT", "PATCH", "DELETE"].contains(&method.as_str()) {
        return Err(format!("Unsupported integration HTTP method: {method}"));
    }
    let init = web_sys::RequestInit::new();
    init.set_method(&method);
    init.set_redirect(web_sys::RequestRedirect::Manual);
    let headers = web_sys::Headers::new().map_err(js_error)?;
    for (name, value) in &request.headers {
        headers.set(name, value).map_err(js_error)?;
    }
    init.set_headers(&headers);
    if let Some(body) = &request.body {
        init.set_body(&wasm_bindgen::JsValue::from_str(body));
    }
    let http_request = web_sys::Request::new_with_str_and_init(&request.url, &init).map_err(js_error)?;
    let window = web_sys::window().ok_or("Network requests are not available here")?;
    let response: web_sys::Response = JsFuture::from(window.fetch_with_request(&http_request)).await.map_err(js_error)?.dyn_into().map_err(js_error)?;
    let declared: usize = response.headers().get("content-length").ok().flatten().and_then(|value| value.parse().ok()).unwrap_or(0);
    if declared > MAX_RESPONSE_BYTES {
        return Err("Integration response exceeded the 5 MB limit".into());
    }
    let mut response_headers = std::collections::HashMap::new();
    if let Ok(Some(entries)) = js_sys::try_iter(&response.headers()) {
        for entry in entries.flatten() {
            let pair = js_sys::Array::from(&entry);
            if let (Some(name), Some(value)) = (pair.get(0).as_string(), pair.get(1).as_string()) {
                response_headers.insert(name, value);
            }
        }
    }
    let body = JsFuture::from(response.text().map_err(js_error)?).await.map_err(js_error)?.as_string().unwrap_or_default();
    if body.len() > MAX_RESPONSE_BYTES {
        return Err("Integration response exceeded the 5 MB limit".into());
    }
    Ok(HttpResponse { status: response.status(), headers: response_headers, body })
}
