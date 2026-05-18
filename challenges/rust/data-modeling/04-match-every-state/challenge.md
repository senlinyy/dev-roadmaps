---
title: "Match Every State"
sectionSlug: "match"
order: 4
---
Use match as a decision table for every note state.

Your job:

1. **Match** on &note.state.
2. **Return** draft, published at {date}, or archived: {reason}.
3. **Handle** every variant directly.

`Cargo.toml` is read-only project setup. The read-only tests live in `tests/status_line_test.rs`; edit `src/lib.rs` only.

The grader checks all three states.
