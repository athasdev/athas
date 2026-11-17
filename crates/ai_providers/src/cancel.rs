//! Stopping a turn from anywhere: the token is cheap to clone and its future resolves once.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use futures::{
    FutureExt as _,
    channel::oneshot,
    future::{BoxFuture, Shared},
};

#[derive(Clone)]
pub struct CancelToken {
    flag: Arc<AtomicBool>,
    sender: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    signal: Shared<BoxFuture<'static, ()>>,
}

impl Default for CancelToken {
    fn default() -> Self {
        let (sender, receiver) = oneshot::channel::<()>();
        let signal = async move {
            let _ = receiver.await;
        }
        .boxed()
        .shared();
        Self { flag: Arc::default(), sender: Arc::new(Mutex::new(Some(sender))), signal }
    }
}

impl CancelToken {
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        if let Some(sender) = self.sender.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
            let _ = sender.send(());
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    /// Resolves when the token is cancelled.
    pub fn cancelled(&self) -> Shared<BoxFuture<'static, ()>> {
        self.signal.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelling_wakes_every_waiter() {
        let token = CancelToken::default();
        let waiter = token.cancelled();
        assert!(!token.is_cancelled());
        token.clone().cancel();
        futures::executor::block_on(waiter);
        futures::executor::block_on(token.cancelled());
        assert!(token.is_cancelled());
    }
}
