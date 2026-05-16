---
title: "FFI"
description: "Call non-Rust code through foreign function interfaces while managing ABI, ownership, strings, pointers, and safe wrappers."
overview: "FFI lets Rust talk to C and other languages. The hard part is not the extern syntax; it is making ownership and validity explicit at the boundary."
tags: ["ffi", "c-abi", "extern", "unsafe"]
order: 3
id: article-rust-advanced-rust-ffi
---

## Table of Contents

1. [The Problem](#the-problem)
2. [The Boundary](#the-boundary)
3. [extern Functions](#extern-functions)
4. [Strings And Pointers](#strings-and-pointers)
5. [Safe Wrappers](#safe-wrappers)
6. [Ownership Across The Boundary](#ownership-across-the-boundary)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Problem

The notes app wants to reuse an existing C library for a specialized document parser. Rewriting the parser in Rust would take time, but calling it directly has risks.

Rust needs to know:

- What function exists in the foreign library?
- What ABI, or calling convention, does it use?
- Who owns pointers passed across the boundary?
- How are strings encoded and terminated?
- What errors can the foreign function return?

FFI means foreign function interface. It is how Rust talks to code compiled from another language.

## The Boundary

Rust cannot inspect a C function and prove it follows Rust's rules. The boundary is therefore unsafe.

The job of FFI code is to make that boundary small and explicit.

```text
safe Rust API
  |
  v
FFI wrapper
  |
  v
foreign function
```

Most of the program should call the safe Rust API. The unsafe details should be isolated in a small module that understands the foreign library's contract.

## extern Functions

Rust declares foreign functions with an `unsafe extern` block.

```rust
use std::ffi::c_char;

unsafe extern "C" {
    fn strlen(s: *const c_char) -> usize;
}
```

`"C"` names the C ABI. The function takes a raw pointer to a C character and returns a length.

Calling the function is unsafe:

```rust
use std::ffi::CString;

let text = CString::new("notes").unwrap();
let len = unsafe { strlen(text.as_ptr()) };
```

The caller must guarantee that the pointer is valid, points to a null-terminated C string, and remains alive for the call.

## Strings And Pointers

Rust `String` and C strings are not the same shape.

Rust strings are UTF-8 and know their length. C strings are usually pointers to bytes ending in a null byte.

Use `CString` when passing owned Rust text to C:

```rust
use std::ffi::CString;

let input = CString::new("hello").unwrap();
let ptr = input.as_ptr();
```

`CString::new` fails if the string contains an interior null byte, because that would make the C side see the string as ending early.

Use `CStr` when reading a borrowed C string:

```rust
use std::ffi::CStr;

let rust_view = unsafe { CStr::from_ptr(ptr) };
```

The unsafe part is proving `ptr` is valid and null-terminated.

:::expand[Strings are a boundary contract]{kind="pitfall"}
String bugs at FFI boundaries often come from assuming both languages mean the same thing by "string."

Rust:

```text
pointer + length + UTF-8 invariant
```

C string:

```text
pointer + bytes until first zero byte
```

That difference creates real failure modes:

| Mistake | Consequence |
| --- | --- |
| Pass a Rust string pointer as if null-terminated | C may read past the buffer |
| Pass text with interior `\0` | C sees a shorter string |
| Keep a pointer after the Rust owner drops | Use-after-free |
| Assume C returns UTF-8 | Rust conversion may fail |

`CString` and `CStr` are not ceremony. They are boundary types that make the contract visible.
:::

## Safe Wrappers

Do not make the whole application call unsafe FFI functions.

Wrap the boundary:

```rust
use std::ffi::{c_char, CString};

unsafe extern "C" {
    fn strlen(s: *const c_char) -> usize;
}

fn c_strlen(input: &str) -> Result<usize, std::ffi::NulError> {
    let c_input = CString::new(input)?;
    let len = unsafe { strlen(c_input.as_ptr()) };
    Ok(len)
}
```

The public function accepts `&str` and returns `Result`. It handles the C string conversion. The unsafe call is one line.

The wrapper owns the invariant: `c_input.as_ptr()` is valid and null-terminated for the duration of the call.

## Ownership Across The Boundary

The hardest FFI bugs are ownership bugs.

Ask these questions for every pointer:

| Question | Why it matters |
| --- | --- |
| Who allocated this memory? | The same side may need to free it |
| How long is the pointer valid? | Rust must not use dangling pointers |
| Can the foreign function store the pointer? | The Rust owner may need to outlive the call |
| Is the data mutable? | Aliasing rules matter |
| How are errors reported? | Return codes need Rust error types |

If C allocates memory, Rust usually needs a matching C function to free it. If Rust allocates memory, C usually should not free it unless the API was specifically designed for that ownership transfer.

Good FFI design is mostly boundary design.

## Putting It All Together

The notes app can hide its C parser behind a safe Rust module:

```rust
mod c_parser {
    use std::ffi::{c_char, CString};

    unsafe extern "C" {
        fn parse_note_len(input: *const c_char) -> usize;
    }

    pub fn parsed_len(input: &str) -> Result<usize, std::ffi::NulError> {
        let input = CString::new(input)?;
        let len = unsafe { parse_note_len(input.as_ptr()) };
        Ok(len)
    }
}
```

Callers use `parsed_len`. They do not handle raw pointers, null termination, or unsafe calls.

Count back to the opener:

- The ABI is declared explicitly.
- Strings cross through `CString` and `CStr`-style boundary types.
- Ownership rules are documented at the wrapper.
- Unsafe stays in the smallest module that needs it.

## What's Next

FFI and unsafe code should usually be justified by a real constraint. The final article in this module covers benchmarking and profiling, so optimization work is guided by evidence instead of guesses.

---

**References**

- [FFI - The Rustonomicon](https://doc.rust-lang.org/nomicon/ffi.html)
- [CString - Rust standard library](https://doc.rust-lang.org/std/ffi/struct.CString.html)
- [CStr - Rust standard library](https://doc.rust-lang.org/std/ffi/struct.CStr.html)
- [Unsafe Rust - The Rust Programming Language](https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html)
