//! How far a download has got, for the install that started it.

use std::{future::Future, sync::Arc};

pub type ProgressSink = Arc<dyn Fn(f32) + Send + Sync>;

tokio::task_local! {
    static SINK: ProgressSink;
}

/// Runs `future`, sending the fraction of each download it makes (0 to 1) to `sink`.
pub async fn with_progress<T>(sink: impl Fn(f32) + Send + Sync + 'static, future: impl Future<Output = T>) -> T {
    SINK.scope(Arc::new(sink), future).await
}

pub(crate) fn report(fraction: f32) {
    let _ = SINK.try_with(|sink| sink(fraction.clamp(0., 1.)));
}
