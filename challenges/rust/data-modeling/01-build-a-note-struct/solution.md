~~~rust
pub struct Note {
    pub title: String,
    pub body: String,
    pub pinned: bool,
}

pub fn sample_note() -> Note {
    Note {
        title: String::from("Rust notes"),
        body: String::from("Cargo creates projects"),
        pinned: true,
    }
}
~~~

The struct groups related fields into one named type, and the sample value owns its text.
