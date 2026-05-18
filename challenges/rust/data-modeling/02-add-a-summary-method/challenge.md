---
title: "Add A Summary Method"
sectionSlug: "methods"
order: 2
---
Attach behavior to the note type with an impl block.

Your job:

1. **Add** a public `summary` method on `Note`.
2. **Borrow** the note with `&self` so calling the method does not consume the note.
3. **Return** a string in the format `"{title}: {body length} characters"`, so a note titled `"Rust notes"` with body `"Cargo"` returns `"Rust notes: 5 characters"`.

`Cargo.toml` is read-only project setup. The read-only tests live in `tests/summary_test.rs`; edit `src/lib.rs` only.

The grader calls the method on a note.
