~~~rust
pub enum NoteState {
    Draft,
    Published { published_at: String },
    Archived { reason: String },
}

pub struct Note {
    pub title: String,
    pub body: String,
    pub state: NoteState,
}

pub fn published_note() -> Note {
    Note {
        title: String::from("Rust notes"),
        body: String::from("Cargo creates projects"),
        state: NoteState::Published {
            published_at: String::from("2026-05-18"),
        },
    }
}
~~~
