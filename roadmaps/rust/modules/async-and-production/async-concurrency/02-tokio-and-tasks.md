---
title: "Tokio And Tasks"
description: "Use Tokio tasks, spawn, join handles, timeouts, and async ownership rules to run concurrent work clearly."
overview: "Async Rust becomes practical when a runtime schedules many pieces of work. Tokio tasks are the unit of async execution most Rust service code uses."
tags: ["tokio", "tasks", "spawn", "runtime"]
order: 2
id: article-rust-async-and-production-tokio-and-tasks
---

## Table of Contents

1. [The Problem](#the-problem)
2. [The Runtime](#the-runtime)
3. [Tasks, Threads, And Workers](#tasks-threads-and-workers)
4. [Spawning Tasks](#spawning-tasks)
5. [Join Handles](#join-handles)
6. [Move Into Tasks](#move-into-tasks)
7. [Timeouts](#timeouts)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

The previous article loaded one note with async code. A real networked notes app needs more. It may fetch the note body, fetch metadata, refresh an index, and write a cache entry.

Those operations are related, but they should not all wait in one long line. If the metadata request is waiting on the network, the note body request can make progress. If an index refresh takes too long, the app may want to stop waiting and show a partial result.

Tokio gives async Rust a runtime and a task model. A task is async work submitted to the runtime scheduler.

## The Runtime

Tokio is an async runtime for Rust. It provides a scheduler for futures, async networking and I/O utilities, timers, channels, and task spawning.

Most small examples start with:

```rust
#[tokio::main]
async fn main() {
    println!("runtime is ready");
}
```

The attribute creates a runtime and runs the async `main` function on it.

In a larger application, you may configure the runtime directly, but early on the attribute is enough. The important idea is that async code does not run itself. Tokio drives the futures and decides which ready task gets to make progress.

## Tasks, Threads, And Workers

A Tokio task is runtime-managed future work. A worker thread is an operating system thread that the runtime uses to poll many tasks.

That distinction is easy to blur:

| Word | Plain meaning |
| --- | --- |
| Future | The async work value |
| Task | A future submitted to the runtime |
| Worker thread | An OS thread that runs ready tasks |
| Scheduler | The runtime logic that decides which task runs next |

Many tasks can share a smaller number of worker threads because tasks yield at `.await` points. A task waiting on I/O does not need to occupy a thread until the I/O is ready again.

## Spawning Tasks

`tokio::spawn` submits async work to the runtime.

```rust
async fn fetch_note(id: u64) -> String {
    format!("note-{id}")
}

#[tokio::main]
async fn main() {
    let handle = tokio::spawn(async {
        fetch_note(1).await
    });

    println!("started fetch");

    let note = handle.await.unwrap();
    println!("{note}");
}
```

The spawned task can make progress while the original task does other work. Tokio returns a `JoinHandle` so the caller can wait for the task's output later.

Tasks are much lighter than operating system threads. That makes it normal for async servers to spawn many tasks, one per connection or request. The work still needs bounds, but the unit is cheap enough to use freely.

:::expand[Concurrency is not automatically parallelism]{kind="design"}
Tokio tasks are concurrent work units. They may or may not run at the exact same time.

If two tasks take turns on one thread, they are concurrent because both are in progress. They are not parallel because only one is executing at a given instant. If they run on two runtime worker threads at the same time, they are concurrent and parallel.

This distinction helps explain async performance:

| Work type | Async task benefit |
| --- | --- |
| Waiting for network I/O | Strong, because tasks yield while waiting |
| Waiting for timers | Strong, because the runtime can wake tasks later |
| Running CPU-heavy parsing | Weak by itself, because computation does not yield |
| Compressing large data | Use threads or a CPU parallelism library |

Async code works best when tasks regularly reach `.await` points. At those points, the runtime can schedule other ready tasks. CPU-heavy loops without awaits can hog a worker thread and delay unrelated async work.
:::

## Join Handles

A `JoinHandle` is the owned handle to a spawned task.

```rust
let handle = tokio::spawn(async {
    "done"
});

let result = handle.await;
```

Awaiting the handle returns a `Result`. The `Ok` value is the task's output. The `Err` case means the task did not complete normally, for example because it panicked or was cancelled during runtime shutdown.

```rust
match handle.await {
    Ok(value) => println!("{value}"),
    Err(error) => eprintln!("task failed: {error}"),
}
```

This mirrors the error-handling habits from earlier modules. Starting a task is not the same as proving it finished. If completion matters, keep the handle and await it.

## Move Into Tasks

Spawned tasks must own the data they need, or share it safely.

This shape fails because the async block borrows `ids` from `main`:

```rust
#[tokio::main]
async fn main() {
    let ids = vec![1, 2, 3];

    tokio::spawn(async {
        println!("{ids:?}");
    });
}
```

The task may outlive the function that spawned it, so it cannot hold ordinary references to local data.

Use `async move` to move ownership into the task:

```rust
#[tokio::main]
async fn main() {
    let ids = vec![1, 2, 3];

    let handle = tokio::spawn(async move {
        println!("{ids:?}");
    });

    handle.await.unwrap();
}
```

This is the same ownership lesson again. A task needs values that remain valid for as long as the task can run. If several tasks need the same data, use shared ownership such as `Arc`, or send messages instead.

:::expand['static does not mean leaked forever]{kind="pitfall"}
Tokio spawn errors often mention `'static`, and that wording can sound alarming.

For spawned tasks, `'static` means the task must not contain references to stack data owned by the spawning function. It does not mean the task value must leak or literally live until the program exits.

This is rejected:

```rust
let path = String::from("notes/1.txt");

tokio::spawn(async {
    println!("{path}");
});
```

The async block borrows `path`. If the spawned task runs after the current function returns, the borrowed `path` would be gone.

This is accepted:

```rust
let path = String::from("notes/1.txt");

tokio::spawn(async move {
    println!("{path}");
});
```

The task owns the `String`. It can be dropped when the task finishes. No leak is required.

When you see a spawned-task lifetime error, ask: what data is the task borrowing from the outside? Then either move owned data into the task, clone an `Arc`, or restructure the work so it does not outlive the borrowed value.
:::

## Timeouts

Production async code often needs a limit on how long it will wait.

```rust
use tokio::time::{timeout, Duration};

async fn fetch_metadata(id: u64) -> String {
    format!("metadata-{id}")
}

#[tokio::main]
async fn main() {
    let result = timeout(Duration::from_secs(2), fetch_metadata(1)).await;

    match result {
        Ok(metadata) => println!("{metadata}"),
        Err(_) => eprintln!("metadata request timed out"),
    }
}
```

A timeout does not make the remote service faster. It protects the caller from waiting forever. That makes it an API design choice.

:::expand[What timeout cancellation really drops]{kind="pitfall"}
`timeout(duration, future).await` waits for a future for a limited amount of time. If the duration expires, Tokio returns an error and drops the future it was waiting on.

Dropping the future cancels that Rust async work, but outside effects may already be in motion. A request may already have reached a server. A database may already be doing work. A file write may have partially completed depending on the API.

Use timeouts as caller protection, then design the operation behind them with cancellation in mind:

| Operation | Timeout question |
| --- | --- |
| HTTP request | Is retry safe, or could it duplicate a write? |
| File write | Is the output written atomically through a temp file? |
| Database update | Is the transaction rolled back or still running server-side? |
| Background task | Who observes that the task stopped early? |

The simple rule is: a timeout stops waiting in your Rust task. Design the underlying operation separately if the business action needs rollback or cancellation.
:::

## Putting It All Together

The notes app can fetch two pieces of data concurrently:

```rust
use tokio::time::{timeout, Duration};

async fn fetch_body(id: u64) -> String {
    format!("body-{id}")
}

async fn fetch_metadata(id: u64) -> String {
    format!("metadata-{id}")
}

#[tokio::main]
async fn main() {
    let body = tokio::spawn(fetch_body(1));
    let metadata = tokio::spawn(fetch_metadata(1));

    let body = body.await.unwrap();

    match timeout(Duration::from_secs(2), metadata).await {
        Ok(join_result) => {
            let metadata = join_result.unwrap();
            println!("{body} / {metadata}");
        }
        Err(_) => eprintln!("metadata timed out"),
    }
}
```

The runtime drives both tasks. The handles make completion visible. The timeout keeps one slow dependency from controlling the whole flow.

Count back to the opener:

- Multiple I/O operations can run concurrently.
- Spawned tasks need owned or safely shared data.
- Join handles tell you whether tasks completed.
- Timeouts make waiting deliberate.

## What's Next

Spawning tasks raises the next design question: how should tasks talk to each other? The next article covers channels for message passing and `Arc<Mutex<T>>` for shared state.

---

**References**

- [Tutorial - Tokio](https://tokio.rs/tokio/tutorial)
- [Spawning - Tokio](https://tokio.rs/tokio/tutorial/spawning)
- [tokio::spawn - Tokio API documentation](https://docs.rs/tokio/latest/tokio/task/fn.spawn.html)
- [tokio::time::timeout - Tokio API documentation](https://docs.rs/tokio/latest/tokio/time/fn.timeout.html)
