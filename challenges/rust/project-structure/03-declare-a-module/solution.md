~~~rust
pub mod parser;

pub fn count_words(text: &str) -> usize {
    parser::words(text).len()
}
~~~

The module declaration connects src/parser.rs to the crate, and count_words can call through the module path.
