---
title: "Render Nginx Template"
sectionSlug: "rendered-files-with-template"
order: 1
---

The role currently copies a static Nginx file, but production needs the config rendered from inventory values and checked before replacement. Convert the task to a validated template flow.

Your job:

1. **Render the Nginx template** from `nginx.conf.j2` to `/etc/nginx/nginx.conf`.
2. **Keep the managed file mode** at `0644` and validate the candidate config before it lands.
3. **Use the server name and API port variables** inside the template.

The grader checks the role task and template files, not command output.
