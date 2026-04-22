The ANSWER SECTION line for each file starts with the queried name. Grepping for `api.example.com` against each file in turn surfaces just the row you care about. Then grep `SERVER:` to capture the resolver footer.

---

The big number after the name in the ANSWER row is the TTL. The fresh response shows `60` (newly cached); the stale response shows `2418` (already counting down from the original `3600`).
