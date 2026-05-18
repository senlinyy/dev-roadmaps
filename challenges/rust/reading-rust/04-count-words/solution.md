~~~rust
pub fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}
~~~

The function borrows text, splits it into whitespace-separated words, and returns the count.
