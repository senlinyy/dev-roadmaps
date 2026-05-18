~~~rust
pub fn describe(text: &str) -> String {
    let count = count_words(text);

    if count == 0 {
        String::from("No words")
    } else {
        format!("{count} words")
    }
}
~~~

Both branches return an owned String, and the vector helper can collect those descriptions.
