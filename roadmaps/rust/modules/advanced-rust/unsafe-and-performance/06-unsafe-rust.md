---
title: "Unsafe Rust"
description: "Understand unsafe blocks, raw pointers, unsafe functions, invariants, and safe wrappers without treating unsafe as a shortcut."
overview: "Unsafe Rust exists for boundaries the compiler cannot fully verify. Use it in small, justified sections wrapped in safe APIs."
tags: ["unsafe", "raw-pointers", "invariants", "safety"]
order: 2
id: article-rust-advanced-rust-unsafe-rust
---

## Table of Contents

1. [The Problem](#the-problem)
2. [References vs Raw Pointers](#references-vs-raw-pointers)
3. [What Unsafe Means](#what-unsafe-means)
4. [Unsafe Blocks](#unsafe-blocks)
5. [Invariants](#invariants)
6. [Safe Wrappers](#safe-wrappers)
7. [When To Avoid Unsafe](#when-to-avoid-unsafe)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

The notes indexer is fast enough for small folders, but a hot parser path is now measurable. A teammate suggests raw pointers to avoid bounds checks.

That may or may not be reasonable. The important point is that `unsafe` performs a small set of operations where Rust cannot enforce all safety rules for you.

Unsafe Rust asks a serious question: what invariant are you promising the compiler that it cannot prove?

## References vs Raw Pointers

A Rust reference, such as `&T` or `&mut T`, carries compiler-checked guarantees. It must point to valid data, respect borrowing rules, and stay within its lifetime.

A raw pointer, such as `*const T` or `*mut T`, is a lower-level address-like value. It can be null, dangling, misaligned, or point to uninitialized data. Rust cannot prove otherwise.

That is why creating a raw pointer can be safe, but dereferencing it is unsafe:

```rust
let value = 42;
let ptr = &value as *const i32;

unsafe {
    println!("{}", *ptr);
}
```

The unsafe block is where you promise that this raw pointer is valid to read.

## What Unsafe Means

Unsafe Rust gives access to operations such as:

- Dereferencing raw pointers.
- Calling unsafe functions.
- Accessing or modifying mutable statics.
- Implementing unsafe traits.
- Accessing union fields.

These operations are useful for low-level code, FFI, custom data structures, and highly specialized performance work.

Unsafe does not disable the borrow checker for the whole file. It creates a block or item where you take responsibility for specific guarantees.

```rust
let value = 42;
let ptr = &value as *const i32;

unsafe {
    println!("{}", *ptr);
}
```

The raw pointer dereference is unsafe because Rust cannot prove the pointer is valid at that point. You are promising that it is.

:::expand[unsafe means unchecked responsibility]{kind="design"}
The word `unsafe` can sound like "this code is bad." A better reading is: "the compiler needs a human-maintained invariant here."

Safe Rust enforces memory safety through the type system. Unsafe Rust lets you step outside a few checks because some correct programs cannot be expressed otherwise.

That changes the review question:

| Safe code review | Unsafe code review |
| --- | --- |
| Does the type express the rule? | What invariant is being promised? |
| Can the compiler enforce it? | Where is it documented? |
| What does the function return? | Can callers break the invariant? |
| Are errors handled? | Is the unsafe block minimal? |

Unsafe code should usually be boring and small. The cleverness belongs in the proof: why is this pointer valid, why is this aliasing okay, why can this external function be called with these arguments?
:::

## Unsafe Blocks

An unsafe block should be as small as practical.

```rust
fn first_byte(bytes: &[u8]) -> Option<u8> {
    if bytes.is_empty() {
        return None;
    }

    let ptr = bytes.as_ptr();

    let byte = unsafe { *ptr };
    Some(byte)
}
```

This example does not need unsafe in real code. `bytes[0]` or `bytes.first()` is clearer. It is useful only to show the shape: the unsafe operation is tiny, and the safe check happens before it.

If an unsafe block grows large, it becomes harder to see which facts make it safe.

## Invariants

An invariant is a condition that must remain true for the unsafe code to be valid.

For the previous example, the invariant is:

```text
ptr points to at least one initialized byte from bytes.
```

The code establishes that invariant by checking `bytes.is_empty()` before dereferencing.

Unsafe code should make invariants visible in the surrounding safe code and in nearby documentation. The unsafe block itself is not the proof. The proof is the logic that guarantees the block is valid.

## Safe Wrappers

The common pattern is to hide unsafe operations behind a safe API.

```rust
fn first_byte(bytes: &[u8]) -> Option<u8> {
    if bytes.is_empty() {
        None
    } else {
        Some(unsafe { *bytes.as_ptr() })
    }
}
```

Callers cannot pass an invalid pointer because the function accepts a slice. The function checks emptiness before dereferencing. The unsafe detail does not leak into the caller's code.

This is the design habit to carry forward:

| Layer | Job |
| --- | --- |
| Public safe API | Make invalid use hard or impossible |
| Internal checks | Establish invariants |
| Unsafe block | Do the tiny operation requiring manual proof |

## When To Avoid Unsafe

Avoid unsafe when safe Rust is clear enough.

This is better than the unsafe example:

```rust
fn first_byte(bytes: &[u8]) -> Option<u8> {
    bytes.first().copied()
}
```

Safe standard-library APIs are usually well optimized. Before adding unsafe code for speed, benchmark the safe version and prove the unsafe version helps.

Avoid unsafe as a way to fight the borrow checker. If the safe design is hard, the unsafe design still needs to be correct. Unsafe code can make wrong designs compile, which is worse than a compiler error.

:::expand[Unsafe performance work needs evidence]{kind="pitfall"}
The most common unsafe mistake is adding it before measuring.

Suppose a parser feels slow. Raw pointers might not be the bottleneck. The real cost could be allocation, UTF-8 processing, filesystem I/O, logging, or repeated parsing of the same input.

Use this sequence:

1. Write the clear safe version.
2. Benchmark the workload.
3. Profile to find the hot path.
4. Try safe improvements first.
5. Use unsafe only when the invariant is small and the measurement justifies it.

Unsafe code has a maintenance cost. Every future reader must preserve the invariant. If the speedup is imaginary or tiny, the codebase paid complexity for nothing.

A good unsafe block earns its place with a comment-sized invariant and a benchmark-sized reason.
:::

## Putting It All Together

Unsafe Rust belongs at small, justified boundaries:

```rust
fn first_byte(bytes: &[u8]) -> Option<u8> {
    if bytes.is_empty() {
        return None;
    }

    Some(unsafe { *bytes.as_ptr() })
}
```

For real application code, the safe version is better:

```rust
fn first_byte(bytes: &[u8]) -> Option<u8> {
    bytes.first().copied()
}
```

Count back to the opener:

- Unsafe is not a general performance switch.
- It allows specific operations the compiler cannot verify.
- The surrounding code must establish the invariant.
- Safe wrappers keep callers away from the unsafe details.

## What's Next

One major use of unsafe is talking to code outside Rust. The next article covers FFI: how Rust crosses the boundary to C APIs while keeping ownership and safety decisions explicit.

---

**References**

- [Unsafe Rust - The Rust Programming Language](https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html)
- [The Rustonomicon](https://doc.rust-lang.org/nomicon/)
- [Unsafe Code Guidelines Reference](https://rust-lang.github.io/unsafe-code-guidelines/)
