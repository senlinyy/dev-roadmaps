---
title: "Processes, Threads, and I/O"
description: "Trace how Rust programs run work, wait on files and sockets, share state across threads, and use async tasks for I/O-heavy systems."
overview: "Rust concurrency is easier when processes, threads, blocking I/O, async waiting, and shared state are clear. This article introduces those ideas before the async and production modules."
tags: ["processes", "threads", "io", "concurrency"]
order: 5
id: article-rust-computer-science-for-rust-processes-threads-io
---

## Table of Contents

1. [What Is a Process?](#what-is-a-process)
2. [Starting Child Processes](#starting-child-processes)
3. [What Is a Thread?](#what-is-a-thread)
4. [Sharing Data Between Threads](#sharing-data-between-threads)
5. [I/O and Blocking](#io-and-blocking)
6. [Async I/O](#async-io)
7. [Choosing the Right Execution Shape](#choosing-the-right-execution-shape)
8. [Common Concurrency Problems](#common-concurrency-problems)

## What Is a Process?

A process is a running program managed by the operating system. When you run a Rust binary, the operating system gives it memory, command-line arguments, environment variables, open file handles, and an exit status.

You can see processes on a Linux machine with `ps`:

```bash
$ ps -o pid,ppid,comm
    PID    PPID COMMAND
   1024    1010 zsh
   2042    1024 cargo
   2049    2042 notes-cli
```

`PID` means process ID, the unique number the kernel assigns to a running process. `PPID` means parent process ID. In this example, the shell starts Cargo, and Cargo starts the compiled Rust binary.

A Rust binary begins at `main`:

```rust
fn main() {
    println!("process is running");
}
```

When `main` returns, the process exits. A successful process usually exits with status code `0`. A non-zero status usually means failure.

## Starting Child Processes

Rust can start another program with `std::process::Command`.

```rust
use std::process::Command;

fn main() -> std::io::Result<()> {
    let output = Command::new("rustc")
        .arg("--version")
        .output()?;

    println!("{}", String::from_utf8_lossy(&output.stdout));
    Ok(())
}
```

The `Command::new("rustc")` call prepares a child process. The `.arg("--version")` call adds an argument. The `.output()?` call starts the child process, waits for it to finish, and captures its output.

The return type is `std::io::Result<()>` because starting a process can fail. The executable may not exist. Permissions may block execution. The operating system may refuse the request.

Child process output is bytes, not automatically a Rust `String`. That is why the example uses `String::from_utf8_lossy`. It converts UTF-8 bytes into printable text and replaces invalid sequences if needed.

Processes are separated by the operating system. One process cannot freely read another process's memory. Processes communicate through files, pipes, sockets, signals, exit codes, and operating-system APIs.

## What Is a Thread?

A thread is a path of execution inside a process. A process starts with at least one thread. It can create more threads to do work at the same time.

Rust starts a thread with `std::thread::spawn`:

```rust
use std::thread;

fn main() {
    let handle = thread::spawn(|| {
        println!("hello from another thread");
    });

    handle.join().unwrap();
}
```

The closure runs on another operating-system thread. The `JoinHandle` returned by `spawn` lets the main thread wait for the spawned thread to finish. The call to `join` returns a `Result` because the spawned thread may panic.

If the new thread needs owned data, use `move`:

```rust
use std::thread;

fn main() {
    let title = String::from("Rust notes");

    let handle = thread::spawn(move || {
        println!("{title}");
    });

    handle.join().unwrap();
}
```

The `move` keyword moves `title` into the closure. This is necessary because the new thread may outlive the function that created it. Rust will not let a spawned thread hold a normal reference to a local value that could disappear first.

## Sharing Data Between Threads

Moving data into one thread is straightforward. Sharing one value across threads needs coordination.

One common pattern is `Arc<Mutex<T>>`:

```rust
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let count = Arc::new(Mutex::new(0));
    let mut handles = Vec::new();

    for _ in 0..3 {
        let count_for_thread = Arc::clone(&count);

        let handle = thread::spawn(move || {
            let mut value = count_for_thread.lock().unwrap();
            *value += 1;
        });

        handles.push(handle);
    }

    for handle in handles {
        handle.join().unwrap();
    }

    println!("{}", *count.lock().unwrap());
}
```

The output is:

```text
3
```

`Arc<T>` means atomic reference counting. It lets several threads own the same allocation. `Mutex<T>` protects access to the inner value so only one thread can hold the lock at a time.

The `lock()` call returns a guard. While the guard exists, the thread has access to the protected value. When the guard goes out of scope, the lock is released.

Rust also uses two marker traits in thread-safety checks:

| Trait | Meaning |
| --- | --- |
| `Send` | A value can be moved to another thread |
| `Sync` | Shared references to the value can be used from multiple threads |

Beginners usually meet `Send` and `Sync` in compiler errors. The error means a type is being moved or shared across threads in a way Rust cannot prove is safe.

## I/O and Blocking

I/O means input and output. It is how a program talks to files, terminals, networks, databases, timers, and other operating-system services.

Reading a file is I/O:

```rust
use std::fs;

fn main() -> std::io::Result<()> {
    let text = fs::read_to_string("notes.txt")?;
    println!("{text}");
    Ok(())
}
```

This is blocking I/O. Blocking means the current thread waits until the operation finishes. For a command-line program, blocking file reads are often fine. The program needs the file before it can continue anyway.

Network servers have a different shape. If a thread waits on one slow connection, it cannot do other work during that wait. A server with many connections needs a way to keep many I/O operations in progress without creating an excessive number of operating-system threads.

Blocking can still be the right choice. A backup tool, migration script, small CLI, or build tool may be simpler and perfectly fast with blocking I/O. The execution shape should match the workload.

## Async I/O

Async Rust represents work that can pause while waiting and resume later. An `async fn` returns a future. A future is a value that represents work that has not necessarily completed yet.

```rust
async fn fetch_note(id: u64) -> Result<String, String> {
    Ok(format!("note {id}"))
}
```

Calling `fetch_note(1)` creates a future. The function body does not run to completion by itself. An async runtime, such as Tokio, drives futures forward. When a future reaches `.await`, it can pause and let the runtime run other ready work.

A small Tokio example looks like this:

```rust
#[tokio::main]
async fn main() {
    let body = fetch_note(1).await.unwrap();
    println!("{body}");
}

async fn fetch_note(id: u64) -> Result<String, String> {
    Ok(format!("note {id}"))
}
```

The `#[tokio::main]` attribute sets up the runtime and runs the async `main` function. In a real program, `fetch_note` might wait on a network request or database query.

Async is useful for I/O-heavy programs. It does not make CPU-heavy work free. If an async task spends a long time compressing data, parsing a huge file, or calculating hashes without yielding, it can delay other tasks on the same runtime worker.

## Choosing the Right Execution Shape

Different workloads need different tools.

| Workload | Common Rust shape |
| --- | --- |
| Small CLI reading a few files | Blocking standard library I/O |
| CPU-heavy work across cores | Threads or a worker pool |
| Many network connections | Async runtime such as Tokio |
| Shared mutable state | `Arc<Mutex<T>>`, atomics, or channels |
| Separate program boundary | Child process with `Command` |

Channels are another common tool. A channel lets one thread or task send messages to another. This can be easier than sharing a mutable value directly because the message has one owner at a time.

```rust
use std::sync::mpsc;
use std::thread;

fn main() {
    let (sender, receiver) = mpsc::channel();

    thread::spawn(move || {
        sender.send(String::from("done")).unwrap();
    });

    println!("{}", receiver.recv().unwrap());
}
```

The output is:

```text
done
```

The spawned thread sends an owned `String` through the channel. The receiving side takes ownership of that string.

## Common Concurrency Problems

Concurrency bugs often depend on timing, which makes them hard to reproduce.

A data race happens when multiple threads access the same memory at the same time, at least one access writes, and there is no safe synchronization. Safe Rust prevents data races.

A deadlock happens when work waits forever. A common deadlock shape is two threads holding locks that each other needs. Rust's type system does not prevent every deadlock, so lock ordering and short lock scopes still matter.

A blocked async worker can also cause trouble. If an async task performs a long blocking operation on a runtime worker, other async tasks may be delayed. Async runtimes usually provide special APIs for blocking work so it can run on a dedicated blocking thread pool.

Shared state also needs careful design. `Arc<Mutex<T>>` is useful, but it should not become the default answer for every problem. Sometimes a channel, a better ownership boundary, or separate tasks with clear messages makes the program easier to understand.

Rust's contribution is that many dangerous sharing patterns are rejected before the program runs. The programmer still chooses the architecture: process, thread, blocking I/O, async task, lock, channel, or some combination of them.

---

**References**

- [The Rust Programming Language: Fearless Concurrency](https://doc.rust-lang.org/book/ch16-00-concurrency.html) - Official Rust book chapter on threads, message passing, shared state, `Send`, and `Sync`.
- [Rust Standard Library: std::thread](https://doc.rust-lang.org/std/thread/) - Official documentation for Rust thread APIs.
- [Rust Standard Library: std::sync](https://doc.rust-lang.org/std/sync/) - Official documentation for synchronization primitives such as `Arc` and `Mutex`.
- [Rust Standard Library: std::process](https://doc.rust-lang.org/std/process/) - Official documentation for spawning and controlling child processes.
- [Asynchronous Programming in Rust](https://rust-lang.github.io/async-book/) - Official async book explaining futures, async functions, executors, and runtimes.
