---
title: "Build A Note Struct"
sectionSlug: "structs"
order: 1
---
Turn loose note values into a named Rust struct.

Your job:

1. **Define** a public `Note` struct with public `title`, `body`, and `pinned` fields.
2. **Use** owned `String` values for `title` and `body`.
3. **Return** a `Note` from `sample_note()` with `title` set to `"Rust notes"`, `body` set to `"Cargo creates projects"`, and `pinned` set to `true`.

`Cargo.toml` is read-only project setup. The read-only tests live in `tests/note_struct_test.rs`; edit `src/lib.rs` only.

The grader checks field names and values through visible tests.
