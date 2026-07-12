~~~rust
impl Note {
    pub fn summary(&self) -> String {
        format!("{}: {} characters", self.title, self.body.len())
    }
}
~~~
