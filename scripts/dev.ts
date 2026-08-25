#!/usr/bin/env bun

const children = new Set<ReturnType<typeof Bun.spawn>>();

let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

let exitCode = 1;

try {
  children.add(
    Bun.spawn(["bun", "run", "extensions:serve"], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  children.add(
    Bun.spawn(["tauri", "dev", "--config", "src-tauri/tauri.preview.conf.json"], {
      env: {
        ...process.env,
        VITE_EXTENSION_MARKETPLACE_LOCAL: "true",
        WEBKIT_DISABLE_DMABUF_RENDERER: "1",
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  exitCode = await Promise.race([...children].map((child) => child.exited));
} finally {
  stop();
  await Promise.allSettled([...children].map((child) => child.exited));
}

process.exit(exitCode);
