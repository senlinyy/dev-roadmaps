---
title: "Read a Unit File"
sectionSlug: anatomy-of-a-unit-file
order: 1
---

Systemd unit files define how services start, stop, and behave. Before you can manage a service, you need to read and understand its unit file. Two services are installed on this system: a Node.js app and nginx.

You start in `/home/dev`. Your job:

1. **Read the myapp unit file** at `/etc/systemd/system/myapp.service` to see its full configuration.
2. **Find the command** that starts the myapp service by grepping for `ExecStart`.
3. **Find which user** the service runs as by grepping for `User=`.
4. **Find the restart policy** set for myapp by grepping for `Restart=`.
5. **Compare with nginx** by reading `/etc/systemd/system/nginx.service` and finding its service type.

The grader requires you to use `cat` and `grep`, and checks that your combined output contains the ExecStart path, the service user, the restart policy, and the nginx service type.
