---
title: "Repair and Validate"
sectionSlug: how-do-you-edit-production-configuration-without-skipping-validation
order: 8
---

A saved Nginx candidate points at backend port 8081, but its syntax is broken. The simulated running service still uses the previously valid port-8080 configuration. You start in `/home/dev`.

Your job:

1. **Back up `/etc/nginx/nginx.conf` to `/etc/nginx/nginx.conf.bak`**, preserving the candidate before editing.
2. **Run Nginx's configuration test and inspect the failure** before opening the file in Vim.
3. **Repair only the syntax error in Vim**, preserving port 8081 and all other directives, then save and quit.
4. **Test the saved config again and reload Nginx only after success**, then inspect the service status.

This is a bounded Nginx simulation, not a running server. It supports configuration testing and service reload/status for this file; its training guard refuses reload until the current saved content passes a test. The grader checks the backup, failed test, Vim repair, and that the tested version was reloaded.
