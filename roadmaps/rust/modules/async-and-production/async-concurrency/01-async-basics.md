---
title: "Async Basics"
description: "Understand async functions, futures, await points, and why asynchronous Rust needs a runtime."
overview: "Async Rust is useful when a program spends time waiting on I/O. This article explains the mental model before introducing Tokio, tasks, or shared state."
tags: ["async", "await", "futures", "runtime"]
order: 1
id: article-rust-async-and-production-async-basics
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Blocking Work](#blocking-work)
3. [Futures](#futures)
4. [Await Points](#await-points)
5. [Runtimes](#runtimes)
6. [When Async Helps](#when-async-helps)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Problem

The notes app has grown from local text files into a small networked tool. It can read local notes, fetch remote notes, and refresh metadata from a server.

The slow parts are not always CPU work:

- Reading from the network waits for packets.
- Writing a cache waits for the operating system.
- Waiting for one remote note should not stop the app from starting another request.

If the program uses blocking calls for every wait, one operation can hold the thread while nothing useful is happening. Async Rust gives the program a way to pause one operation at a waiting point and let other work make progress.

## Blocking Work

A blocking function keeps the current thread occupied until the operation finishes.

```rust
fn fetch_note_blocking(id: u64) -> Result<String, std::io::Error> {
    std::fs::read_to_string(format!("notes/{id}.txt"))
}
```

This is perfectly fine for many programs. A small CLI that reads one file and exits does not need async.

The problem appears when the app needs many waiting operations at once. If one request waits on the network, another request could be started. If one cache write is waiting, another note could be parsed.

Async is not a speed spell. It does not make the remote server faster. It helps the program use its waiting time better.

## Futures

An `async fn` does not run to completion when you call it. It returns a future.

```rust
async fn fetch_remote_note(id: u64) -> String {
    format!("note-{id}")
}

fn main() {
    let future = fetch_remote_note(1);
}
```

The variable `future` represents work that can be driven forward later. Nothing useful has finished yet.

A future is like a saved plan for work that may need to pause. The runtime asks the future to make progress. If the future is waiting on I/O, it yields. Later, when the I/O is ready, the runtime asks it to continue.

The official Async Book describes `async` as turning code into a state machine that implements `Future`. You do not need to write that state machine by hand, but the idea matters. An async function remembers where it paused and what local values it still needs.

:::expand[A future is lazy until it is driven]{kind="design"}
The biggest beginner surprise is that creating a future is not the same as running it.

This code creates a future and then drops it:

```rust
async fn refresh_index() {
    println!("refreshing");
}

fn main() {
    refresh_index();
}
```

The function body does not print because no runtime or executor drove the future to completion.

That laziness is useful. It lets Rust build async workflows before deciding how to run them. A program can create several futures, combine them, race them, add timeouts, or spawn them as tasks.

The cost is that async code has one more question to answer: who drives the future?

| Code shape | Meaning |
| --- | --- |
| `let f = work();` | Create a future |
| `work().await` | Drive it until this async function can continue |
| `tokio::spawn(work())` | Give it to the runtime as a task |

When async code seems to "do nothing," look for the missing driver. A future that is never awaited or spawned is just a value.
:::

## Await Points

Inside an async function, `.await` marks a point where the current operation may pause.

```rust
async fn load_note(id: u64) -> Result<String, std::io::Error> {
    let path = format!("notes/{id}.txt");
    let text = tokio::fs::read_to_string(path).await?;
    Ok(text)
}
```

When `read_to_string` is waiting, the async task can yield control to the runtime. The thread can then run other ready tasks.

`.await` does not mean "block this thread until done." It means "wait for this future to finish, and while it cannot make progress, let the runtime run something else."

That distinction is the heart of async Rust. The code still reads top to bottom, but waiting points become cooperative pause points.

## Runtimes

Async Rust needs a runtime to execute futures.

The Rust language provides `async` and `.await`. A runtime such as Tokio provides the scheduler, timers, async I/O, task spawning, and other pieces needed for real programs.

```rust
#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    let note = load_note(1).await?;
    println!("{note}");
    Ok(())
}
```

The `#[tokio::main]` attribute sets up a Tokio runtime and runs the async `main` function on it.

This split is important. Rust does not bake one async runtime into the language. That gives the ecosystem flexibility, but it also means you must choose a runtime when building async applications.

## When Async Helps

Async is strongest when the program has many I/O-bound operations.

| Workload | Async fit |
| --- | --- |
| Many HTTP requests | Strong fit |
| Many database or network waits | Strong fit |
| A server handling many connections | Strong fit |
| One tiny CLI request | Often unnecessary |
| CPU-heavy parsing or compression | Use threads or parallelism instead |
| Simple local file reads | Often simpler without async |

Tokio's own tutorial makes this distinction: Tokio is mainly useful when a program needs many things happening at once, especially I/O-bound work.

For the notes app, async becomes useful when it fetches many remote notes, handles many connections, or keeps a UI responsive while waiting. It is not necessary for a tiny local-only word counter.

## Putting It All Together

The async mental model now has four pieces:

```rust
async fn load_note(id: u64) -> Result<String, std::io::Error> {
    let path = format!("notes/{id}.txt");
    let text = tokio::fs::read_to_string(path).await?;
    Ok(text)
}

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    let text = load_note(1).await?;
    println!("{text}");
    Ok(())
}
```

Count back to the opener:

- The app waits on I/O.
- `async fn` creates future-shaped work.
- `.await` marks a pause point.
- Tokio drives the future on a runtime.

Async Rust is not a replacement for ownership, errors, or traits. It is those same ideas applied to code that waits.

## What's Next

One async function is only the beginning. The next article shows how Tokio runs many async operations as tasks, how `tokio::spawn` changes ownership requirements, and why task handles must be awaited when you care about completion.

---

**References**

- [async/.await Primer - Asynchronous Programming in Rust](https://rust-lang.github.io/async-book/01_getting_started/04_async_await_primer.html)
- [Tutorial - Tokio](https://tokio.rs/tokio/tutorial)
- [tokio::fs::read_to_string - Tokio API documentation](https://docs.rs/tokio/latest/tokio/fs/fn.read_to_string.html)
