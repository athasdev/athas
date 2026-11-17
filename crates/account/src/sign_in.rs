//! Waiting for the browser to finish a desktop sign-in (`waitForDesktopAuthToken`): poll the
//! session, backing off from 1.5 to 5 seconds, for at most five minutes.

use std::{future::Future, time::Duration};

use crate::api::{ApiError, DesktopAuthCode, PollStatus};

pub const POLL_INTERVAL: Duration = Duration::from_millis(1500);
pub const MAX_POLL_INTERVAL: Duration = Duration::from_secs(5);
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// The wait after `interval`: half as long again, at most five seconds.
pub fn next_interval(interval: Duration) -> Duration {
    interval.mul_f64(1.5).min(MAX_POLL_INTERVAL)
}

/// Polls until the browser hands over a token, the session ends, or `timeout` of waiting passes.
/// `poll` asks once; `sleep` waits (a GPUI timer in the app, nothing in tests).
pub async fn wait_for_token<P, PF, S, SF>(timeout: Duration, mut poll: P, mut sleep: S) -> Result<String, ApiError>
where
    P: FnMut() -> PF,
    PF: Future<Output = Result<PollStatus, ApiError>>,
    S: FnMut(Duration) -> SF,
    SF: Future<Output = ()>,
{
    let mut waited = Duration::ZERO;
    let mut interval = POLL_INTERVAL;
    while waited < timeout {
        match poll().await? {
            PollStatus::Ready(token) => return Ok(token),
            PollStatus::Expired => {
                return Err(ApiError::DesktopAuth { code: DesktopAuthCode::Expired, message: "Desktop sign-in session is no longer valid.".into() });
            }
            PollStatus::Missing => {
                return Err(ApiError::DesktopAuth {
                    code: DesktopAuthCode::Failed,
                    message: "Desktop sign-in session credentials are invalid or the session has expired.".into(),
                });
            }
            PollStatus::Pending => {}
        }
        let step = interval.min(timeout - waited);
        sleep(step).await;
        waited += step;
        interval = next_interval(interval);
    }
    Err(ApiError::DesktopAuth { code: DesktopAuthCode::Timeout, message: "Desktop sign-in timed out. Please try again.".into() })
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, future::ready};

    use super::*;

    fn run(responses: Vec<PollStatus>, timeout: Duration) -> (Result<String, ApiError>, Vec<Duration>) {
        let responses = RefCell::new(responses.into_iter());
        let sleeps = RefCell::new(Vec::new());
        let result = gpui::block_on(wait_for_token(
            timeout,
            || ready(Ok(responses.borrow_mut().next().unwrap_or(PollStatus::Pending))),
            |duration| {
                sleeps.borrow_mut().push(duration);
                ready(())
            },
        ));
        (result, sleeps.into_inner())
    }

    #[test]
    fn backs_off_until_the_token_arrives() {
        let (result, sleeps) = run(vec![PollStatus::Pending, PollStatus::Pending, PollStatus::Pending, PollStatus::Ready("tok".into())], SIGN_IN_TIMEOUT);
        assert_eq!(result.unwrap(), "tok");
        assert_eq!(sleeps, vec![Duration::from_millis(1500), Duration::from_millis(2250), Duration::from_millis(3375)]);
        assert_eq!(next_interval(Duration::from_secs(4)), MAX_POLL_INTERVAL);
    }

    #[test]
    fn ends_on_expiry_missing_sessions_and_timeout() {
        let (expired, _) = run(vec![PollStatus::Expired], SIGN_IN_TIMEOUT);
        assert!(matches!(expired, Err(ApiError::DesktopAuth { code: DesktopAuthCode::Expired, .. })));
        let (missing, _) = run(vec![PollStatus::Missing], SIGN_IN_TIMEOUT);
        assert!(matches!(missing, Err(ApiError::DesktopAuth { code: DesktopAuthCode::Failed, .. })));
        let (timeout, sleeps) = run(Vec::new(), Duration::from_secs(4));
        assert!(matches!(timeout, Err(ApiError::DesktopAuth { code: DesktopAuthCode::Timeout, .. })));
        assert_eq!(sleeps.iter().sum::<Duration>(), Duration::from_secs(4));
    }

    #[test]
    fn errors_from_the_poll_stop_the_wait() {
        let result = gpui::block_on(wait_for_token(
            SIGN_IN_TIMEOUT,
            || ready(Err(ApiError::Malformed("bad".into()))),
            |_| ready(()),
        ));
        assert_eq!(result, Err(ApiError::Malformed("bad".into())));
    }
}
