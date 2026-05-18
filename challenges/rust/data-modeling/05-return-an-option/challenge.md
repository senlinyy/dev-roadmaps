---
title: "Return An Option"
sectionSlug: "option"
order: 5
---
A search may find a note or may find nothing. Model that expected absence with Option.

Your job:

1. **Implement** first_match(notes: &[Note], query: &str) -> Option<&Note>.
2. **Return** Some(note) for the first title containing the query.
3. **Return** None when there is no match.

`Cargo.toml` is read-only project setup. The read-only tests live in `tests/search_test.rs`; edit `src/lib.rs` only.

The grader checks both outcomes.
