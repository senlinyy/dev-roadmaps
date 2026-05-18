~~~rust
pub fn first_match(notes: &[Note], query: &str) -> Option<&Note> {
    for note in notes {
        if note.title.contains(query) {
            return Some(note);
        }
    }

    None
}
~~~

The return type makes the two normal outcomes explicit: a borrowed matching note, or no match.
