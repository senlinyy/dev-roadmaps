---
title: "Run a Step Inside a Docker Container"
sectionSlug: containers-and-services
order: 2
---

Your security team maintains a vulnerability scanner that only runs on Alpine Linux. Instead of installing Alpine-specific tools on the Ubuntu runner, you want to execute a single step inside a Docker container.

Your task:

1. **Add a step** that runs inside a Docker container image instead of directly on the runner.
2. **Run the approved `docker://alpine:3.20` image** rather than an unpinned image.
3. **Use `/bin/sh` as entrypoint** with args `-c "echo 'Scanning...'"` so the review shows the exact command executed in the container.

The grader checks that one step in the scan job uses the approved image and command together.
