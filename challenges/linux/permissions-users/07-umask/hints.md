Files begin from `0666` and directories from `0777`; the creation mask removes bits from those bases.

---

The desired file is `0640` and the desired directory is `0750`. Compare both with their creation bases.

---

Set the three-digit mask before creating either object, then use one metadata command on both paths.
