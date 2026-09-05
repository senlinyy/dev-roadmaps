---
title: "The ACL Changes the Answer"
sectionSlug: when-do-acls-and-special-bits-extend-basic-permissions
order: 9
revision: 1
---

Alice has a named ACL entry on a finance report. The long listing shows an ACL marker, but the named entry alone does not reveal the effective access because the ACL mask can remove permissions.

You are logged in as Alice. Your job:

1. **Inspect the long listing** and notice that extended permissions are present.
2. **Read the complete ACL**, including the named user entry and mask.
3. **Test read and write separately** to prove the effective result.

Do not modify the report. The grader checks that Alice can read but cannot write, and that you inspected the ACL rather than guessing from mode bits.
