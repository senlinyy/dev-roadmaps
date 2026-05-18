---
title: "Describe Notes"
sectionSlug: "strings-and-vectors"
order: 5
---
Combine String, Vec, if, and a helper function. The code should turn note text into short descriptions.

Your job:

1. **Use** count_words inside describe.
2. **Return** String::from("No words") for empty text.
3. **Return** format!("{count} words") otherwise.

`Cargo.toml` is read-only project setup. The read-only tests live in `tests/describe_test.rs`; edit `src/lib.rs` only.

The grader checks the helper behavior and the vector-driven summary.
