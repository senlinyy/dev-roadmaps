~~~rust
pub fn bump_count() -> i32 {
    let mut count = 3;
    count = count + 1;
    count
}
~~~

mut marks the binding that changes, and the final expression returns the updated count.
