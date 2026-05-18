---
title: "Fix Mutability"
sectionSlug: "bindings"
order: 2
---
Rust bindings are immutable unless a changing value is marked with mut. This file tries to update a count after binding it.

Your job:

1. **Find** the binding that changes later.
2. **Mark** that binding mutable.
3. **Run** the tests.

`Cargo.toml` is read-only project setup. The read-only tests live in `tests/bump_count_test.rs`; edit `src/lib.rs` only.

The grader checks the function behavior with visible tests.
