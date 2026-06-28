---
title: "Kustomize Bases and Overlays"
description: "Use Kustomize bases and overlays to manage environment-specific Kubernetes manifests without a template language."
overview: "Kustomize starts from valid Kubernetes YAML and layers changes on top. This article builds staging and production overlays for `devpolaris-orders-api` and shows how to diagnose patch mistakes."
tags: ["kustomize", "bases", "overlays", "patches"]
order: 5
id: article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays
---

## Table of Contents

1. [Kustomize Starts From Real YAML](#kustomize-starts-from-real-yaml)
2. [Start With A Tiny Base](#start-with-a-tiny-base)
3. [Add The Shared Service Contract](#add-the-shared-service-contract)
4. [Create Staging And Production Overlays](#create-staging-and-production-overlays)
5. [Use Small Patches For Environment Choices](#use-small-patches-for-environment-choices)
6. [Generate ConfigMaps Deliberately](#generate-configmaps-deliberately)
7. [Render, Diff, And Apply](#render-diff-and-apply)
8. [Common Overlay Mistakes](#common-overlay-mistakes)
9. [Production Overlay Review](#production-overlay-review)
10. [What's Next](#whats-next)

## Kustomize Starts From Real YAML
<!-- section-summary: Kustomize packages Kubernetes manifests by starting with valid YAML and layering environment changes through overlays. -->

One Deployment YAML file is easy to read. Copy the same file into `dev/`, `staging/`, and `prod/`, and the repeated lines start to carry risk. The image tag should differ, the replica count may differ, and the labels, selectors, and ports usually need to stay aligned.

**Kustomize** is a Kubernetes manifest customization tool. It starts from ordinary Kubernetes YAML, then applies additions or patches from a `kustomization.yaml` file. The output is still ordinary YAML that can be inspected before apply time.

For `devpolaris-orders-api`, Kustomize lets the team keep a shared Deployment and Service in a base, then add staging and production choices in overlays.

```
k8s/base
  Deployment/devpolaris-orders-api
  Service/devpolaris-orders-api

k8s/overlays/prod
  image tag: 2026.06.16.1
  replicas: 3
  namespace: devpolaris-prod
```

Staging can choose one replica and a staging hostname. Production can choose three replicas, a production hostname, and larger resource requests. The base keeps the shared Kubernetes shape readable, and each overlay shows the environment choices.

The beginner-friendly difference from Helm is the source format. Helm templates contain placeholders. Kustomize bases contain valid Kubernetes manifests before customization. A teammate can open `deployment.yaml` and read a real Deployment before looking at any overlay.

![Kustomize package shape showing a shared base, staging overlay, production overlay, kustomize build, and rendered YAML](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays/kustomize-package-shape.png)

*The base and overlay shape keeps shared application YAML separate from the environment decisions that production reviewers need to inspect.*

## Start With A Tiny Base
<!-- section-summary: The first base should contain the smallest shared Kubernetes object that every environment needs. -->

A **base** is a directory of shared Kubernetes resources. Every overlay that points at the base starts from those resources. The first base should be small enough to understand in one pass.

Start with a Deployment and a `kustomization.yaml`.

```
k8s/
  base/
    kustomization.yaml
    deployment.yaml
```

The base kustomization lists the resources Kustomize should read.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
```

The first Deployment can stay compact.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-orders-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: devpolaris-orders-api
    spec:
      containers:
        - name: orders-api
          image: ghcr.io/devpolaris/orders-api:2026.06.16-dev
          ports:
            - containerPort: 8080
```

Render the base.

```bash
$ kubectl kustomize k8s/base
```

The output is still a Deployment. No template language is involved, so the first review can focus on Kubernetes object shape.

## Add The Shared Service Contract
<!-- section-summary: The Service belongs in the base when every environment uses the same selector and port contract. -->

A **Service** gives matching Pods a stable network address. In Kustomize, the Service should live in the base when every environment uses the same selector and port mapping. For the orders API, every environment sends Service port `80` to container port `8080`.

Add the Service file.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: devpolaris-orders-api
spec:
  selector:
    app.kubernetes.io/name: devpolaris-orders-api
  ports:
    - port: 80
      targetPort: 8080
```

Add it to the base kustomization.

```yaml
resources:
  - deployment.yaml
  - service.yaml
```

The selector key and value match the Pod template label from the Deployment. That exact match is the traffic contract. If the Service selector drifts from the Pod labels, the Service will have no endpoints and traffic will stop at the Service layer.

Render and check the two connected fields.

```bash
$ kubectl kustomize k8s/base \
  | grep -n "app.kubernetes.io/name: devpolaris-orders-api"
5:    app.kubernetes.io/name: devpolaris-orders-api
13:      app.kubernetes.io/name: devpolaris-orders-api
18:        app.kubernetes.io/name: devpolaris-orders-api
33:    app.kubernetes.io/name: devpolaris-orders-api
```

The repeated label is intentional. The Deployment selector, Pod labels, and Service selector all point at the same app.

## Create Staging And Production Overlays
<!-- section-summary: An overlay points at the base and adds environment-specific choices such as namespace, image tag, replicas, config, and route. -->

An **overlay** is a directory that points at a base and applies environment-specific changes. The overlay owns choices for one environment, such as namespace, image tag, replica count, ConfigMap values, and route host.

Create a staging and production shape.

```
k8s/
  base/
  overlays/
    staging/
      kustomization.yaml
    prod/
      kustomization.yaml
```

A staging overlay can start with namespace and image tag.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: devpolaris-staging
resources:
  - ../../base
images:
  - name: ghcr.io/devpolaris/orders-api
    newTag: 2026.06.16-rc.1
replicas:
  - name: devpolaris-orders-api
    count: 1
```

A production overlay can use the same base with different choices.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: devpolaris-prod
resources:
  - ../../base
images:
  - name: ghcr.io/devpolaris/orders-api
    newTag: 2026.06.16.1
replicas:
  - name: devpolaris-orders-api
    count: 3
```

Render production and check the fields.

```bash
$ kubectl kustomize k8s/overlays/prod \
  | grep -E "namespace:|replicas:|image:"
  namespace: devpolaris-prod
  replicas: 3
          image: ghcr.io/devpolaris/orders-api:2026.06.16.1
```

The base says what the orders API is. The overlay says how production runs it. Reviewers can compare overlays to see which environment decisions differ.

## Use Small Patches For Environment Choices
<!-- section-summary: A patch should change a few named fields for a clear environment reason, not copy the whole resource. -->

A **patch** is a small YAML document that changes part of a resource. In Kustomize, patches are useful when an environment needs a few fields changed beyond images and replicas. A patch should stay small enough that the reviewer can see the intent.

Production might need stronger resource requests. Add a patch file.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
spec:
  template:
    spec:
      containers:
        - name: orders-api
          resources:
            requests:
              cpu: 400m
              memory: 512Mi
            limits:
              memory: 768Mi
```

Reference it from the production overlay.

```yaml
patches:
  - path: deployment-prod-patch.yaml
```

Render and inspect the resource fields.

```bash
$ kubectl kustomize k8s/overlays/prod \
  | grep -n "resources:\\|cpu:\\|memory:"
37:          resources:
39:              cpu: 400m
40:              memory: 512Mi
42:              memory: 768Mi
```

An Ingress patch can add the production hostname. The route is environment-specific, so it belongs in the overlay.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: devpolaris-orders-api
spec:
  rules:
    - host: orders.devpolaris.example
```

![Overlay patch flow showing base YAML, small patches for image tag, replicas, and host, and environment output](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays/overlay-patch-flow.png)

*A useful overlay patch changes a few named fields for a clear environment reason instead of becoming a second hidden copy of the workload.*

## Generate ConfigMaps Deliberately
<!-- section-summary: ConfigMap generators create ConfigMaps from literals or files and can update workload references when content changes. -->

A **ConfigMap generator** creates a ConfigMap from literals, files, or environment files listed in `kustomization.yaml`. It is useful for small non-secret settings that differ by environment.

Production can generate the orders API config.

```yaml
configMapGenerator:
  - name: orders-api-config
    literals:
      - LOG_LEVEL=info
      - CATALOG_URL=http://catalog-api.devpolaris-prod.svc.cluster.local:8080
```

The Deployment should consume the ConfigMap by name.

```yaml
envFrom:
  - configMapRef:
      name: orders-api-config
```

By default, Kustomize adds a content hash suffix to generated ConfigMap names and updates references it recognizes.

```yaml
kind: ConfigMap
metadata:
  name: orders-api-config-7t9h6m4k2d
---
kind: Deployment
spec:
  template:
    spec:
      containers:
        - envFrom:
            - configMapRef:
                name: orders-api-config-7t9h6m4k2d
```

The suffix changes when the config content changes. That helps trigger a rollout through the Deployment reference. The tradeoff is operational search: people should query by labels or inspect rendered output instead of guessing the generated name.

## Render, Diff, And Apply
<!-- section-summary: Kustomize review should render each overlay, compare with live state, and apply the same output path the team reviewed. -->

**Rendering** means building the final YAML from a base and overlay. Kustomize uses `kubectl kustomize` or `kustomize build` for this step. Reviewers should inspect the rendered file before apply time.

```bash
$ kubectl kustomize k8s/overlays/prod > rendered/orders-api-prod.yaml
```

Check the high-risk fields.

```bash
$ grep -n "kind: Deployment\\|replicas:\\|image:\\|host:" rendered/orders-api-prod.yaml
1:kind: Deployment
11:  replicas: 3
35:          image: ghcr.io/devpolaris/orders-api:2026.06.16.1
88:  - host: orders.devpolaris.example
```

Use `kubectl diff` when a cluster connection is available.

```bash
$ kubectl diff -f rendered/orders-api-prod.yaml -n devpolaris-prod
@@
- replicas: 2
+ replicas: 3
@@
- image: ghcr.io/devpolaris/orders-api:2026.06.10.4
+ image: ghcr.io/devpolaris/orders-api:2026.06.16.1
```

Apply through the reviewed overlay or the reviewed artifact, depending on the team's delivery system.

```bash
$ kubectl apply -k k8s/overlays/prod
deployment.apps/devpolaris-orders-api configured
service/devpolaris-orders-api unchanged
configmap/orders-api-config-7t9h6m4k2d created
```

After apply, verify rollout and Service endpoints.

```bash
$ kubectl rollout status deployment/devpolaris-orders-api -n devpolaris-prod
deployment "devpolaris-orders-api" successfully rolled out

$ kubectl get endpoints devpolaris-orders-api -n devpolaris-prod
NAME                    ENDPOINTS                       AGE
devpolaris-orders-api   10.42.1.18:8080,10.42.2.9:8080  3m
```

## Common Overlay Mistakes
<!-- section-summary: Most Kustomize mistakes come from patches that target the wrong object, overlays that copy too much, or selector changes that break traffic. -->

The first common mistake is a patch that targets the wrong object name. Kustomize matches the patch by kind and metadata name. If the base Deployment is named `devpolaris-orders-api` and the patch says `orders-api`, the intended change may not apply.

```yaml
metadata:
  name: orders-api
```

The second common mistake is copying the whole Deployment into the overlay. That turns the overlay into a second base. Reviewers then have to compare two large workloads to understand one environment choice.

The third common mistake is disabling the ConfigMap name hash without a rollout plan. A stable ConfigMap name can make object lookup simpler, but Pods may keep running with old environment data unless the Pod template changes.

The fourth common mistake is changing selector labels casually. Deployment selectors and Service selectors connect traffic to Pods, and some selector fields have immutability rules after creation. A rendered diff that changes selectors deserves a migration plan.

Use rendered output to catch these mistakes before apply time.

```bash
$ kubectl kustomize k8s/overlays/prod \
  | grep -n "selector:\\|matchLabels:\\|app.kubernetes.io/name"
```

That quick check does not replace review, but it points attention at the fields that decide traffic flow.

## Production Overlay Review
<!-- section-summary: A production Kustomize review should connect overlay source, rendered output, live diff, rollout check, and rollback path. -->

A **production overlay review** checks the source diff, rendered output, live diff, rollout command, and rollback path. Kustomize does not store release history the way Helm does, so teams need a Git or artifact-based rollback story.

For the orders API, the reviewer should look at these fields.

| Area | Source to inspect | Rendered output to inspect |
|---|---|---|
| Image | `images.newTag` | Deployment container image |
| Capacity | `replicas.count` and patch resources | Deployment replicas and resources |
| Traffic | base Service and labels | Service selector and Pod labels |
| Config | `configMapGenerator` | Generated ConfigMap name and Deployment reference |
| Route | Ingress or HTTPRoute patch | Hostname, backend Service, TLS Secret |
| Recovery | Git commit or rendered artifact | Previous artifact can be reapplied |

Keep the review note concrete.

```yaml
OverlayReview:
  overlay: k8s/overlays/prod
  renderCommand: kubectl kustomize k8s/overlays/prod > rendered/prod.yaml
  expectedChanges:
    - Deployment image tag moved to 2026.06.16.1
    - replicas stayed 3
    - Ingress host stayed orders.devpolaris.example
  rollback:
    - revert the overlay commit
    - reapply previous rendered artifact from CI
```

A good review also checks what did not change. If an image release changes namespace, selector labels, Service ports, or route class, the pull request needs a clear explanation before apply.

![Overlay review loop showing source diff, build, rendered diff, kubectl diff, and rollout check](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays/overlay-review-loop.png)

*A Kustomize review should connect the overlay source change to rendered YAML, live diff evidence, and the rollout check the team will use after apply.*

## What's Next

You now have the working shape of Kustomize: base, overlay, patches, generators, render, diff, apply, and review. That is enough to package a straightforward internal service like `devpolaris-orders-api` without adding a template language.

The next question is tool choice. Helm and Kustomize both produce Kubernetes YAML, and they fit different ownership, release, reuse, and incident-response workflows. The next article compares those choices through the same orders API release.

---

**References**

- [Declarative Management of Kubernetes Objects Using Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/) - Official Kubernetes guide for Kustomize resources, generators, patches, overlays, and `kubectl apply -k`.
- [kubectl kustomize](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_kustomize/) - Official command reference for building resources from a `kustomization.yaml` directory.
- [kubectl diff](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/) - Official command reference for comparing live resources with would-be applied configuration.
- [Kubernetes API dry run](https://kubernetes.io/docs/reference/using-api/api-concepts/#dry-run) - Official API concept for validation requests that do not persist objects.
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Official concept guide for Services, selectors, and stable access to Pods.
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - Official concept guide for HTTP routing into Services.
