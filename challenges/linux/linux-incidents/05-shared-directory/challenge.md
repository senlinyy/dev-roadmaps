---
title: "Shared Directory Disaster"
order: 5
---

Alice, Bob, and Dev belong to `team`, but their handoff directory is not behaving like a shared workspace. Existing notes cannot be edited by everyone, and new files get inconsistent access. You start in `/home/dev` as Dev.

Your job:

1. **Inspect the three users' groups**, the directory, the existing file, and this session's creation mask.
2. **Repair `/srv/team`** so its owner remains `root`, its group is `team`, team members have full directory access, others have none, and new files inherit `team`.
3. **Repair `notes.txt`** without changing its content or Alice's ownership. Its owner and group need read/write access; others need none.
4. **Set a session creation mask** that gives new ordinary files owner/group read/write access and no access to others. Create an empty `review.txt` as Dev and inspect the result.

The grader checks existing access, group inheritance, the session mask, and the new file's ownership and mode.
