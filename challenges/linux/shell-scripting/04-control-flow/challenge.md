---
title: "If/Else and For Loops"
sectionSlug: simple-control-flow-ifelse-and-for-loops
order: 4
---

Scripts become useful when they can make decisions and repeat actions. The `if` statement tests conditions with `[[ ]]`, and `for` loops iterate over lists.

You start in `/home/dev`. Your job:

1. **Open vim** with `vim check.sh` and write a script that tests whether `/etc/hostname` exists. If it does, print `host found`. Otherwise, print `host missing`. Use `[[ -f ... ]]` for the test. Save and quit with `:wq`.
2. **Open vim** again with `vim servers.sh` and write a script that uses a `for` loop to iterate over three servers: `web01`, `web02`, `web03`. For each one, print `Checking web01...` (and so on). Save and quit.
3. **Make both scripts executable** with `chmod +x`.

The grader checks that both scripts contain the correct structures and logic.
