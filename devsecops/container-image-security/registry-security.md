---
title: "Registry Security"
description: "Control who can push images, which references can move, and what registry evidence proves during response."
overview: "A container registry is both a package store and a release boundary. This article explains push access, tag immutability, retention, scanning, audit logs, and incident response evidence."
tags: ["registry", "access", "images"]
order: 5
id: article-devsecops-container-image-security-registry-security
---

## Table of Contents

1. [What a Registry Does](#what-a-registry-does)
2. [Push and Pull Access](#push-and-pull-access)
3. [Tags and Immutability](#tags-and-immutability)
4. [Retention](#retention)
5. [Registry Evidence](#registry-evidence)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## What a Registry Does

A container registry stores image manifests, layers, tags, signatures, SBOMs, and sometimes scan results. It is the place where the build system hands artifacts to deployment.

For the orders service, the registry path is:

```text
build workflow
  -> push image digest
  -> attach tag
  -> attach SBOM and signature
  -> deployment pulls digest
```

The registry is a release boundary because whoever can push or move references can influence what deployment pulls. Registry security is about narrowing that power and keeping evidence when it is used.

## Push and Pull Access

Push access should be narrower than pull access. Many systems may need to pull an image. Very few should be able to push one.

| Actor | Access | Reason |
|-------|--------|--------|
| Release workflow | Push orders image | Trusted build output |
| Production cluster | Pull orders image | Deployment needs to run it |
| Developer laptop | Pull development image | Local debugging |
| Pull request workflow | No push | Untrusted code should not publish |

The release workflow identity should be the normal pusher. A human maintainer may need emergency access, but that path should be visible and rare.

Registry tokens should also be scoped. A token that can push every package in an organization has larger blast radius than a token scoped to one repository or package namespace.

## Tags and Immutability

Tags are names. Digests are content. If a tag is mutable, it can be moved to another digest.

```text
orders-api:prod -> sha256:1111...
orders-api:prod -> sha256:2222...
```

That movement may be normal during release, but it should be controlled and recorded. Some registries support immutable tags, where a tag cannot be changed after it is written. Another pattern is to use release tags that are never reused, such as `2026.05.19.1`, and deploy by digest.

The production deployment should record the digest even when humans use a tag for readability.

```text
Human release: orders-api:2026.05.19.1
Deployment reference: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
```

If an incident asks "what ran?", the digest gives the answer.

## Retention

Retention decides how long old images, tags, SBOMs, signatures, and scan results stay available.

Deleting everything quickly saves storage, but it can harm incident response. If a vulnerability is announced three months later, the team may need the SBOM and digest for an old release.

```text
Registry retention
- production image digests: 18 months
- release SBOMs and signatures: 18 months
- pull request images: 14 days
- untagged failed builds: 7 days
```

Different artifacts need different retention. Pull request images are short-lived. Production releases need enough history for audits, rollback, and incident investigation.

## Registry Evidence

A registry event should say who pushed what and when.

```json
{
  "time": "2026-05-19T10:21:14Z",
  "actor": "orders-api-release-workflow",
  "action": "image.push",
  "image": "ghcr.io/devpolaris/orders-api",
  "digest": "sha256:4e1b9f30...",
  "tag": "2026.05.19.1",
  "source": "github-actions/orders-api-delivery/1842"
}
```

The `actor` tells you which identity pushed. The `digest` identifies content. The `tag` tells you the human release label. The `source` connects the registry event to the workflow.

If a malicious package or image is published, registry evidence lets responders answer which identity pushed it, which tags point to it, whether production pulled it, and which credentials or workflow need rotation.

## Putting It All Together

A registry is not passive storage. It is the handoff between build and deployment. Push access, tag movement, retention, signatures, SBOMs, and audit logs all affect whether the team can trust and explain images.

For `devpolaris-orders-api`, the release workflow pushes images, production pulls digests, tags are controlled, production release evidence is retained, and registry events connect pushes back to workflow runs.

## What's Next

The image is now built, scanned, documented, signed, and stored. The last question in this module is what the container can do after it starts. Runtime hardening narrows that behavior.

---

**References**

- [OCI Image Specification](https://github.com/opencontainers/image-spec) - OCI defines image manifests, layers, tags, and digests used by registries.
- [GitHub Packages container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) - GitHub documents container registry permissions and image publishing.
- [Docker image tags and digests](https://docs.docker.com/reference/cli/docker/image/pull/) - Docker documents pulling by tag or digest.
