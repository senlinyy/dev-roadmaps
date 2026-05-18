---
title: "Split Main And Lib"
sectionSlug: "mainrs-and-librs"
order: 2
---
Keep startup code in main.rs and reusable behavior in lib.rs.

Your job:

1. **Implement** count_words in src/lib.rs.
2. **Leave** src/main.rs as the thin caller.
3. **Run** the tests with Cargo.

`Cargo.toml` is read-only project setup. The read-only tests live in `tests/count_words_test.rs`; edit `src/lib.rs` only.

The grader uses Cargo tests against the library crate.
