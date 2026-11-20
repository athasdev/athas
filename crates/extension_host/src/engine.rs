//! The desktop worker: each UI extension gets its own QuickJS runtime on its own thread, with a
//! memory cap, a stack cap and a time budget for each turn of JavaScript. It stands in for the
//! original's dedicated Web Worker; `runtime.js` is the same in both.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::time::{Duration, Instant};

use rquickjs::{Array, CatchResultExt, CaughtError, Context, Ctx, Function, Module, Object, Persistent, Promise, Runtime};

use crate::{Limits, RUNTIME_JS, WorkerSink, WorkerTransport};

const NO_DEADLINE: u64 = u64::MAX;

enum Inbound {
    Message(String),
    Terminate,
}

/// A running extension worker. Dropping it stops the thread.
pub struct QuickJsWorker {
    sender: Sender<Inbound>,
    terminated: Arc<AtomicBool>,
}

impl WorkerTransport for QuickJsWorker {
    fn post(&self, message: String) {
        self.sender.send(Inbound::Message(message)).ok();
    }

    fn terminate(&self) {
        self.terminated.store(true, Ordering::SeqCst);
        self.sender.send(Inbound::Terminate).ok();
    }
}

impl Drop for QuickJsWorker {
    fn drop(&mut self) {
        self.terminate();
    }
}

/// Starts a worker named `name`; everything it posts goes to `sink`, on the worker's thread.
pub fn spawn(name: &str, limits: Limits, sink: WorkerSink) -> anyhow::Result<QuickJsWorker> {
    let (sender, receiver) = channel();
    let terminated = Arc::new(AtomicBool::new(false));
    let flag = terminated.clone();
    std::thread::Builder::new()
        .name(format!("ui-extension:{name}"))
        .stack_size(limits.stack_bytes * 4 + 2 * 1024 * 1024)
        .spawn(move || {
            if let Err(error) = run(receiver, flag, limits, sink.clone()) {
                sink(worker_error(&error.to_string()));
            }
        })?;
    Ok(QuickJsWorker { sender, terminated })
}

fn worker_error(message: &str) -> String {
    serde_json::json!({ "type": "event", "event": "worker.error", "payload": { "message": message } }).to_string()
}

#[derive(Default)]
struct Timers {
    due: BTreeMap<(Instant, u64), ()>,
    by_id: BTreeMap<u64, Instant>,
}

impl Timers {
    fn set(&mut self, id: u64, delay: Duration) {
        self.clear(id);
        let at = Instant::now() + delay;
        self.due.insert((at, id), ());
        self.by_id.insert(id, at);
    }

    fn clear(&mut self, id: u64) {
        if let Some(at) = self.by_id.remove(&id) {
            self.due.remove(&(at, id));
        }
    }

    fn next(&self) -> Option<Instant> {
        self.due.keys().next().map(|(at, _)| *at)
    }

    fn pop_due(&mut self, now: Instant) -> Option<u64> {
        let (at, id) = *self.due.keys().next()?;
        if at > now {
            return None;
        }
        self.due.remove(&(at, id));
        self.by_id.remove(&id);
        Some(id)
    }
}

fn describe(error: CaughtError<'_>) -> String {
    match error {
        CaughtError::Exception(exception) => {
            let message = exception.message().unwrap_or_default();
            if message.is_empty() { "Uncaught exception".into() } else { message }
        }
        CaughtError::Value(value) => value.as_string().and_then(|text| text.to_string().ok()).unwrap_or_else(|| format!("{value:?}")),
        CaughtError::Error(error) => error.to_string(),
    }
}

