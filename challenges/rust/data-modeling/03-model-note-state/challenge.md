---
title: "Model Note State"
sectionSlug: "enums"
order: 3
---
Replace loose status flags with an enum that names the valid states.

Your job:

1. **Define** a public `NoteState` enum with `Draft`, `Published { published_at: String }`, and `Archived { reason: String }`.
2. **Use** `NoteState` as the public `state` field on `Note`.
3. **Make** `published_note()` return a `Note` whose state is `NoteState::Published` with `published_at` set to `"2026-05-18"`.

`Cargo.toml` is read-only project setup. The read-only tests live in `tests/state_test.rs`; edit `src/lib.rs` only.

The grader checks that state-specific data lives on the right variant.
