//! The bridge between GPUI's executor and the installers, whose futures need a tokio reactor
//! (reqwest, child processes). One small runtime runs on its own threads.

use std::{future::Future, sync::OnceLock};

fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("athas-tooling")
            .enable_all()
            .build()
            .expect("the tooling runtime starts")
    })
}

/// Runs `future` on the tooling runtime; the result can be awaited from any executor.
pub fn spawn<T: Send + 'static>(
    future: impl Future<Output = Result<T, String>> + Send + 'static,
) -> impl Future<Output = Result<T, String>> + Send + 'static {
    let handle = runtime().spawn(future);
    async move { handle.await.unwrap_or_else(|error| Err(format!("Tool install failed: {error}"))) }
}

#[cfg(test)]
mod tests {
    #[test]
    fn bridges_results_back() {
        let executor = tokio::runtime::Builder::new_current_thread().build().unwrap();
        assert_eq!(executor.block_on(super::spawn(async { Ok::<_, String>(21 * 2) })), Ok(42));
    }
}
