---
title: "Threads, Send, And Sync"
description: "Understand OS threads, move closures, JoinHandle, Arc, Mutex, Send, Sync, and when CPU-bound work needs a different tool than async."
overview: "Async is excellent for I/O waiting, but Rust also gives direct tools for thread-based concurrency. Send and Sync connect ownership rules to thread safety."
tags: ["threads", "send", "sync", "arc", "mutex"]
order: 4
id: article-rust-async-and-production-threads-send-and-sync
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Threads vs Async Tasks](#threads-vs-async-tasks)
3. [Threads](#threads)
4. [Move Closures](#move-closures)
5. [Join Handles](#join-handles)
6. [Shared Thread State](#shared-thread-state)
7. [Send And Sync](#send-and-sync)
8. [CPU Work vs I/O Work](#cpu-work-vs-io-work)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem

The async notes app can wait on many network operations. Now it gets a different job: rebuild a search index for a large local notes folder.

This work is CPU-heavy:

- Parse many markdown files.
- Normalize text.
- Count words and tags.
- Build index entries.

Async does not automatically make CPU work faster. If a task spends its time computing instead of waiting, it may block a runtime worker thread. For CPU-heavy work, ordinary threads or a parallelism library may be the better tool.

## Threads vs Async Tasks

An async task is managed by a runtime and makes progress when it is polled. It is best when the work often waits on I/O and reaches `.await` points.

An operating system thread is scheduled by the OS and can run CPU work in parallel on another core. It has a heavier setup cost, but it is the direct tool for computation that needs real parallel execution.

| Need | Better starting point |
| --- | --- |
| Many network requests waiting on I/O | Async tasks |
| A server handling many sockets | Async runtime |
| CPU-heavy parsing or indexing | Threads or Rayon |
| Blocking library inside async code | Dedicated blocking thread or runtime helper |

If you know JavaScript, async may feel like the whole concurrency story. Rust gives you async tasks and OS threads because waiting and computing are different bottlenecks.

## Threads

Rust can spawn operating system threads with `std::thread::spawn`.

```rust
use std::thread;

fn main() {
    let handle = thread::spawn(|| {
        2 + 2
    });

    let result = handle.join().unwrap();
    println!("{result}");
}
```

The closure runs on another thread. `join` waits for it to finish and returns its result.

Threads are heavier than async tasks. They have their own stacks and are scheduled by the operating system. That cost is worth paying when the work is CPU-bound or when you need blocking code to run away from an async runtime.

## Move Closures

A spawned thread may outlive the function that created it. That means it cannot borrow local data unless Rust can prove the borrow is valid long enough.

This is the common pattern:

```rust
use std::thread;

fn main() {
    let numbers = vec![1, 2, 3, 4];

    let handle = thread::spawn(move || {
        numbers.iter().sum::<i32>()
    });

    let total = handle.join().unwrap();
    println!("{total}");
}
```

The `move` keyword moves `numbers` into the closure. The new thread owns the vector, so it can safely use it even after the original function continues.

This is the same ownership idea you saw with `tokio::spawn`. Work that may outlive the current stack frame must own its data or use a safe sharing mechanism.

## Join Handles

`thread::spawn` returns a `JoinHandle`.

```rust
let handle = std::thread::spawn(move || {
    "indexed"
});

let output = handle.join();
```

`join` returns a `Result`. `Ok(value)` means the thread finished and produced a value. `Err(...)` means the thread panicked.

```rust
match handle.join() {
    Ok(value) => println!("{value}"),
    Err(_) => eprintln!("index thread panicked"),
}
```

If completion matters, keep the handle and join it. Dropping the handle does not give you the result, and the main program may exit before detached work is useful.

## Shared Thread State

When several threads need the same state, use `Arc` for shared ownership and synchronization for mutation.

```rust
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let total = Arc::new(Mutex::new(0usize));
    let mut handles = Vec::new();

    for count in [10, 20, 30] {
        let total = Arc::clone(&total);

        handles.push(thread::spawn(move || {
            let mut value = total.lock().unwrap();
            *value += count;
        }));
    }

    for handle in handles {
        handle.join().unwrap();
    }

    println!("{}", *total.lock().unwrap());
}
```

`Arc` lets each thread own a handle to the same `Mutex`. The `Mutex` ensures only one thread mutates the value at a time.

The tradeoff is contention. If many threads spend most of their time waiting for one lock, the program may not get much parallel speedup. Shared state is powerful, but it should be designed carefully.

## Send And Sync

`Send` and `Sync` are marker traits that describe thread-safety properties.

They have no methods. They are compiler-checked labels about whether values can move to another thread or be shared by reference across threads.

`Send` means a value can be moved to another thread. `Sync` means references to a value can be shared between threads safely.

You usually do not implement these traits yourself. Rust implements them automatically when a type's fields make it safe.

```rust
use std::rc::Rc;

fn main() {
    let value = Rc::new(String::from("note"));

    std::thread::spawn(move || {
        println!("{value}");
    });
}
```

This does not compile because `Rc<T>` is not thread-safe. Its reference count is not updated atomically. Use `Arc<T>` when shared ownership crosses threads.

```rust
use std::sync::Arc;

fn main() {
    let value = Arc::new(String::from("note"));
    let other = Arc::clone(&value);

    std::thread::spawn(move || {
        println!("{other}");
    })
    .join()
    .unwrap();
}
```

The compiler is enforcing a real safety boundary. Values that are safe in one thread are not automatically safe across threads.

:::expand[Why Rc cannot cross threads]{kind="design"}
`Send` and `Sync` are easy to memorize badly, so tie them to two questions.

| Question | Trait |
| --- | --- |
| Can ownership of this value move to another thread? | `Send` |
| Can references to this value be shared across threads? | `Sync` |

Most ordinary owned values are `Send`: `String`, `Vec<T>` when `T` is `Send`, and many structs made from safe fields.

Some values are deliberately not `Send` or not `Sync`. `Rc<T>` is the classic example. It is good for single-threaded shared ownership, but its reference count is not safe to update from multiple threads. `Arc<T>` pays the cost for thread-safe shared ownership.

This is why Rust concurrency errors often feel like ownership errors with a new vocabulary. The compiler asks whether the value can be moved or shared across the boundary you are creating.

Do not treat `Send` and `Sync` as advanced trivia. They are the type-system version of a code review question: is this value safe to move or share between threads?
:::

## CPU Work vs I/O Work

Use the workload to choose the concurrency tool.

| Workload | Good starting tool |
| --- | --- |
| Many network waits | Async tasks |
| Many timers or sockets | Async runtime |
| CPU-heavy parsing | Threads or parallel iterator library |
| Blocking library inside async app | Dedicated blocking thread or runtime helper |
| Shared mutable data | `Arc<Mutex<T>>` or an owner task |

The notes indexer is CPU-heavy, so splitting files across worker threads can help. The remote note fetcher is I/O-heavy, so async tasks are a better fit.

Good Rust programs often use both. Match the model to the bottleneck.

## Putting It All Together

The notes app can index chunks of work on threads:

```rust
use std::thread;

fn count_words(text: String) -> usize {
    text.split_whitespace().count()
}

fn main() {
    let docs = vec![
        String::from("rust ownership borrowing"),
        String::from("async tasks channels"),
    ];

    let handles: Vec<_> = docs
        .into_iter()
        .map(|doc| thread::spawn(move || count_words(doc)))
        .collect();

    let total: usize = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .sum();

    println!("{total}");
}
```

Each thread owns one document string. Each handle is joined. The program sums the results after all workers finish.

Count back to the opener:

- CPU-heavy indexing is different from I/O waiting.
- Threads can run computation in parallel.
- `move` gives each thread owned data.
- `Send` and `Sync` explain what can cross thread boundaries.

## What's Next

You now have Rust's main concurrency shapes: async tasks, channels, shared state, and threads. The next articles step out of the language mechanics and into real projects, production structure, and specialization paths.

---

**References**

- [Fearless Concurrency - The Rust Programming Language](https://doc.rust-lang.org/book/ch16-00-concurrency.html)
- [std::thread - Rust standard library](https://doc.rust-lang.org/std/thread/)
- [Arc - Rust standard library](https://doc.rust-lang.org/std/sync/struct.Arc.html)
- [Send - Rust standard library](https://doc.rust-lang.org/std/marker/trait.Send.html)
- [Sync - Rust standard library](https://doc.rust-lang.org/std/marker/trait.Sync.html)
