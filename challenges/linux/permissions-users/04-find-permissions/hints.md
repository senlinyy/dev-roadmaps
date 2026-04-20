`find` with `-perm -MODE` matches files where ALL bits in MODE are set. `-002` means the others-write bit.

---

Use `-type f` to restrict results to regular files only.

---

After finding the world-writable file, use `chmod 644` to set it to a safe permission level.