fn run(receiver: Receiver<Inbound>, terminated: Arc<AtomicBool>, limits: Limits, sink: WorkerSink) -> anyhow::Result<()> {
    let runtime = Runtime::new()?;
    runtime.set_memory_limit(limits.memory_bytes);
    runtime.set_max_stack_size(limits.stack_bytes);
    let start = Instant::now();
    let deadline = Arc::new(AtomicU64::new(NO_DEADLINE));
    let interrupted = Arc::new(AtomicBool::new(false));
    {
        let deadline = deadline.clone();
        let interrupted = interrupted.clone();
        let terminated = terminated.clone();
        runtime.set_interrupt_handler(Some(Box::new(move || {
            let over = start.elapsed().as_millis() as u64 > deadline.load(Ordering::Relaxed);
            if over || terminated.load(Ordering::Relaxed) {
                interrupted.store(true, Ordering::Relaxed);
                return true;
            }
            false
        })));
    }
    let context = Context::full(&runtime)?;
    let timers = Rc::new(RefCell::new(Timers::default()));

    let (receive, fire_timer) = context.with(|ctx| -> anyhow::Result<_> {
        let host = Object::new(ctx.clone())?;
        let post_sink = sink.clone();
        host.set("post", Function::new(ctx.clone(), move |message: String| post_sink(message))?)?;
        host.set("timers", true)?;
        let set_timers = timers.clone();
        host.set(
            "setTimer",
            Function::new(ctx.clone(), move |id: f64, delay: f64| {
                set_timers.borrow_mut().set(id as u64, Duration::from_millis(delay.max(0.0) as u64));
            })?,
        )?;
        let clear_timers = timers.clone();
        host.set("clearTimer", Function::new(ctx.clone(), move |id: f64| clear_timers.borrow_mut().clear(id as u64))?)?;
        let log_sink = sink.clone();
        host.set(
            "log",
            Function::new(ctx.clone(), move |level: String, text: String| {
                log_sink(serde_json::json!({ "type": "log", "level": level, "message": text }).to_string());
            })?,
        )?;
        host.set("rawImport", Function::new(ctx.clone(), import_module)?)?;
        let import: Function = ctx
            .eval("(host) => (source, name) => { const [namespace, ready] = host.rawImport(source, name); return ready.then(() => namespace); }")
            .catch(&ctx)
            .map_err(|error| anyhow::anyhow!(describe(error)))?;
        host.set("importModule", import.call::<_, Function>((host.clone(),)).catch(&ctx).map_err(|error| anyhow::anyhow!(describe(error)))?)?;

        let factory: Function = ctx.eval(RUNTIME_JS).catch(&ctx).map_err(|error| anyhow::anyhow!(describe(error)))?;
        let worker: Object = factory.call((host,)).catch(&ctx).map_err(|error| anyhow::anyhow!(describe(error)))?;
        let receive: Function = worker.get("receive")?;
        let fire_timer: Function = worker.get("fireTimer")?;
        Ok((Persistent::save(&ctx, receive), Persistent::save(&ctx, fire_timer)))
    })?;

    let budget = limits.turn_budget.as_millis() as u64;
    let turn = |call: &dyn Fn(&Ctx<'_>) -> rquickjs::Result<()>| -> Option<String> {
        deadline.store(start.elapsed().as_millis() as u64 + budget, Ordering::Relaxed);
        let mut failure = None;
        context.with(|ctx| {
            if let Err(error) = call(&ctx).catch(&ctx) {
                failure = Some(describe(error));
            }
        });
        loop {
            match runtime.execute_pending_job() {
                Ok(true) => continue,
                Ok(false) => break,
                Err(exception) => {
                    exception.0.with(|ctx| {
                        let value = ctx.catch();
                        if failure.is_none() {
                            failure = Some(
                                value
                                    .as_exception()
                                    .and_then(|exception| exception.message())
                                    .unwrap_or_else(|| "Uncaught exception in a promise job".into()),
                            );
                        }
                    });
                    if interrupted.load(Ordering::Relaxed) {
                        break;
                    }
                }
            }
        }
        deadline.store(NO_DEADLINE, Ordering::Relaxed);
        failure
    };

    loop {
        if terminated.load(Ordering::SeqCst) {
            return Ok(());
        }
        let now = Instant::now();
        let due = timers.borrow_mut().pop_due(now);
        if let Some(id) = due {
            let fire = fire_timer.clone();
            let failure = turn(&|ctx| fire.clone().restore(ctx)?.call::<_, ()>((id as f64,)));
            if let Some(stop) = check(&interrupted, &terminated, &limits, failure, &sink) {
                return stop;
            }
            continue;
        }
        let next = timers.borrow().next();
        let message = match next {
            Some(at) => match receiver.recv_timeout(at.saturating_duration_since(now)) {
                Ok(message) => message,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => return Ok(()),
            },
            None => match receiver.recv() {
                Ok(message) => message,
                Err(_) => return Ok(()),
            },
        };
        match message {
            Inbound::Terminate => return Ok(()),
            Inbound::Message(json) => {
                let receive = receive.clone();
                let failure = turn(&|ctx| receive.clone().restore(ctx)?.call::<_, ()>((json.clone(),)));
                if let Some(stop) = check(&interrupted, &terminated, &limits, failure, &sink) {
                    return stop;
                }
            }
        }
    }
}

/// After a turn: a worker that ran past its budget is stopped (like a hung Web Worker the host
/// terminates); other uncaught errors are logged and the worker keeps going.
fn check(interrupted: &AtomicBool, terminated: &AtomicBool, limits: &Limits, failure: Option<String>, sink: &WorkerSink) -> Option<anyhow::Result<()>> {
    if terminated.load(Ordering::SeqCst) {
        return Some(Ok(()));
    }
    if interrupted.load(Ordering::Relaxed) {
        sink(worker_error(&format!("Integration exceeded its {} ms time budget and was stopped", limits.turn_budget.as_millis())));
        return Some(Ok(()));
    }
    if let Some(message) = failure {
        sink(serde_json::json!({ "type": "log", "level": "error", "message": message }).to_string());
    }
    None
}

/// Declares and evaluates `source` as an ES module. No module loader is installed, so any
/// `import` inside it fails.
fn import_module<'js>(ctx: Ctx<'js>, source: String, name: String) -> rquickjs::Result<Array<'js>> {
    let module = Module::declare(ctx.clone(), format!("{name}.js"), source)?;
    let (module, ready): (_, Promise<'js>) = module.eval()?;
    let result = Array::new(ctx)?;
    result.set(0, module.namespace()?)?;
    result.set(1, ready)?;
    Ok(result)
}
