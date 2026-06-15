use crate::schema::CancelNotification;

impl_jsonrpc_notification!(CancelNotification, "session/cancel");
