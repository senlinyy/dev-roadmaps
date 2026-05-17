---
title: "Interior Mutability"
description: "Use Cell, RefCell, Mutex, and runtime borrow checks when a value needs controlled mutation behind an immutable-looking API."
overview: "Interior mutability is one of Rust's escape hatches for designs the compiler cannot prove with normal references. It stays safe by moving borrow checks into a type."
tags: ["refcell", "cell", "mutex", "interior-mutability"]
order: 2
id: article-rust-advanced-rust-interior-mutability
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Shared Outside, Mutable Inside](#shared-outside-mutable-inside)
3. [The Pattern](#the-pattern)
4. [Cell](#cell)
5. [RefCell](#refcell)
6. [Mutex](#mutex)
7. [When To Avoid It](#when-to-avoid-it)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

The notes parser has a public method that looks read-only:

```rust
fn parse(&self, source: &str) -> ParsedNote
```

That shape is pleasant for callers. They can share one parser value and call it many times. Inside the parser, though, a small cache would be useful. It could remember the last title pattern or count how many documents were parsed.

Normal Rust borrowing says an immutable `&self` method cannot mutate fields. Most of the time, that is exactly what you want. Interior mutability is for the narrower case where the outer API should stay immutable, but a specific inner value needs controlled mutation.

## Shared Outside, Mutable Inside

`&self` means callers only have shared access to the value. From the outside, the method looks read-only: many callers can hold shared references at the same time.

Interior mutability is the pattern where a wrapper type allows one private field to change anyway, while still enforcing rules inside the wrapper.

That is different from casual mutation in JavaScript or Python. The mutation is not hidden free-for-all state. It is routed through a type such as `Cell`, `RefCell`, or `Mutex` that controls how access happens.

## The Pattern

Interior mutability means a type allows mutation through a shared reference, while still preserving Rust's safety rules.

The key is that the rules move into the wrapper type:

| Type | Good for |
| --- | --- |
| `Cell<T>` | Copy-like values that can be replaced |
| `RefCell<T>` | Single-threaded runtime borrow checking |
| `Mutex<T>` | Shared mutation across threads or async boundaries |

This is not "turning off Rust." Safe interior mutability types still enforce rules. They just enforce them differently.

The Rust Book describes `RefCell<T>` as checking borrowing rules at runtime instead of compile time. If you break the rules, the program panics rather than compiling the mistake away.

:::expand[Interior mutability moves the check, not the responsibility]{kind="design"}
Interior mutability exists because static analysis is conservative. Sometimes you know a design is safe, but the compiler cannot prove it from ordinary references.

`RefCell<T>` lets you say: keep the public value shareable, and check the borrow rules when the code actually runs.

That gives you flexibility, but it changes the failure mode:

| Borrowing shape | Rule checked | Failure |
| --- | --- | --- |
| `&T` and `&mut T` | Compile time | Code does not compile |
| `RefCell<T>` | Runtime | Program panics if rules are broken |
| `Mutex<T>` | Runtime | Thread or task waits for the lock |

This is why interior mutability should feel like a design decision, not a shortcut. You are choosing a different enforcement point.

Use it when the wrapper is the clearest owner of the invariant. Avoid it when the code could simply take `&mut self`, return owned data, or split the structure into smaller pieces.
:::

## Cell

`Cell<T>` is useful for small values that can be copied or replaced.

```rust
use std::cell::Cell;

struct ParserStats {
    parsed_count: Cell<usize>,
}

impl ParserStats {
    fn record_parse(&self) {
        let current = self.parsed_count.get();
        self.parsed_count.set(current + 1);
    }
}
```

`record_parse` takes `&self`, but it can update the inner `Cell`.

`Cell` does not hand out references to the inside value. It works by copying values in and out or replacing the value. That makes it a good fit for counters, flags, and other small simple state.

## RefCell

`RefCell<T>` gives runtime borrow checking in one thread.

```rust
use std::cell::RefCell;

struct Parser {
    warnings: RefCell<Vec<String>>,
}

impl Parser {
    fn warn(&self, message: &str) {
        self.warnings.borrow_mut().push(message.to_string());
    }

    fn warning_count(&self) -> usize {
        self.warnings.borrow().len()
    }
}
```

`borrow()` gives a shared borrow. `borrow_mut()` gives a mutable borrow. If code tries to create a mutable borrow while shared borrows are active, `RefCell` panics.

That panic is memory-safe, but it is still a bug. Keep `RefCell` borrows short and local. Do not pass them through large parts of the program if a simpler API can hide the detail.

:::expand[A RefCell panic is safe, but still a bug]{kind="pitfall"}
`RefCell<T>` enforces Rust's borrowing rule at runtime: many shared borrows or one mutable borrow.

This panics:

```rust
use std::cell::RefCell;

let warnings = RefCell::new(Vec::new());

let read = warnings.borrow();
let mut write = warnings.borrow_mut();

write.push(String::from("late warning"));
println!("{}", read.len());
```

The program stays memory-safe. `RefCell` refuses to hand out a mutable borrow while a shared borrow is active. But the panic is still a bug in the control flow.

The usual fix is to shorten the borrow:

```rust
let count = warnings.borrow().len();
println!("{count}");

warnings.borrow_mut().push(String::from("late warning"));
```

Use `RefCell` when runtime checking is the right design. Do not use it to postpone thinking about borrow scopes forever.
:::

## Mutex

`Mutex<T>` protects mutation with a lock.

```rust
use std::sync::{Arc, Mutex};

struct IndexState {
    indexed: Mutex<usize>,
}

let state = Arc::new(IndexState {
    indexed: Mutex::new(0),
});

let mut value = state.indexed.lock().unwrap();
*value += 1;
```

Use a mutex when multiple threads or tasks may need to mutate the same state. The lock ensures one mutable access at a time.

The same lock-scope rule from async applies here too: keep the locked section small. A mutex is a synchronization boundary. Treat it as a place where performance and clarity can be lost if the critical section grows casually.

## When To Avoid It

Interior mutability can make code harder to reason about because mutation is less visible from the outside.

Avoid it when a normal mutable method is clear:

```rust
impl Parser {
    fn reset(&mut self) {
        self.cache.clear();
    }
}
```

Avoid it when ownership can be simplified:

```rust
fn parse(source: &str) -> ParsedNote {
    // no shared parser state needed
}
```

Avoid it as a way to silence the borrow checker. If the design is confusing with normal references, adding `RefCell` may only move the confusion to runtime.

:::expand[RefCell is useful in tests, caches, and graph-like designs]{kind="pattern"}
`RefCell<T>` is most useful when mutation is real but should be hidden behind a shared API.

Common examples:

| Use case | Why it fits |
| --- | --- |
| Test double records calls | Trait method takes `&self`, but the mock needs to record messages |
| Lazy cache | Public method is read-only, but computed data can be saved |
| Single-threaded graph | Multiple nodes need shared links and local mutation |

The test-double case is especially practical:

```rust
use std::cell::RefCell;

struct Recorder {
    events: RefCell<Vec<String>>,
}

impl Recorder {
    fn record(&self, event: &str) {
        self.events.borrow_mut().push(event.to_string());
    }
}
```

The caller only needs `&Recorder`, but the recorder can remember what happened.

The rule of thumb: the smaller and more private the `RefCell`, the better. If `RefCell` leaks into many public types and function signatures, the design may be asking callers to reason about runtime borrowing instead of giving them a clear API.
:::

## Putting It All Together

The notes parser can expose a simple shared API while tracking small internal state:

```rust
use std::cell::{Cell, RefCell};

struct Parser {
    parsed_count: Cell<usize>,
    warnings: RefCell<Vec<String>>,
}

impl Parser {
    fn parse(&self, source: &str) {
        self.parsed_count.set(self.parsed_count.get() + 1);

        if source.trim().is_empty() {
            self.warnings.borrow_mut().push(String::from("empty note"));
        }
    }
}
```

The caller sees `&self`. The parser owns the responsibility for controlled internal mutation.

Count back to the opener:

- `Cell` works for simple counters.
- `RefCell` works for single-threaded runtime borrowing.
- `Mutex` works when shared mutation crosses threads.
- The design cost is less visible mutation, so use it deliberately.

## What's Next

Interior mutability changes how one value manages mutation. The next article changes another dimension: how to store different concrete types behind one shared behavior using trait objects.

---

**References**

- [RefCell and the Interior Mutability Pattern - The Rust Programming Language](https://doc.rust-lang.org/book/ch15-05-interior-mutability.html)
- [Cell - Rust standard library](https://doc.rust-lang.org/std/cell/struct.Cell.html)
- [RefCell - Rust standard library](https://doc.rust-lang.org/std/cell/struct.RefCell.html)
- [Mutex - Rust standard library](https://doc.rust-lang.org/std/sync/struct.Mutex.html)
