Each octal digit represents a triplet: r=4, w=2, x=1. Add them together for each category (owner, group, others).

---

644 means: owner=6 (r+w), group=4 (r), others=4 (r). So `rw-r--r--`.

---

750 means: owner=7 (r+w+x), group=5 (r+x), others=0 (nothing). So `rwxr-x---`.
