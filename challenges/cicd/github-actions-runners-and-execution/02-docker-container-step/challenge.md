---
title: "Run a Step Inside a Docker Container"
sectionSlug: execution-environments-shell-vs-container
order: 2
---

Your security team maintains a vulnerability scanner that only runs on Alpine Linux. Instead of installing Alpine-specific tools on the Ubuntu runner, you want to execute a single step inside a Docker container.

Your task:

1. **Add a step** that runs inside a Docker container image instead of directly on the runner.
2. **Use the `uses` key** with a Docker image reference for the container.
3. **Configure the step** so it runs a basic command inside the container.

The grader checks that one of the steps references a Docker container image.
