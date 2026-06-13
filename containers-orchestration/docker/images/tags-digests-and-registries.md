---
title: "Tags, Digests, and Registries"
description: "Understand Docker image names, mutable tags, immutable digests, registries, authentication, and release workflows that keep deployments reproducible."
overview: "After CI builds an image, a registry stores and distributes it. This article follows the shipping API from local tag to registry push, digest-pinned deployment, registry authentication, and multi-platform image delivery."
tags: ["docker", "registries", "tags", "digests"]
order: 3
id: article-containers-orchestration-docker-tags-digests-and-registries
---

## Table of Contents

1. [A Tag Is a Name That Can Move](#a-tag-is-a-name-that-can-move)
2. [Image Names and Registry Paths](#image-names-and-registry-paths)
3. [What a Registry Stores](#what-a-registry-stores)
4. [Digests Pin Exact Content](#digests-pin-exact-content)
5. [Pushing From CI](#pushing-from-ci)
6. [Pulling Into Production](#pulling-into-production)
7. [Authentication and Permissions](#authentication-and-permissions)
8. [Multi-Platform Images](#multi-platform-images)
9. [A Safe Release Workflow](#a-safe-release-workflow)

## A Tag Is a Name That Can Move
<!-- section-summary: Tags give humans readable image names, and a later push can move a tag to different image content. -->

At the end of the last article, CI built the `shipping-api` image and pushed it to a registry. That moment feels like the finish line because the image exists somewhere other machines can pull it. In real production, the push is only the handoff point. The release still needs a safe name, a safe identity, and a safe pull path.

A **tag** is a readable label attached to an image reference. In `shipping-api:local`, the tag is `local`. In `registry.example.com/platform/shipping-api:2026-06-13.42`, the tag is `2026-06-13.42`. Tags help people talk about images during builds, releases, testing, rollback, and support.

The beginner trap is that a tag can move. A team can push one image as `shipping-api:prod` at noon and push a different image to the same `shipping-api:prod` tag at 3 p.m. The tag name stayed the same, but the content behind it changed.

That moving pointer can create production drift. Imagine three production nodes run `registry.example.com/platform/shipping-api:prod`. One node restarts before the 3 p.m. push and pulls the old image. Two nodes restart after the push and pull the new image. The dashboard still says all three run `:prod`, and the nodes may have different code.

This is why teams use tags for human workflow and digests for exact identity. A tag helps you find "release 42." A digest tells the runtime exactly which image bytes to pull. Before digests make sense, the image name itself needs to be clear.

## Image Names and Registry Paths
<!-- section-summary: A full image reference tells Docker which registry, namespace, repository, and tag or digest to use. -->

An **image reference** is the full name Docker uses to find an image. It can include a registry hostname, a namespace or organization, a repository name, and a tag or digest. Short names are convenient locally. Production workflows should use explicit names.

Here are a few examples:

```markdown
shipping-api:local
docker.io/library/nginx:1.27
registry.example.com/platform/shipping-api:2026-06-13.42
registry.example.com/platform/shipping-api@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30
```

`shipping-api:local` is a short local reference. Docker can store that on your machine. Another host needs a shared registry path to pull it. `docker.io/library/nginx:1.27` points to Docker Hub, the `library` namespace, the `nginx` repository, and the `1.27` tag. `registry.example.com/platform/shipping-api:2026-06-13.42` points to a private registry, an organization or project namespace, a repository, and a release tag.

If no tag appears in a normal image reference, Docker uses `latest` by default. That default surprises beginners because `latest` sounds like a guarantee about freshness. In practice, it is just a tag name that the image publisher controls. It might point to the newest build, or it might point to whatever the publisher last pushed there.

Private registries rely on the hostname to route the push and pull. Docker Hub has default behavior for names such as `nginx`. Private registries need the hostname in the reference:

```bash
docker tag shipping-api:local registry.example.com/platform/shipping-api:2026-06-13.42
docker push registry.example.com/platform/shipping-api:2026-06-13.42
```

This naming scheme gives the team a clear release label. The registry path answers "where does this image live?" The tag answers "which human release label are we talking about?" The digest answers the stronger question: "which exact content should run?"

To understand where the digest comes from, we need to look at what the registry stores.

## What a Registry Stores
<!-- section-summary: Registries store image manifests, configuration objects, and layer blobs instead of one large image file. -->

A **registry** is a service that stores and distributes container images. Docker Hub is Docker's public registry service, and many teams also use private registries from cloud providers, self-hosted Distribution Registry, or internal platform tools. The registry lets builders push images and lets deployment hosts pull images.

A registry stores image data as a set of content-addressed objects. The important pieces are the **image manifest**, the **image configuration**, and the **layer blobs**.

An **image manifest** is a JSON document that lists the config object and the ordered layer blobs for one image. The OCI Image Specification describes a manifest as the object that provides the configuration and layers for a single architecture and operating system image. Docker and other runtimes use this shared OCI format so registries and runtimes can interoperate.

A simplified manifest looks like this:

```json
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "config": {
    "mediaType": "application/vnd.oci.image.config.v1+json",
    "size": 7023,
    "digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111"
  },
  "layers": [
    {
      "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
      "size": 3267104,
      "digest": "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    },
    {
      "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
      "size": 154082,
      "digest": "sha256:3333333333333333333333333333333333333333333333333333333333333333"
    }
  ]
}
```

The config object carries image metadata such as environment defaults, entrypoint, command, user, exposed ports, labels, and root filesystem history. The layer blobs carry the compressed filesystem changes from the image layers. The manifest ties those objects together in the order the runtime needs.

When Docker pulls an image, it asks the registry for the manifest, checks which referenced blobs it already has locally, downloads missing blobs, and assembles the image from those pieces. Shared layers save time and bandwidth because two images can point to the same base layers.

The manifest also gives us the digest that production should care about.

## Digests Pin Exact Content
<!-- section-summary: A digest is the content fingerprint for an image manifest, so pulling by digest selects exact image content even if tags move. -->

A **digest** is a cryptographic content identifier. For Docker image pulls, it usually appears as `sha256:` followed by a long hexadecimal string. When Docker prints a digest after a pull or push, that digest identifies the image content the registry returned.

The practical value is simple. A tag can move to new content. A digest changes when the content changes. If production pulls by digest, every node asks for the same image manifest, even if somebody moves a tag later.

Docker supports digest references directly:

```bash
docker pull ubuntu@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30
```

Docker also supports digests in Dockerfile `FROM` lines:

```dockerfile
FROM node:22-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Pinning a base image by digest gives reproducible builds because the base image reference points to exact content. It also creates an update responsibility. A pinned digest will keep using the same base image until the team updates it, so security update workflows need a scheduled process or automation to refresh the digest after review.

For `shipping-api`, the release team may still publish a human tag such as `2026-06-13.42`. After the push, CI records the digest returned by the registry. The deployment system then uses the digest reference:

```yaml
image: registry.example.com/platform/shipping-api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
```

This closes the production drift problem from the first section. The tag helps humans find the release. The digest gives production a fixed content address.

Now the CI job needs to produce both.

## Pushing From CI
<!-- section-summary: CI should build once, apply useful release tags, push to the registry, and record the resulting digest for deployment and rollback. -->

A **push** uploads image metadata and missing layer blobs to a registry. In a local workflow, you might build an image, tag it, and push it. In CI, those steps should happen in one controlled release job so the team can trace the source commit, build log, image tag, and digest together.

A practical CI build might apply two tags:

```bash
docker buildx build \
  --tag registry.example.com/platform/shipping-api:2026-06-13.42 \
  --tag registry.example.com/platform/shipping-api:git-7f3c2a1 \
  --push \
  .
```

The date-and-build-number tag helps release managers and support teams. The Git SHA tag connects the image to source code. Some teams also publish branch tags for preview environments, such as `pr-1842`. Production releases should keep a stable audit trail.

After pushing, CI should capture the digest. Different tools expose that value in different ways. With Docker commands, you can inspect the pushed image reference:

```bash
docker buildx imagetools inspect registry.example.com/platform/shipping-api:2026-06-13.42
```

The release system stores the digest beside the source commit and deployment record. During rollback, the team can redeploy the previous digest rather than guessing which tag pointed to the old image at the time. This matters during incidents because people need exact artifacts, not memories of moving labels.

Some registries support immutable tag settings. Docker Hub has an immutable tags feature that can prevent overwriting selected tags after push. This helps protect release labels from accidents. Even with immutable tags, digests remain the exact content identity that runtimes can pull.

Once CI has pushed and recorded the digest, production pulls from the registry.

## Pulling Into Production
<!-- section-summary: Production systems should pull explicit image references and prefer recorded digests for rollouts that need exact repeatability. -->

A **pull** downloads the image manifest and any missing blobs from a registry to a Docker host or orchestrator node. Local Docker, Kubernetes nodes, CI runners, and deployment platforms all perform this same basic job: resolve the image reference, authenticate if needed, fetch the manifest, download missing layers, and start containers from the image.

For local testing, pulling a tag is normal:

```bash
docker pull registry.example.com/platform/shipping-api:2026-06-13.42
```

For production, pulling the recorded digest gives stronger repeatability:

```bash
docker pull registry.example.com/platform/shipping-api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
```

In Kubernetes-style deployment YAML, the image field can use the same digest form:

```yaml
containers:
  - name: shipping-api
    image: registry.example.com/platform/shipping-api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
```

This has a direct operational payoff. If one node pulls now and another node pulls in ten minutes, both resolve the same content. If somebody pushes a new image under the old release tag by mistake, the digest-pinned deployment still requests the recorded manifest.

Tags still have a role. Humans use tags to browse registry repositories, read release notes, find test builds, and connect support tickets to CI runs. Deployment controllers can use tags in lower environments where quick iteration matters more than exact rollback evidence. Production systems usually benefit from digest records because they make incident review and rollback concrete.

Production pull behavior also depends on access. A private registry needs to know who is pulling and what repositories they can access.

## Authentication and Permissions
<!-- section-summary: Registry authentication proves who is pushing or pulling, while repository permissions decide which image operations that identity can perform. -->

**Registry authentication** is the sign-in step for image push and pull. The Docker CLI uses `docker login` for many registries. Docker Desktop can store credentials in the native operating system keychain, and Docker can also use credential helpers. Without a credential store, Docker may store auth data in the CLI config file, so production and CI should handle credentials carefully.

For Docker Hub automation, Docker recommends personal access tokens instead of account passwords. A **personal access token** is a scoped credential that a pipeline or tool can use without exposing a human password. Organizations can also use organization access tokens for centrally managed automation.

In CI, a typical login flow uses a secret value from the CI secret store:

```bash
echo "$REGISTRY_TOKEN" | docker login registry.example.com \
  --username "$REGISTRY_USER" \
  --password-stdin
```

The important production habit is scope. A build job that pushes `platform/shipping-api` needs write access to that repository. A production node that pulls the image only needs read access. A preview environment may need access to preview repositories, with broad write access kept away from production images.

Under the registry protocol, a private registry can challenge the client with `401 Unauthorized` and a `WWW-Authenticate` header. The client then asks an authorization service for a bearer token with the needed repository scope, retries the registry request with that token, and the registry checks whether the token allows the operation. The Docker CLI hides most of this exchange. The flow explains why repository scope appears in registry errors.

The practical debugging path follows the same pieces. If a push fails, check the image name, the registry hostname, whether CI logged in to that registry, and whether the token has push permission for that repository. If a production pull fails, check the digest or tag, the image pull secret, and whether the runtime identity has read permission.

Authentication gets the right image to the right hosts. Multi-platform images add one more routing step because the right host may need a different architecture image.

## Multi-Platform Images
<!-- section-summary: Multi-platform images use an index or manifest list so one image name can resolve to architecture-specific manifests. -->

A **multi-platform image** lets one image reference support multiple operating system and CPU combinations. This matters because modern teams often run a mix of `linux/amd64` and `linux/arm64`. Developer laptops, CI runners, and production nodes may not share the same architecture.

The registry handles this with an image index, also called a manifest list in Docker command output. The top-level object points to platform-specific manifests. Each platform-specific manifest points to its own config object and layers.

Docker Buildx can build and push a multi-platform image:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag registry.example.com/platform/shipping-api:2026-06-13.42 \
  --push \
  .
```

After that push, an `amd64` node and an `arm64` node can use the same tag or digest reference. The registry and client negotiate the matching platform manifest. The application team gets one release name, while each node receives the image built for its CPU and operating system.

Both supported platforms still need tests. Native dependencies, compiled packages, and base image differences can behave differently across architectures. A mature pipeline builds both platforms, runs tests for the supported runtime targets, pushes the multi-platform image, and records the digest for the released index.

Now we have all the parts: names, tags, manifests, digests, authentication, and platform selection. The final step is turning them into a release workflow.

## A Safe Release Workflow
<!-- section-summary: A safe image release builds from a clean Dockerfile, pushes traceable tags, records the digest, deploys by digest, and keeps registry access scoped. -->

The `shipping-api` team can now run a release without relying on moving labels as production identity.

First, CI builds the image from the Dockerfile and filtered context. The Dockerfile uses cache-friendly order and multi-stage builds where they help. The build job applies traceable tags such as a release number and Git SHA.

Second, CI pushes the image to the registry. The registry stores the manifest, config object, and layer blobs. If the repository uses immutable tag settings, the release tag receives extra protection from accidental overwrite.

Third, CI records the digest returned by the registry. The release record ties together the Git commit, CI run, tags, digest, scanner results, and deployment ticket. This record gives operations a concrete artifact to deploy or roll back.

Fourth, production deploys the digest reference. The orchestrator pulls exact image content, and every node in the rollout receives the same manifest for its platform. Tags remain useful for humans. The runtime uses the content address.

Fifth, registry credentials stay scoped. CI receives push permission for the repositories it owns. Production receives pull permission. Human access goes through normal registry roles and auditing instead of shared passwords.

This workflow may sound like a lot for a small service. Each piece solves a problem that teams hit as soon as more than one machine pulls an image. Tags help people. Digests pin content. Registries distribute artifacts. Authentication protects repositories. Multi-platform manifests make one release name work across different CPU targets.

That is the Docker image lifecycle from recipe to build output to registry artifact. The next Docker submodules can build on this foundation when containers start running together, sharing networks, mounting storage, and moving into orchestration.

---

**References**

- [What is a registry?](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-registry/) - Defines image registries and explains Docker Hub as Docker's public default registry.
- [Tags on Docker Hub](https://docs.docker.com/docker-hub/repos/manage/hub-images/tags/) - Explains repository tags, tag usage, and the default `latest` tag behavior.
- [docker image tag](https://docs.docker.com/reference/cli/docker/image/tag/) - Documents tagging images and using registry hostnames for private registry references.
- [docker image push](https://docs.docker.com/reference/cli/docker/image/push/) - Documents pushing images to Docker Hub or self-hosted registries.
- [docker image pull](https://docs.docker.com/reference/cli/docker/image/pull/) - Documents pulling by digest, digest output after pull and push, digest usage in `FROM`, and the update responsibility of pinned digests.
- [Immutable tags on Docker Hub](https://docs.docker.com/docker-hub/repos/manage/hub-images/immutable-tags/) - Documents Docker Hub immutable tag settings for preventing tag overwrite.
- [OCI Image Manifest Specification](https://github.com/opencontainers/image-spec/blob/main/manifest.md) - Defines image manifests, config references, layers, schema version, and platform-specific image manifests.
- [docker manifest](https://docs.docker.com/reference/cli/docker/manifest/) - Documents image manifests, manifest lists, OS and architecture metadata, and multi-architecture image references.
- [Registry authentication](https://docs.docker.com/reference/api/registry/auth/) - Explains the Docker Registry v2 bearer-token authentication challenge and retry flow.
- [docker login](https://docs.docker.com/reference/cli/docker/login/) - Documents Docker CLI authentication and credential-store behavior.
- [Docker personal access tokens](https://docs.docker.com/security/access-tokens/) - Documents Docker Hub personal access tokens for automation and development tools.
