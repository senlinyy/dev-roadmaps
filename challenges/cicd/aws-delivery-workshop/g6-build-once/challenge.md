---
title: "Publish one tested image and capture its immutable identity"
sectionSlug: publish-one-tested-image-and-capture-its-immutable-identity
order: 6
revision: 1
---

## Description

The Orders release workflow tests one local image, then performs a second build and pushes `orders:latest`. Neither the mutable tag nor the test results prove which bytes were actually published.

As the release engineer, establish a single candidate image and carry its immutable identity into the release outputs.

## Requirements

1. **Single Build**. Build the candidate once and give it a unique release tag instead of relying on `latest`.
2. **Pre-Publish Verification**. Smoke-test that local image and block its publication if verification fails.
3. **Registry Identity**. Push the tested image, resolve its registry digest, and expose a `repository@sha256` image reference to dependent jobs.
4. **Release Receipt**. Write `release.json` with the immutable image reference and source/run identity so later stages can trace the published bytes.

:::expand[Workspace and verification]{kind="note"}

Editable files: `.github/workflows/release.yml`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
