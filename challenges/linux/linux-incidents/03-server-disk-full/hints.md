Compare filesystem-wide allocation with files that still have names. Check inodes separately before removing a large visible file.

---

A deleted file can still consume space while its writer holds it open. Release that descriptor through the approved service restart and measure again.
