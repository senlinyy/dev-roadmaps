---
title: "Understand Dependencies"
sectionSlug: dependencies-ordering-and-targets
order: 3
---

Systemd uses `Requires`, `Wants`, and `After` directives to express relationships between services. Understanding these tells you what must be running before a service can start, and what happens when a dependency fails.

You start in `/home/dev`. Your job:

1. **Read the webapp unit file** at `/etc/systemd/system/webapp.service` to see its dependency configuration.
2. **Find the hard dependency** by grepping for `Requires=` in the webapp unit file.
3. **Find the soft dependency** by grepping for `Wants=` in the webapp unit file.
4. **Check the boot order** by grepping for `After=` across all unit files with `grep -r After /etc/systemd/system/`.
5. **Identify which dependency is critical**: the `Requires` target will bring webapp down if it fails.

The grader requires you to use `cat` and `grep`, and checks that your output contains the hard and soft dependency names, the network target, and the `Requires` directive.
