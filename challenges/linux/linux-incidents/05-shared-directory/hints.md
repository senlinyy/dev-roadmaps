Group membership, directory inheritance, existing file permissions, and the creation mask solve different parts of this incident.

---

The setgid bit belongs on the directory. It does not retroactively repair existing files. The creation mask must also preserve group write access.
