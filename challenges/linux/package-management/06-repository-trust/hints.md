Start with a normal metadata refresh. Read the signature and repository messages before changing anything.

---

The vendor source lives under `/etc/apt/sources.list.d`. Preserve its contents by renaming the file instead of deleting it.

---

Refresh once more, then inspect the vendor package's policy. A disabled source should no longer offer a candidate.
