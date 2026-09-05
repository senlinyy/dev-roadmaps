Changing the directory's group fixes the current object, but it does not by itself control the group of future children.

---

The setgid special bit on a directory makes new children inherit that directory's group.

---

Combine setgid with owner and group `rwx`, no access for others, then create a file without overriding its group manually.
