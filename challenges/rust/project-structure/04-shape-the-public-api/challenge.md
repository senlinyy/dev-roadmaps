---
title: "Shape The Public API"
sectionSlug: "visibility"
order: 4
---
Keep internal file layout private and re-export the API callers should use.

Your job:

1. **Keep** parser and model as private modules.
2. **Re-export** count_words and Note from src/lib.rs.
3. **Run** the integration-style tests.

`Cargo.toml` is read-only project setup. The read-only tests live in `tests/api_test.rs`; edit the source files only.

The grader imports from the crate root, not from internal module paths.
