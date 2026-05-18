~~~rust
pub fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}
~~~

main.rs stays thin while the reusable behavior lives in the library crate, where tests can call it directly.
