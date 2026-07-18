---
title: "Repair the Startup Contract"
sectionSlug: a-practical-startup-design
order: 1
---

The shipping API starts through a shell string, runs from the wrong directory, and cannot accept an alternate script cleanly. Repair the Dockerfile startup contract.

Your job:

1. **Set `/app` as the working directory** and production as the Node environment.
2. **Run as the existing `node` user**.
3. **Use `node` as the exec-form entrypoint**.
4. **Use `src/server.js` as the default exec-form argument** so operators can replace only the script path.

The grader checks the working directory, environment, user, and both exec-form arrays.
