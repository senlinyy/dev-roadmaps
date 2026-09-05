---
title: "Control a Shell Job"
sectionSlug: how-do-terminals-jobs-sessions-and-ssh-affect-lifetime
order: 6
---

Practise job control with a harmless 300-second sleep job. Its job number belongs to this shell; its PID identifies the simulated process.

You start in `/home/dev`. Your job:

1. Start the sleep in the background, then list jobs with their PIDs.
2. Bring it into the foreground and suspend it with `Ctrl+Z` or the Suspend button.
3. Resume it in the background, then bring it into the foreground again.
4. Interrupt it with `Ctrl+C` or the Interrupt button and verify that its PID no longer appears.

The grader checks process evidence and final state, not copied output. This terminal uses simulated processes; no host processes are affected.

