~~~rust
pub fn status_line(note: &Note) -> String {
    match &note.state {
        NoteState::Draft => String::from("draft"),
        NoteState::Published { published_at } => {
            format!("published at {published_at}")
        }
        NoteState::Archived { reason } => {
            format!("archived: {reason}")
        }
    }
}
~~~

The match is exhaustive, and each arm handles only the data that exists for that variant.
