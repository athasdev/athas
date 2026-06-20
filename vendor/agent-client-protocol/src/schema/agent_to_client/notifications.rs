#[cfg(feature = "unstable_elicitation")]
use crate::schema::CompleteElicitationNotification;
use crate::schema::SessionNotification;

impl_jsonrpc_notification!(SessionNotification, "session/update");
#[cfg(feature = "unstable_elicitation")]
impl_jsonrpc_notification!(CompleteElicitationNotification, "elicitation/complete");
