---
title: "Mount Node Logs Safely"
sectionSlug: add-the-agent-container-and-node-mounts
order: 2
---

The DaemonSet reaches application nodes, but its Pod template has no node-local agent contract. Build the container, bounded resources, host volume, and read-only mount without broadening host access.

Your job:

1. **Build container `agent`** from image `ghcr.io/customer-notification/log-agent:2026.06.14`.
2. **Build its resource contract** with requests of `100m` CPU and `128Mi` memory, plus limits of `500m` CPU and `512Mi` memory.
3. **Build volume `varlogcontainers`** from host path `/var/log/containers` with type `Directory`.
4. **Build the mount relationship** by mounting `varlogcontainers` at `/var/log/containers` with `readOnly: true`.

The grader checks every exact image, resource, host path, volume, mount path, and read-only literal in the parsed DaemonSet.
