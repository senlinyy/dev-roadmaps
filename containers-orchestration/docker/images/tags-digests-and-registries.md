---
title: "Tags, Digests, and Registries"
description: "Understand Docker image names, mutable tags, immutable digests, registries, authentication, and release workflows that keep deployments reproducible."
overview: "After CI builds an image, a registry stores and distributes it. This article follows the shipping API from local tag to registry push, digest-pinned deployment, registry authentication, and multi-platform image delivery."
tags: ["docker", "registries", "tags", "digests"]
order: 3
id: article-containers-orchestration-docker-tags-digests-and-registries
---

## Table of Contents

1. [The Release Handoff After CI](#the-release-handoff-after-ci)
2. [Image References](#image-references)
3. [Tags and Moving Names](#tags-and-moving-names)
4. [What a Registry Stores](#what-a-registry-stores)
5. [Digests and Exact Content](#digests-and-exact-content)
6. [Push From CI and Capture the Digest](#push-from-ci-and-capture-the-digest)
7. [Pull and Pin in Production](#pull-and-pin-in-production)
8. [Authentication and Permissions](#authentication-and-permissions)
9. [Multi-Platform Images and Indexes](#multi-platform-images-and-indexes)
10. [Production Debugging](#production-debugging)
11. [A Safe Release Workflow](#a-safe-release-workflow)

## The Release Handoff After CI
<!-- section-summary: CI has built the shipping-api image, and the next job is giving that image a stable place, a clear name, and an exact identity for production. -->

At this point in the `shipping-api` story, CI has already built the container image from the Dockerfile. The tests passed, the image exists on the build worker, and now the team needs a way for staging and production machines to download the same thing CI just created.

That shared place is a **registry**. A registry is a server for storing and distributing container images. Docker Hub is a public registry service, and many teams also use private registries owned by their company or cloud platform. The key idea is simple: CI **pushes** an image to the registry, and runtime machines **pull** that image from the registry.

The tricky part is the naming. A release needs a human-friendly label so people can talk about it, and it also needs an exact content identity so production can run the same bytes every time. The label is usually a **tag**. The exact identity is a **digest**. Both appear in image references, so we will start by unpacking the full image name.

## Image References
<!-- section-summary: An image reference tells Docker which registry, namespace, repository, and tag or digest the team means. -->

An **image reference** is the full name Docker uses to find an image. It can include a registry host, an optional port, a namespace, a repository, and then either a tag or a digest. Docker documents the common tag-shaped reference as `HOST[:PORT]/NAMESPACE/REPOSITORY[:TAG]`.

For `shipping-api`, a production-ready reference might look like this. The registry host is fake and the SHA is shortened here, so focus on the shape of the name.

```bash
registry.example.com/platform/shipping-api:sha-91f3c4a
```

Here is what each part means. These names are the vocabulary you will see in Docker commands, registry dashboards, CI output, and deployment manifests.

| Part | Example | Meaning |
|---|---|---|
| **Host** | `registry.example.com` | The registry server Docker contacts for push and pull operations. |
| **Namespace** | `platform` | The organization, team, project, or account area inside the registry. |
| **Repository** | `shipping-api` | The image repository that holds versions of one application image. |
| **Tag** | `sha-91f3c4a` | A readable label attached to one image version or variant. |

Short names hide some defaults. `alpine` means Docker Hub, the `library` namespace, the `alpine` repository, and the `latest` tag. That shortcut works nicely while learning, but production teams usually write the full registry host and repository path so every machine talks to the intended registry.

CI often starts with a local name and then gives the same image a registry name. The local name exists only on the builder, and the registry name is the address other machines can pull.

```bash
docker tag shipping-api:ci registry.example.com/platform/shipping-api:sha-91f3c4a
docker push registry.example.com/platform/shipping-api:sha-91f3c4a
```

The first command creates another local reference for the same image. The second command uploads the image data and the tag mapping to the registry. Now another host can pull `registry.example.com/platform/shipping-api:sha-91f3c4a` without having the build worker's local image cache.

That gives the team a readable release name. Now we need to talk about why readable names need help in production.

## Tags and Moving Names
<!-- section-summary: Tags help humans name image versions, and registries can move the same tag to new content after another push. -->

A **tag** is a human-readable label inside an image repository. Teams use tags for commit SHAs, build numbers, semantic versions, environment labels, and test channels. For `shipping-api`, useful tags might be `sha-91f3c4a`, `build-1842`, `1.8.0`, `staging`, and `prod`.

The important behavior is that a registry maps a repository plus tag to image content. A later push can attach the same tag to different content. Docker's own digest documentation describes tags as names that can be reused or changed, while digests identify exact content.

Imagine the team uses this image in production. This kind of environment tag is common because it is easy for humans to remember.

```bash
registry.example.com/platform/shipping-api:prod
```

At 10:00, `:prod` points to the image built from commit `91f3c4a`. At 14:00, a release job pushes commit `a8d12fb` with the same `:prod` tag. The dashboard still shows `shipping-api:prod`, yet a node that pulled before 14:00 may have the first image and a node that pulled after 14:00 may have the second image.

This is the classic tag drift problem. Tags are great for conversations, release pages, and registry browsing. A digest gives the runtime a stronger instruction because it names the exact content, not just the current place a label points.

Before digests click, it helps to see what content the registry actually stores. The next section explains the objects that carry those digests.

## What a Registry Stores
<!-- section-summary: Registries store OCI image objects: manifests, configuration JSON, and reusable layer blobs. -->

A **registry** stores container image objects using content addresses. The registry stores a graph of smaller pieces, and each important object has a digest that names its content. The three pieces you will see most often are the **manifest**, the **configuration object**, and the **layer blobs**.

An **image manifest** is a JSON document that lists the config object and the ordered layers for one runnable image. The OCI Image Specification describes an image manifest as the object that provides configuration and layers for one image for a specific operating system and CPU architecture.

An **image configuration** is JSON metadata for the image. It includes details like environment variables, the command, labels, exposed ports, working directory, and the root filesystem layer history. This config is part of the image identity because changing those settings changes what the runtime starts.

A **layer blob** is compressed filesystem content. Every `RUN`, `COPY`, or `ADD` instruction in a Dockerfile can contribute to image layers. Registries store layers by digest, so two images can share the same base layer without uploading or downloading that layer twice.

A simplified OCI-style manifest for `shipping-api` would look like this. The digest values are shortened so the structure stays readable.

```json
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "config": {
    "mediaType": "application/vnd.oci.image.config.v1+json",
    "digest": "sha256:7c2a4d5b6e8f...",
    "size": 4821
  },
  "layers": [
    {
      "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
      "digest": "sha256:18a12f8d4b31...",
      "size": 31842011
    },
    {
      "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
      "digest": "sha256:9ab44c7190d2...",
      "size": 1249817
    }
  ]
}
```

The OCI format matters because Docker, registries, and container runtimes need a shared language. Docker popularized image workflows, and OCI standardized the image format so different builders, registries, scanners, and runtimes can exchange the same image objects.

![Container registry object map infographic showing an image manifest pointing to image config and layer blobs, sha256 digests, Docker pull, local layer reuse, and downloading only missing layers](/content-assets/articles/article-containers-orchestration-docker-tags-digests-and-registries/registry-object-map.png)

_This infographic shows the registry as a set of content-addressed objects, where a pull starts from the manifest and downloads only the layer blobs the local client does not already have._

Now the digest has a place to live. A digest can identify a layer blob, a config object, a single-platform manifest, or a multi-platform image index. For release work, the digest we usually care about is the manifest or index digest that the deployment will pull.

## Digests and Exact Content
<!-- section-summary: A digest is a cryptographic content ID, so pulling by digest selects exact image content from the digest reference. -->

A **digest** is a cryptographic identifier for content. In Docker image references, it usually appears as a SHA-256 value such as `sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30`. The digest changes whenever the content behind it changes.

A digest-based image reference uses `@` before the digest. That punctuation tells Docker that the last part is a content address.

```bash
registry.example.com/platform/shipping-api@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30
```

That `@sha256:...` part tells Docker to pull the content identified by that digest. The registry can still have friendly tags like `1.8.0` or `prod`, and the deployment can still pin the exact digest that CI published.

Here is the practical difference. The same repository can have human labels and exact content addresses at the same time.

| Reference | What it gives the team |
|---|---|
| `registry.example.com/platform/shipping-api:1.8.0` | A readable release label that people can search, discuss, and promote. |
| `registry.example.com/platform/shipping-api:prod` | A movable environment label that can point to the current production release. |
| `registry.example.com/platform/shipping-api@sha256:...` | An exact content address that pulls the same image bytes each time. |

![Tag versus digest release infographic showing a movable tag attached to image labels, a digest pinned to exact content, and production nodes all pulling the same digest](/content-assets/articles/article-containers-orchestration-docker-tags-digests-and-registries/tag-vs-digest-release.png)

_This infographic makes the release difference visible: tags help people name a build, while the digest gives production an exact content address every node can pull._

Docker prints a digest after a pull finishes, and Docker also prints a digest after pushing to a registry. Buildx can write the digest to a metadata file, which gives CI a clean way to pass the exact image reference into deployment.

Now we can wire this into the `shipping-api` release pipeline. The CI job is where the exact digest first enters the release record.

## Push From CI and Capture the Digest
<!-- section-summary: CI should push the image once, capture the registry digest, and hand that digest to deployment as a release artifact. -->

A **push** uploads image content from a builder to a registry. During a push, Docker uploads any missing layer blobs and config objects, uploads the manifest or index, and attaches the requested tags to that manifest or index. The registry then has enough information for other machines to pull the image.

For `shipping-api`, the CI job should build from one commit, tag the image with stable labels, push it, and capture the digest from the build result. This example uses `docker buildx build` because Buildx supports direct registry pushes, metadata files, and multi-platform builds.

```yaml
name: publish-shipping-api

on:
  push:
    branches:
      - main

jobs:
  image:
    runs-on: ubuntu-latest
    env:
      IMAGE: registry.example.com/platform/shipping-api
    steps:
      - uses: actions/checkout@v4

      - name: Login to registry
        env:
          REGISTRY_USER: ${{ secrets.REGISTRY_USER }}
          REGISTRY_TOKEN: ${{ secrets.REGISTRY_TOKEN }}
        run: |
          echo "${REGISTRY_TOKEN}" | docker login registry.example.com --username "${REGISTRY_USER}" --password-stdin

      - name: Build, push, and capture digest
        id: build
        run: |
          mkdir -p build
          docker buildx create --use

          VERSION_TAG="sha-${GITHUB_SHA}"
          RUN_TAG="ci-${GITHUB_RUN_NUMBER}"

          docker buildx build \
            --platform linux/amd64,linux/arm64 \
            --tag "${IMAGE}:${VERSION_TAG}" \
            --tag "${IMAGE}:${RUN_TAG}" \
            --push \
            --metadata-file build/image-metadata.json \
            .

          DIGEST="$(jq -r '.["containerimage.digest"]' build/image-metadata.json)"
          IMAGE_REF="${IMAGE}@${DIGEST}"

          printf 'image_ref=%s\n' "${IMAGE_REF}" >> "${GITHUB_OUTPUT}"
          printf 'IMAGE_REF=%s\n' "${IMAGE_REF}" | tee build/release-image.env
```

The metadata file is doing real release work here. Buildx writes keys such as `containerimage.digest`, and the CI job turns that value into a deployable reference like `registry.example.com/platform/shipping-api@sha256:...`. The tag remains useful for browsing the registry, and deployment automation receives the digest as the trusted value.

In a real team, the pipeline would store `build/image-metadata.json` and `build/release-image.env` as release artifacts. The release record should also include the Git SHA, build number, registry repository, tags, digest, platforms, and the person or automation that approved the deployment.

Now production can pull the exact image that CI pushed. The deployment should receive this reference from the release artifact so every environment uses the same release input.

## Pull and Pin in Production
<!-- section-summary: Production deployments should use the digest from CI so every node asks the registry for the same image content. -->

A **pull** downloads image content from a registry to a local image store. Docker resolves the reference, downloads missing config and layer blobs, verifies content by digest, and makes the image available to run. Docker supports pull references shaped as `NAME[:TAG]` and `NAME@DIGEST`.

For a direct Docker pull, the production host would use the digest reference from CI. This works well for a single host, a smoke test, or a small service before an orchestrator is involved.

```bash
docker pull registry.example.com/platform/shipping-api@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30
docker run --rm registry.example.com/platform/shipping-api@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30
```

For Docker Compose, the same digest can live in the service image field. Compose will pass that exact reference to the Docker engine when the service starts.

```yaml
services:
  shipping-api:
    image: registry.example.com/platform/shipping-api@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30
    ports:
      - "8080:8080"
```

For Kubernetes, the deployment can pin the image field to the digest. The pod template then records the same image identity for every replica in the rollout.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shipping-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shipping-api
  template:
    metadata:
      labels:
        app: shipping-api
    spec:
      containers:
        - name: shipping-api
          image: registry.example.com/platform/shipping-api@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30
          ports:
            - containerPort: 8080
```

Digest pinning gives production a precise release input. If the team rebuilds `shipping-api:prod` later, this deployment still asks for the digest it already recorded. Security patches and base image updates still matter, and the team handles them by rebuilding, producing a new digest, testing that digest, and updating the deployment to the new digest.

The pull path also needs permission. A perfect image reference still fails when the registry denies access.

## Authentication and Permissions
<!-- section-summary: Registry authentication proves who is pushing or pulling, and permissions should separate CI push access from production pull access. -->

**Registry authentication** proves the client identity to the registry. Docker CLI uses `docker login [SERVER]` to authenticate to a public or private registry. The server is the registry host, such as `registry.example.com`, and the login applies to that host rather than one image path.

For automation, the safer pattern is to pass the token through standard input. This keeps the secret out of command arguments and matches Docker's documented automation pattern.

```bash
echo "${REGISTRY_TOKEN}" | docker login registry.example.com --username "${REGISTRY_USER}" --password-stdin
```

Docker documents credential stores and credential helpers because local credentials need careful storage. Docker Hub also supports personal access tokens, which Docker describes as a secure alternative to passwords for Docker CLI authentication and automation.

Behind the registry API, authentication often follows the Distribution token flow. The client tries to push or pull, the registry returns a `401 Unauthorized` response with a `WWW-Authenticate` challenge, the client asks an authorization service for a bearer token, and then the client retries with that token. The challenge includes a scope such as `repository:platform/shipping-api:pull,push`, which tells the authorization service what access the client is requesting.

For `shipping-api`, the access plan should be narrow. The exact role names depend on the registry, but the split between push access and pull access should stay clear.

| Actor | Registry access | Why |
|---|---|---|
| CI publish job | `pull,push` on `platform/shipping-api` | CI needs to read base cache layers and publish new releases. |
| Production runtime | `pull` on `platform/shipping-api` | Production only needs to download approved images. |
| Developer laptops | `pull` on normal app images, limited `push` in development repositories | Local testing should avoid broad write access to production image paths. |
| Release administrators | Tag deletion or repository admin permissions only through reviewed operations | Deleting tags and changing repository settings can break rollback and audit trails. |

This separation matters during incidents. If a CI token leaks, the blast radius should stay inside one image repository and its push scope. If a production pull token leaks, the token should allow downloading the approved repository and nothing more.

Now there is one more release detail: the same tag can represent more than one CPU architecture. This matters as soon as laptops, CI runners, and production nodes use different CPUs.

## Multi-Platform Images and Indexes
<!-- section-summary: Multi-platform images use an image index that points to separate manifests for each operating system and CPU architecture. -->

A **platform** is the operating system and CPU architecture a container image targets. `linux/amd64` covers most x86 Linux servers. `linux/arm64` covers many ARM servers and Apple Silicon development machines. A container image may need separate layers for each platform because compiled binaries differ across CPU architectures.

An **image index** is a higher-level OCI object that points to multiple platform-specific image manifests. The OCI Image Specification says the index contains a list of manifests for specific platforms. Docker also calls this kind of object a manifest list in many CLI outputs and docs.

Buildx can create one multi-platform image reference from several platform builds. This is the workflow that produced the digest captured earlier.

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag registry.example.com/platform/shipping-api:sha-91f3c4a \
  --push \
  --metadata-file build/image-metadata.json \
  .
```

The tag `registry.example.com/platform/shipping-api:sha-91f3c4a` can then point to an image index. When an amd64 node pulls that reference, the runtime selects the amd64 child manifest. When an arm64 node pulls that same reference, the runtime selects the arm64 child manifest.

You can inspect the index and its child manifests with these commands. The output shows the top-level digest and the platform entries, so the team can verify what was pushed.

```bash
docker buildx imagetools inspect registry.example.com/platform/shipping-api:sha-91f3c4a
docker buildx imagetools inspect registry.example.com/platform/shipping-api@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30
```

For mixed architecture fleets, the deployment usually pins the **index digest**. That keeps one release reference while still letting each node choose its matching platform image. For a single-platform fleet, a team may pin the child manifest digest for that platform when they want an even narrower release record.

Platform bugs often show up as "works on my machine" image problems. A developer on Apple Silicon may build `linux/arm64`, while production expects `linux/amd64`. The release pipeline should build the platforms production needs and record the digest for the pushed index.

Now we can turn these pieces into a debugging routine. The same names and digests form the checklist during a failed rollout.

## Production Debugging
<!-- section-summary: Image debugging should compare the requested reference, the registry digest, the CI release record, and the digest actually running on each node. -->

When `shipping-api` has a strange production rollout, image identity is one of the first things to check. The goal is to compare four facts: what deployment requested, what the registry tag points to now, what CI published, and what each node actually runs.

Start with the release artifact from CI. This tells you what CI believed it published before you look at any hosts.

```bash
cat build/release-image.env
cat build/image-metadata.json | jq '.["containerimage.digest"], .["containerimage.descriptor"].mediaType'
```

Then inspect the registry. The tag view answers what a human label points to right now, and the digest view answers what the recorded release contains.

```bash
docker buildx imagetools inspect registry.example.com/platform/shipping-api:sha-91f3c4a
docker buildx imagetools inspect registry.example.com/platform/shipping-api@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30
```

On a Docker host, pull the exact reference and inspect the local image digest list. This proves the digest can still be resolved from the registry and stored locally.

```bash
docker pull registry.example.com/platform/shipping-api@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30
docker image inspect registry.example.com/platform/shipping-api@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30 --format '{{json .RepoDigests}}'
```

In Kubernetes, the deployment image field shows the requested image, and the pod status shows the image ID the node actually used. This is useful when replicas disagree or a rollout seems to have mixed versions.

```bash
kubectl get deployment shipping-api -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
kubectl get pod -l app=shipping-api -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.containerStatuses[0].imageID}{"\n"}{end}'
```

If the pull fails with `unauthorized` or `denied`, focus on the registry host, login state, and token scope. A pull-only production token should have access to `platform/shipping-api` and the `pull` action. A push job needs `push` too, and the auth challenge often reveals the repository path and action the registry checked.

If the error mentions platform or architecture, inspect the image index and compare it to the node platform. That check catches the case where CI pushed only `linux/arm64` while production needs `linux/amd64`.

```bash
docker buildx imagetools inspect registry.example.com/platform/shipping-api:sha-91f3c4a
docker pull --platform linux/amd64 registry.example.com/platform/shipping-api@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30
```

These checks keep the investigation concrete. The team can say which digest CI published, which digest production requested, which digest the registry served, and which digest the runtime started.

## A Safe Release Workflow
<!-- section-summary: A safe image release builds once, records the digest, deploys by digest, verifies the running digest, and rolls back by restoring the previous digest. -->

The full `shipping-api` workflow should make tags useful for humans and digests authoritative for machines. The same image moves through build, registry, staging, and production without rebuilding between environments.

A practical workflow looks like this. Each step leaves behind data that helps release review, debugging, and rollback.

1. CI builds the image from one Git commit.
2. CI applies immutable tags such as `sha-91f3c4a`, `build-1842`, and maybe `1.8.0`.
3. CI pushes the image to `registry.example.com/platform/shipping-api`.
4. CI captures `containerimage.digest` from Buildx metadata.
5. Tests, scans, and staging deploy the digest reference.
6. The release record stores the image repository, tags, digest, platforms, Git SHA, build number, and approval.
7. Production deploys `registry.example.com/platform/shipping-api@sha256:...`.
8. Verification compares running pod or host image IDs against the release digest.
9. Rollback restores the previous digest from the release record.

Here is the rollback shape in a Kubernetes deployment. The previous digest should come from the release record so the rollback uses a reviewed value.

```bash
PREVIOUS_IMAGE_REF="registry.example.com/platform/shipping-api@sha256:1b7f4c8d9e0a111122223333444455556666777788889999aaaabbbbccccdddd"

kubectl set image deployment/shipping-api shipping-api="${PREVIOUS_IMAGE_REF}"
kubectl rollout status deployment/shipping-api
kubectl get pod -l app=shipping-api -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.containerStatuses[0].imageID}{"\n"}{end}'
```

Environment tags such as `staging` and `prod` can still exist as convenience labels. The release record and deployment manifest should carry the digest, because that is the value that survives tag movement, node restarts, and future pushes.

That closes the Docker Images module. The important through-line is simple: a Dockerfile describes how to build the image, layers explain why builds are reusable, and the registry reference plus digest explains exactly what production should run.

![Safe image release summary infographic showing CI build once, push tags, record digest, deploy digest, verify nodes, rollback digest, and separate CI push and production pull permissions](/content-assets/articles/article-containers-orchestration-docker-tags-digests-and-registries/safe-image-release-summary.png)

_This final summary image turns the registry workflow into a release loop: build once, publish traceable tags, record the digest, deploy by digest, verify the running nodes, and roll back by restoring the previous digest._

---

**References**

- [Docker CLI: docker image tag](https://docs.docker.com/reference/cli/docker/image/tag/) - Documents the image reference shape, registry host, namespace, repository, tag, and default `latest` behavior.
- [Docker Hub: Tags on Docker Hub](https://docs.docker.com/docker-hub/repos/manage/hub-images/tags/) - Explains how tags organize image versions in a repository and how Docker Hub shows tag digests.
- [Docker CLI: docker image pull](https://docs.docker.com/reference/cli/docker/image/pull/) - Documents pulling by tag or digest, default tag behavior, layer reuse, and digest-pinned pulls.
- [Docker: Image digests](https://docs.docker.com/dhi/core-concepts/digests/) - Defines Docker image digests as SHA-256 content identifiers and explains why digest pulls keep image content consistent.
- [Docker CLI: docker login](https://docs.docker.com/reference/cli/docker/login/) - Documents registry authentication, credential storage, credential helpers, and CLI login behavior.
- [Docker: Personal access tokens](https://docs.docker.com/security/access-tokens/) - Describes Docker Hub PATs for CLI authentication, automation, CI/CD, permissions, and token handling.
- [Docker CLI: docker buildx build](https://docs.docker.com/reference/cli/docker/buildx/build/) - Documents `--push`, `--metadata-file`, `containerimage.digest`, and multi-platform `--platform` builds.
- [Open Container Initiative: Image Specification](https://github.com/opencontainers/image-spec) - Defines OCI image manifests, configs, layers, descriptors, and image indexes for multi-platform images.
- [CNCF Distribution: Token Authentication Specification](https://distribution.github.io/distribution/spec/auth/token/) - Documents the Registry v2 bearer token flow, auth challenges, and repository scopes such as `pull` and `push`.
