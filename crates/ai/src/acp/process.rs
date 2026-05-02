use std::time::Duration;
use tokio::{process::Child, time::timeout};

const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

#[cfg(unix)]
fn signal_process_group(process_group_id: Option<u32>, signal: libc::c_int) {
   let Some(process_group_id) = process_group_id else {
      return;
   };

   if process_group_id == 0 || process_group_id > libc::pid_t::MAX as u32 {
      return;
   }

   unsafe {
      let _ = libc::kill(-(process_group_id as libc::pid_t), signal);
   }
}

pub(super) fn terminate_process_group(process_group_id: Option<u32>) {
   #[cfg(unix)]
   signal_process_group(process_group_id, libc::SIGTERM);

   #[cfg(not(unix))]
   {
      let _ = process_group_id;
   }
}

pub(super) fn force_kill_process_group(process_group_id: Option<u32>) {
   #[cfg(unix)]
   signal_process_group(process_group_id, libc::SIGKILL);

   #[cfg(not(unix))]
   {
      let _ = process_group_id;
   }
}

pub(super) async fn stop_child_tree(process: Child, process_group_id: Option<u32>) {
   let mut process = process;
   terminate_process_group(process_group_id);

   if timeout(GRACEFUL_SHUTDOWN_TIMEOUT, process.wait())
      .await
      .is_ok()
   {
      return;
   }

   force_kill_process_group(process_group_id);
   let _ = process.kill().await;
}

pub(super) async fn stop_child_tree_mut(process: &mut Child, process_group_id: Option<u32>) {
   terminate_process_group(process_group_id);

   if timeout(GRACEFUL_SHUTDOWN_TIMEOUT, process.wait())
      .await
      .is_ok()
   {
      return;
   }

   force_kill_process_group(process_group_id);
   let _ = process.kill().await;
}
