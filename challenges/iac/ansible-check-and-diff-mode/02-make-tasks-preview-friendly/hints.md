1. Diff belongs on the file-changing template task.
2. Gate an operation that cannot safely simulate itself with `not ansible_check_mode`.
3. A verification command observes state, so it should never report changed.
