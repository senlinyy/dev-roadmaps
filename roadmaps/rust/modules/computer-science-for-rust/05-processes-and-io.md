---
title: "Processes And I/O"
description: "Understand processes, child commands, threads, blocking file and socket work, shared state, and async waiting before production Rust."
overview: "Rust concurrency is easier when processes, threads, blocking I/O, async waiting, and shared state are clear. This article introduces those ideas before the async and production modules go deeper."
tags: ["processes", "threads", "io", "concurrency"]
order: 5
id: article-rust-computer-science-for-rust-processes-threads-io
aliases:
  - processes-threads-and-io
  - computer-science-for-rust/05-processes-and-io.md
  - computer-science-for-rust/05-processes-threads-and-io.md
  - computer-science-for-rust/data-and-work/05-processes-and-io.md
  - roadmaps/rust/modules/computer-science-for-rust/05-processes-threads-and-io.md
  - roadmaps/rust/modules/computer-science-for-rust/data-and-work/05-processes-and-io.md
  - child-computer-science-for-rust-05-processes-threads-and-io
  - child-data-and-work-05-processes-and-io
---

## Table of Contents

1. [What Is a Process?](#what-is-a-process)
2. [Child Processes](#child-processes)
3. [Threads](#threads)
4. [Shared State](#shared-state)
5. [I/O and Blocking](#io-and-blocking)
6. [Async I/O](#async-io)
7. [Choosing a Work Shape](#choosing-a-work-shape)
8. [Common Concurrency Problems](#common-concurrency-problems)
9. [Putting It All Together](#putting-it-all-together)
10. [Toward Ownership And Reliability](#toward-ownership-and-reliability)

## What Is a Process?

The previous article focused on collections inside one program. This article looks at work around the program: the process the operating system starts, child commands a Rust program can run, threads inside a process, and I/O that waits on files or networks.

A process is a running instance of a program. When you run a Rust binary, the operating system creates a process for it. That process gets a process ID, memory, environment variables, a current working directory, and file handles for standard input, standard output, and standard error.

Create a tiny project:

```bash
$ cargo new work-notes
    Creating binary (application) `work-notes` package
$ cd work-notes
```

Put this in `src/main.rs`:

```rust
fn main() {
    println!("process id: {}", std::process::id());
}
```

Run it:

```bash
$ cargo run
   Compiling work-notes v0.1.0 (/home/you/work-notes)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.24s
     Running `target/debug/work-notes`
process id: 18422
```

The Cargo lines show the build and launch. The final line is printed by the Rust program after the operating system has created a process. The number is the process ID, often shortened to PID. It is useful in logs and system tools because it identifies one running instance.

On a Unix-like system, you can inspect a running process from another terminal:

```bash
$ ps -p 18422 -o pid,ppid,stat,command
  PID  PPID STAT COMMAND
18422 18011 S+   target/debug/work-notes
```

`PID` is the process ID printed by Rust. `PPID` is the parent process ID, often the shell or Cargo process that started it. `STAT` is the current process state. `COMMAND` is the executable path. The exact output varies by operating system, but the reading habit is stable: find the field that proves which process you are inspecting.

Processes are isolated from each other. One process does not casually read another process's private memory. When processes communicate, they use operating-system mechanisms such as files, pipes, sockets, signals, shared memory, or child-process handles.

## Child Processes

A Rust program can start another program as a child process. The standard library type for that is `std::process::Command`.

```rust
use std::process::Command;

fn main() {
    let output = Command::new("rustc")
        .arg("--version")
        .output()
        .expect("failed to run rustc");

    println!("status: {}", output.status);
    println!("stdout: {}", String::from_utf8_lossy(&output.stdout));
    println!("stderr: {}", String::from_utf8_lossy(&output.stderr));
}
```

A possible run is:

```text
status: exit status: 0
stdout: rustc 1.85.0 (4d91de4e4 2025-02-17)

stderr:
```

`Command::new("rustc")` prepares the command name. `.arg("--version")` adds one argument. `.output()` starts the child process, waits for it to finish, and collects its exit status, stdout, and stderr.

The output value is structured data. This is different from typing `rustc --version` in a shell and only seeing text in the terminal. Rust gives the parent process separate fields:

| Field | Meaning |
| --- | --- |
| `status` | Whether the child command succeeded or failed. |
| `stdout` | Normal output bytes from the child. |
| `stderr` | Diagnostic or error output bytes from the child. |

The conversion `String::from_utf8_lossy(&output.stdout)` turns bytes into displayable text. Child process output is bytes because not every program promises valid UTF-8 text.

If you call a missing command, the error happens before there is a child status:

```rust
use std::process::Command;

fn main() {
    let result = Command::new("missing-command-for-notes").output();

    match result {
        Ok(output) => println!("status: {}", output.status),
        Err(error) => println!("could not start command: {error}"),
    }
}
```

The output is similar to:

```text
could not start command: No such file or directory (os error 2)
```

There are two different failure points. The operating system may fail to start the child at all. Or the child may start successfully and then return a non-zero exit status. Good command-running code handles both.

Those two failures happen at different layers:

```text
Command::new(...).output()
  |
  +-- Err(io::Error)
  |     the parent process could not start the child
  |
  +-- Ok(Output)
        the child started and exited
        Output.status says whether the child succeeded
        Output.stdout and Output.stderr hold the captured bytes
```

That is why `output()` itself returns a `Result<Output, io::Error>`, and `Output` still contains a separate `status` field. Starting a process and succeeding inside that process are different facts.

## Threads

A thread is a path of execution inside a process. A process starts with at least one thread. A program can create more threads to do work concurrently.

Here is a small example:

```rust
use std::thread;

fn main() {
    let handle = thread::spawn(|| {
        println!("hello from worker");
    });

    println!("hello from main");

    handle.join().expect("worker thread panicked");
}
```

A possible run is:

```text
hello from main
hello from worker
```

Another run might print the worker line first. That variation is normal. The operating system schedules threads, and the exact order can change from run to run.

The call `thread::spawn` starts a new thread. The closure `|| { ... }` is the work the new thread runs. A closure is an inline function-like value. The returned `handle` lets the main thread wait for the worker with `join`.

`join` matters because the main thread can otherwise finish before the worker has completed. Joining says: wait for this thread and tell me whether it panicked.

This version moves data into the worker:

```rust
use std::thread;

fn main() {
    let title = String::from("Deploy notes");

    let handle = thread::spawn(move || {
        println!("worker got: {title}");
    });

    handle.join().expect("worker thread panicked");
}
```

Run it:

```text
worker got: Deploy notes
```

The `move` keyword tells the closure to take ownership of the values it uses from the surrounding scope. The worker thread owns `title`. That is important because the worker may outlive the point in `main` where `title` was created. Rust will not allow a thread to keep a reference to local data unless it can prove the reference stays valid.

Without `move`, the closure would try to borrow `title` from `main`'s stack frame. That would be risky because the operating system can schedule the worker after `main` has moved on. With `move`, the `String` handle is transferred into the closure object that the new thread owns:

```text
before spawn:
main owns title -> heap text "Deploy notes"

after spawn with move:
main no longer owns title
worker closure owns title -> same heap text
```

The heap text does not need to be copied. The ownership of the handle moves to the worker, so the data stays valid until the worker is finished with it.

## Shared State

Threads in the same process can share memory, but shared mutation needs coordination. If two threads update the same value at the same time without rules, one update can overwrite another or observe half-finished state.

Rust code commonly combines `Arc<T>` and `Mutex<T>` for shared mutable state across threads:

```rust
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let counter = Arc::new(Mutex::new(0));
    let mut handles = Vec::new();

    for _ in 0..3 {
        let counter = Arc::clone(&counter);
        let handle = thread::spawn(move || {
            let mut value = counter.lock().expect("mutex poisoned");
            *value += 1;
        });
        handles.push(handle);
    }

    for handle in handles {
        handle.join().expect("worker thread panicked");
    }

    let final_count = counter.lock().expect("mutex poisoned");
    println!("counter={final_count}");
}
```

Run it:

```text
counter=3
```

There is a lot in this example, so read it slowly.

`Arc` means atomically reference-counted pointer. Reference-counted means several owners can hold handles to the same allocation, and the allocation is cleaned up when the last handle goes away. Atomically means the count can be updated safely across threads.

`Mutex` means mutual exclusion. It protects a value so only one thread can access it through the lock at a time. `counter.lock()` waits until the mutex is available and then returns a guard. The guard behaves like access to the protected value. When the guard goes out of scope, the lock is released.

Each loop iteration clones the `Arc`, not the integer. The clone creates another handle to the same mutex. Each worker locks the mutex, increments the integer, and releases the lock.

The mechanism has two layers:

```text
Arc allocation
+--------------------------------+
| reference count: 4             |
| Mutex<i32>                     |
|   locked?: no                  |
|   value: 0                     |
+--------------------------------+
```

When `Arc::clone(&counter)` runs, Rust creates another small `Arc` handle that points to the same allocation and increments the reference count. When an `Arc` handle is dropped, the count is decremented. The allocation is freed when the last handle is gone.

The `Mutex` controls access to the `i32` inside that shared allocation. A worker calls `lock()`. If no other thread holds the lock, it receives a guard. While the guard exists, the worker can mutate the counter. When the guard leaves scope at the end of the closure, Rust drops the guard, and dropping the guard unlocks the mutex. The unlock is tied to scope, which is the same cleanup pattern you saw with files, strings, and other owned values.

The type `Arc<Mutex<i32>>` tells a reader the sharing strategy:

| Part | Job |
| --- | --- |
| `i32` | The actual counter value. |
| `Mutex<i32>` | Allows one thread at a time to mutate the counter. |
| `Arc<Mutex<i32>>` | Allows multiple threads to own handles to the same mutex. |

The type is longer than a global variable, but it makes the concurrency rule visible.

## I/O and Blocking

I/O means input and output. Reading a file, writing a log, receiving network data, sending an HTTP request, and reading from standard input are all I/O work.

I/O is often slow compared with CPU work because the program waits on something outside the CPU: disk, terminal input, network packets, operating-system buffers, or another process.

Here is a blocking file read:

```rust
use std::fs;

fn main() -> std::io::Result<()> {
    let text = fs::read_to_string("notes.txt")?;

    println!("{} bytes", text.len());
    Ok(())
}
```

Create the file and run the program:

```bash
$ printf "Deploy notes" > notes.txt
$ cargo run
12 bytes
```

`fs::read_to_string` blocks the current thread until the file has been read or an error occurs. Blocking means the thread does not continue to the next line while the operation is pending.

For a command-line tool that reads one local file, blocking is simple and often correct. For a server handling thousands of network connections, one blocked thread per waiting connection can become expensive.

The timeline looks like this:

```text
thread
+-- prepare path
+-- call read_to_string
+-- wait for filesystem
+-- receive bytes or error
+-- continue Rust code
```

The waiting part is the reason I/O shapes program design. The CPU might be free, but this thread cannot use it for other work unless the program has another thread or an async runtime managing that waiting period.

## Async I/O

Async I/O is a way for a program to start work that may wait, give control back to a runtime, and resume later when the work can make progress.

The standard library has `async` syntax, but production async I/O usually uses a runtime such as Tokio or async-std. The runtime is the part that polls tasks, waits for operating-system readiness events, and decides which task should resume.

A simplified async function looks like this:

```rust
async fn read_note(path: &str) -> std::io::Result<String> {
    tokio::fs::read_to_string(path).await
}
```

The `.await` point means the task may pause there. Pausing the task is different from blocking the whole operating-system thread. While one task waits for file or network readiness, the runtime can let another task run on the same worker thread.

Mechanically, an `async fn` returns a future. A future is a value that remembers the state of work that has not finished yet. When the runtime polls that future, the future runs until it cannot make progress. At an `.await`, it may say "pending" and give control back to the runtime. Later, when the file, socket, timer, or other awaited operation is ready, the runtime polls the future again and it continues from the saved point.

That gives a different timeline from blocking I/O:

```text
blocking thread:
read request -> thread waits -> bytes arrive -> thread continues

async task:
read request -> task yields -> runtime runs other tasks -> readiness event -> task resumes
```

The task still has ordered Rust code. The difference is who waits. With blocking I/O, the operating-system thread waits. With async I/O, the task waits and the runtime can use the thread for other ready tasks.

The important beginner distinction is:

| Shape | What waits? | Common fit |
| --- | --- | --- |
| Blocking I/O | The current thread waits. | Simple CLI tools, small scripts, straightforward file work. |
| More threads | Other threads can continue while one waits. | CPU work split across cores, limited concurrent blocking work. |
| Async I/O | A task waits while the runtime schedules other tasks. | Many network connections, servers, high-concurrency I/O. |

Async is not automatically faster for every program. It adds a runtime and a different execution model. It helps most when the program has many tasks that spend much of their time waiting on I/O.

## Choosing a Work Shape

Processes, child processes, threads, blocking I/O, and async tasks solve different problems.

| Need | Common shape | Why |
| --- | --- | --- |
| Run another program and capture output | `std::process::Command` | The work already exists as a separate executable. |
| Isolate memory or permissions | Process boundary | Processes have separate address spaces. |
| Do CPU work in parallel | Threads | Multiple OS threads can run on multiple cores. |
| Share a changing value between threads | `Arc<Mutex<T>>` or another synchronization type | The sharing rule is explicit. |
| Read one file in a CLI | Blocking I/O | Simple and easy to reason about. |
| Handle many sockets concurrently | Async runtime | Waiting tasks do not need one dedicated OS thread each. |

Start with the simple shape that matches the job. A CLI does not need async just because async exists. A server with many slow network clients probably should not create one fresh thread per client forever. A Rust program that shells out to `git`, `ffmpeg`, or `terraform` should treat exit status, stdout, and stderr as separate facts.

## Common Concurrency Problems

Concurrency means multiple units of work are in progress during the same period. Parallelism means multiple units of work are literally running at the same time, often on different CPU cores. A program can be concurrent without being parallel, especially with async I/O.

Here are common problems the Rust model tries to make visible:

| Problem | What it means | Rust pressure |
| --- | --- | --- |
| Data race | Threads access the same memory at the same time, with at least one write, without synchronization. | Shared mutation needs types such as `Mutex`, atomics, or channels. |
| Deadlock | Work waits forever because locks or tasks are waiting on each other. | Rust cannot prevent all deadlocks; keep lock scopes small and ordering clear. |
| Lost child status | Parent starts a child process but ignores whether it failed. | Read `status`, `stdout`, and `stderr` deliberately. |
| Blocking the runtime | Async task calls a blocking operation on a runtime worker thread. | Use async-aware I/O or move blocking work to a blocking pool. |
| Forgotten join | Main thread exits before worker work is observed. | Keep join handles and decide how completion is handled. |

Rust's type system is strongest at memory safety. It prevents data races in safe Rust, but it does not make every concurrent design correct. A program can still wait forever, overload a service, ignore child-process failures, or hold a lock longer than needed. The compiler gives you a safer base, and design still matters.

## Putting It All Together

The `work-notes` examples showed several layers of work:

- A process is a running instance of a program with its own PID, memory, environment, working directory, and standard streams.
- A child process is another program started by your program, with status, stdout, and stderr to inspect.
- A thread is a path of execution inside a process.
- `move` closures transfer ownership into worker threads when the worker needs owned data.
- `Arc<Mutex<T>>` is a visible shared-mutation strategy across threads.
- Blocking I/O pauses the current thread until the operation finishes.
- Async I/O lets tasks pause while a runtime schedules other tasks.

The practical habit is to identify what is waiting and what is shared. If a child process runs, inspect its status and output. If threads share data, make the synchronization type visible. If I/O waits, decide whether simple blocking behavior is enough or whether the program needs a concurrency model.

## Toward Ownership And Reliability

The next module takes the memory and execution ideas from Computer Science for Rust and turns them into Rust's central reliability tools: ownership, borrowing, slices, `Option`, `Result`, and error flow. Those topics feel less arbitrary once you have seen what Rust is protecting: process state, heap allocations, references, collection contents, child-process results, and concurrent access to shared memory.

---

**References**

- [std::process](https://doc.rust-lang.org/std/process/index.html) - Standard library process management module.
- [std::process::Command](https://doc.rust-lang.org/std/process/struct.Command.html) - API for starting and controlling child processes.
- [std::thread](https://doc.rust-lang.org/std/thread/index.html) - Standard library threading module.
- [std::sync::Arc](https://doc.rust-lang.org/std/sync/struct.Arc.html) - Atomic reference counting for shared ownership across threads.
- [std::sync::Mutex](https://doc.rust-lang.org/std/sync/struct.Mutex.html) - Mutual exclusion primitive for protecting shared data.
- [Asynchronous Programming in Rust](https://rust-lang.github.io/async-book/) - Official async Rust book covering futures, tasks, and runtimes.
