The `sed` substitution syntax is `sed 's/old/new/g' file`. The `g` flag replaces all occurrences on each line.

---

To delete lines matching a pattern, use `sed '/pattern/d' file`. The `^#` pattern matches lines starting with `#`.

---

Use `sed -i 's/old/new/g' file` to edit the file in place. Then `cat file` to verify.
