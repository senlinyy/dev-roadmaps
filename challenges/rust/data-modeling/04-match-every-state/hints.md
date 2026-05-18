Matching &note.state borrows the enum instead of moving it out of the note.
---
For variants with data, bind the field name in the pattern.
---
Each arm should produce a String. Use String::from for the draft arm and format! for the data-carrying arms.
