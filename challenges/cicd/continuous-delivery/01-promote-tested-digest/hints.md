Compare the build records and deployment digests, not just the source digest. Then inspect production in the staging-failure case.

---

One dependency between the current jobs cannot make two builds produce the same object. Separate producing the candidate from promoting it.

---

Publish one validated package, retrieve it for staging, and pass the same artifact to production only after staging deploys and verifies it. Check identity and ordering together.
