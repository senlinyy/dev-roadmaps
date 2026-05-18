~~~rust
pub fn add_tax(price: i32) -> i32 {
    price + 5
}
~~~

The final expression has no semicolon, so the function returns the computed i32 and cargo check succeeds.
