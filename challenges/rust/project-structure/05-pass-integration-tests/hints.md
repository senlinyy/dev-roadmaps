The integration test imports rust_notes::count_words, so lib.rs must re-export it.
---
Inside parser.rs, implement the same whitespace-counting behavior used earlier.
---
A small lib.rs can be mod parser; pub use parser::count_words;.
