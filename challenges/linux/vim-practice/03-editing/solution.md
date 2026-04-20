Editing commands work from Normal mode:

- `dd` deletes the current line
- `yy` copies (yanks) the current line. `3yy` copies 3 lines
- `p` pastes below the cursor, `P` pastes above
- `u` undoes the last change, `Ctrl+r` redoes
- `.` repeats the last editing command

Navigate to line 2 (`:2`) and press `dd` to delete the TODO comment. Move to the `get_config` function (`:9`) and press `3yy` to copy 3 lines, then `G` and `p` to paste at the bottom.
