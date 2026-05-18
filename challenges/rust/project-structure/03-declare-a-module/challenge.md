---
title: "Declare A Module"
sectionSlug: "modules"
order: 3
---
A Rust file becomes part of the crate when the crate root declares a module for it. Wire parser.rs into the library.

Your job:

1. **Declare** the parser module in src/lib.rs.
2. **Use** parser::words(text).len() inside count_words.
3. **Run** the Cargo tests.

`Cargo.toml` is read-only project setup. The read-only tests live in `tests/module_test.rs`; edit `src/lib.rs` only.

The grader checks that the library function works through the module.
