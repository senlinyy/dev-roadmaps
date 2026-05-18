---
title: "Pass Integration Tests"
sectionSlug: "integration-tests"
order: 5
---
Integration tests use your library like an outside caller. Make the public API strong enough for tests/parser_test.rs to compile and pass.

Your job:

1. **Expose** count_words from the crate root.
2. **Implement** the parser behavior in src/parser.rs.
3. **Run** Cargo tests.

`Cargo.toml` is read-only project setup. The read-only tests live in `tests/parser_test.rs`; edit the source files only.

The grader runs the integration test in tests/.
