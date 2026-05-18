~~~rust
impl Note {
    pub fn summary(&self) -> String {
        format!("{}: {} characters", self.title, self.body.len())
    }
}
~~~

The method borrows self, reads the note fields, and returns an owned formatted String.
