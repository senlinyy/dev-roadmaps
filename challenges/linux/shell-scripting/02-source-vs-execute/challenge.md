---
title: "Prove Sourcing Is Not Executing"
sectionSlug: what-actually-runs-a-shell-script
order: 2
---

The release shell currently has `DEPLOY_ENV=staging`. The file `/home/dev/release/env.sh` selects production, but the team is unclear about when that value reaches the current shell.

You start in `/home/dev/release`. Your job:

1. **Set the current shell to staging**, then run `env.sh` as a child Bash process.
2. **Print the current value** to prove the child did not replace its parent's value.
3. **Load the same file into the current shell**, then print the value again to prove the change persists.

The grader checks both execution styles and the two observed environment values.
