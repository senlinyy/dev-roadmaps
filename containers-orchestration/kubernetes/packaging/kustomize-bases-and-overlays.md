---
title: "Kustomize Bases and Overlays"
description: "Use Kustomize bases and overlays to manage environment-specific Kubernetes manifests without a template language."
overview: "Kustomize starts from valid Kubernetes YAML and layers changes on top. This article builds staging and production overlays for `devpolaris-orders-api` and shows how to diagnose patch mistakes."
tags: ["kustomize", "bases", "overlays", "patches"]
order: 5
id: article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays
---

## Table of Contents

1. [Why Kustomize Exists](#why-kustomize-exists)
2. [The Package Shape](#the-package-shape)
3. [The Base Directory](#the-base-directory)
4. [Staging and Production Overlays](#staging-and-production-overlays)
5. [Patches for Real Differences](#patches-for-real-differences)
6. [ConfigMap Generators and Rollouts](#configmap-generators-and-rollouts)
7. [Rendering, Diffing, and Applying](#rendering-diffing-and-applying)
8. [Common Patch Mistakes](#common-patch-mistakes)
9. [Overlay Pull Request Review](#overlay-pull-request-review)
10. [What's Next](#whats-next)

## Why Kustomize Exists
<!-- section-summary: Kustomize lets a team keep normal Kubernetes YAML and layer environment changes over it. -->

Kustomize is a configuration tool for Kubernetes manifests. It reads a directory with a `kustomization.yaml` file, collects the resources listed there, and builds a final set of Kubernetes YAML that the API server can receive.

The important idea is that the source files stay close to plain Kubernetes. A Deployment file still reads like a Deployment, a Service file still reads like a Service, and the environment changes live beside those files as overlays, patches, image updates, labels, and generated ConfigMaps.

Our running example is `devpolaris-orders-api`. The team runs the same API in staging and production, and both environments need a Deployment, a Service, a ConfigMap, and sometimes an Ingress or Gateway route. Staging should run one replica with a release-candidate image, while production should run three replicas with tighter resources and the production hostname.

Without a packaging tool, the team might copy the whole Deployment into two folders. That copy makes the first week feel simple, then it creates review pain when one file receives a probe update and the other one stays old. Kustomize gives the team one shared base plus small environment overlays, so reviewers can focus on the differences that matter.

## The Package Shape
<!-- section-summary: A Kustomize package usually has one shared base and one overlay directory per environment. -->

The simplest layout has one `base` directory and one overlay for each environment. The base contains the shared Kubernetes objects, and each overlay references the base through its own `kustomization.yaml`.

For `devpolaris-orders-api`, the repository might use this shape. The names can vary across teams, but the base and overlay split should stay obvious to a new reviewer.

- `k8s/base/kustomization.yaml`
- `k8s/base/deployment.yaml`
- `k8s/base/service.yaml`
- `k8s/overlays/staging/kustomization.yaml`
- `k8s/overlays/prod/kustomization.yaml`
- `k8s/overlays/prod/deployment-prod-patch.yaml`
- `k8s/overlays/prod/ingress-prod-patch.yaml`

A **base** is the reusable starting point. It should describe the application in a way that makes sense before staging or production adds details, so it usually avoids environment names, production-only hosts, and one-off incident changes.

An **overlay** is the environment layer. It points at the base, then adds the pieces that differ: namespace, image tag, replica count, resource requests, ConfigMap values, and external routing. The overlay should read like the environment's choices rather than a second full copy of the application.

That separation matters in production review. If the pull request changes only `k8s/overlays/prod/kustomization.yaml`, the reviewer can ask a narrow question: what exactly does production change on top of the shared app? If the pull request changes the base, the reviewer knows staging and production may both receive the change.

![Kustomize package shape showing a shared base, staging overlay, production overlay, kustomize build, and rendered YAML](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays/kustomize-package-shape.png)

*The base and overlay shape keeps shared application YAML separate from the environment decisions that production reviewers need to inspect.*

## The Base Directory
<!-- section-summary: The base holds the shared Deployment and Service as real Kubernetes objects. -->

The base starts with `kustomization.yaml`. This file lists the resources Kustomize should include and can also attach shared labels that help Kubernetes selectors, dashboards, and GitOps tools identify the app.

Here is a small base for the orders API. The file lists resources first, then applies shared labels in one place so the Deployment and Service do not drift apart.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
labels:
  - pairs:
      app.kubernetes.io/name: devpolaris-orders-api
      app.kubernetes.io/part-of: devpolaris
    includeSelectors: true
```

The Deployment can stay ordinary Kubernetes YAML. A junior engineer who has never used Kustomize can still read the file and understand the workload shape.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-orders-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: devpolaris-orders-api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:dev
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
          envFrom:
            - configMapRef:
                name: orders-api-config
```

The Service stays in the base because every environment needs the same internal port and selector contract. If the Service selector drifts from the Pod labels, traffic will stop reaching the Pods, so the shared base is a good place to keep that relationship visible.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: devpolaris-orders-api
spec:
  ports:
    - name: http
      port: 8080
      targetPort: http
  selector:
    app.kubernetes.io/name: devpolaris-orders-api
```

This base gives us the common app shape. The next question is how staging and production can change it without copying the whole Deployment.

## Staging and Production Overlays
<!-- section-summary: Overlays describe environment choices such as namespace, image tag, replicas, and route host. -->

An overlay references the base and adds environment decisions. Staging usually keeps the blast radius small, so one replica and a release-candidate image make sense for this example.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: devpolaris-staging
resources:
  - ../../base
images:
  - name: ghcr.io/devpolaris/orders-api
    newTag: 2026.05.07-rc.2
replicas:
  - name: devpolaris-orders-api
    count: 1
configMapGenerator:
  - name: orders-api-config
    literals:
      - LOG_LEVEL=debug
      - CATALOG_API_URL=http://catalog-api.devpolaris-staging.svc.cluster.local:8080
```

Production uses the same base, then makes production choices. The image tag changes, the namespace changes, replicas go up, and extra patches can add resources and routing.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: devpolaris-prod
resources:
  - ../../base
images:
  - name: ghcr.io/devpolaris/orders-api
    newTag: 2026.05.07
replicas:
  - name: devpolaris-orders-api
    count: 3
configMapGenerator:
  - name: orders-api-config
    literals:
      - LOG_LEVEL=info
      - CATALOG_API_URL=http://catalog-api.devpolaris-prod.svc.cluster.local:8080
patches:
  - path: deployment-prod-patch.yaml
  - path: ingress-prod-patch.yaml
```

The overlay shows a nice boundary. The base says what the orders API is, while the overlay says how staging or production runs it. That boundary helps reviewers because they can compare the two overlays and see only environment decisions.

Kustomize can also manage optional routing. If the team uses an Ingress controller, the production overlay can add an Ingress. If the platform uses Gateway API, the production overlay can add an HTTPRoute instead. The base should not force a routing object that every environment does not need.

## Patches for Real Differences
<!-- section-summary: Patches should change small, specific fields instead of hiding a second copy of the workload. -->

A **patch** is a small YAML fragment that changes a specific object from the base. It helps when an environment needs fields that the built-in `images`, `replicas`, `namespace`, or label transformations do not cover.

Production usually needs resource requests and limits. Those fields belong near the container, so the production overlay can patch the Deployment rather than copy the whole object.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
spec:
  template:
    spec:
      containers:
        - name: api
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              memory: 512Mi
```

This patch names the target object with `apiVersion`, `kind`, and `metadata.name`. Kustomize uses that identity to find the Deployment from the base, then it changes only the fields in the patch.

A route patch can stay small too. If the base contains a generic Ingress with the service backend, production can patch only the host and TLS secret. If the base does not contain routing at all, production can list a full `ingress.yaml` or `httproute.yaml` as an extra resource in the overlay.

Small patches make review practical. A reviewer should be able to read `deployment-prod-patch.yaml` and explain the production-only change without opening five more files. If a patch rewrites most of the Deployment, the overlay has started to hide a copied manifest behind a nicer name.

![Overlay patch flow showing base YAML, small patches for image tag, replicas, and host, and environment output](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays/overlay-patch-flow.png)

*A useful overlay patch changes a few named fields for a clear environment reason instead of becoming a second hidden copy of the workload.*

## ConfigMap Generators and Rollouts
<!-- section-summary: ConfigMap generators create config objects and can change names when config content changes. -->

A **ConfigMap generator** creates a ConfigMap during the Kustomize build. The generator can read literals or files, and Kustomize can add a content hash to the generated ConfigMap name.

That hash helps with rollouts. Kubernetes does not restart Pods just because the data inside an existing ConfigMap changed, so teams often need a Pod template change to trigger a rollout. A generated name such as `orders-api-config-7t9h6m4k2d` changes when the config content changes, and Kustomize updates references from the Deployment to the generated name.

The orders API Deployment can keep a stable reference in the base. The source YAML stays readable, and Kustomize handles the generated name during rendering.

```yaml
envFrom:
  - configMapRef:
      name: orders-api-config
```

The production overlay can generate the environment config. The values stay near the production overlay instead of hiding inside the shared base.

```yaml
configMapGenerator:
  - name: orders-api-config
    literals:
      - LOG_LEVEL=info
      - CATALOG_API_URL=http://catalog-api.devpolaris-prod.svc.cluster.local:8080
```

The rendered output will contain the generated ConfigMap name and the updated Deployment reference. The exact suffix can differ because Kustomize derives it from content.

```bash
$ kubectl kustomize k8s/overlays/prod | grep -n "orders-api-config"
4:  name: orders-api-config-7t9h6m4k2d
61:          name: orders-api-config-7t9h6m4k2d
```

This feature is useful, and it also changes how people search for objects. The team should query by labels instead of guessing the generated name, because the generated suffix can change on a normal config update.

## Rendering, Diffing, and Applying
<!-- section-summary: Kustomize work should move through render, inspect, diff, apply, and rollout verification. -->

Rendering means building the final YAML from the base and overlay. Kustomize integrates with `kubectl`, so the team can render the production overlay with `kubectl kustomize`.

```bash
$ kubectl kustomize k8s/overlays/prod > rendered/prod.yaml
$ grep -n "namespace:\\|replicas:\\|image:" rendered/prod.yaml
6:  namespace: devpolaris-prod
28:  replicas: 3
52:          image: ghcr.io/devpolaris/orders-api:2026.05.07
```

The rendered file answers the production questions before anything touches the cluster. The reviewer can see the namespace, image tag, replica count, ConfigMap name, Service selector, and route host in the same output Kubernetes will receive.

When the team has cluster access, `kubectl diff` compares the desired output with the live objects. The official `kubectl diff` command shows the live version against the would-be applied version, which makes it a good pre-apply review step.

```bash
$ kubectl diff -k k8s/overlays/prod
diff -u -N /tmp/LIVE/apps.v1.Deployment.devpolaris-prod.devpolaris-orders-api /tmp/MERGED/apps.v1.Deployment.devpolaris-prod.devpolaris-orders-api
@@
-  replicas: 2
+  replicas: 3
```

Applying sends the kustomized resources to the API server. The command uses the same overlay directory that the team rendered and reviewed.

```bash
$ kubectl apply -k k8s/overlays/prod
deployment.apps/devpolaris-orders-api configured
service/devpolaris-orders-api unchanged
configmap/orders-api-config-7t9h6m4k2d created
```

After apply, Kubernetes rollout checks still matter. Kustomize only builds and sends YAML, while the Deployment controller handles Pod replacement, readiness, and rollout status.

```bash
$ kubectl rollout status deployment/devpolaris-orders-api -n devpolaris-prod
deployment "devpolaris-orders-api" successfully rolled out
```

CI can do a lighter version of the same workflow. It can render every overlay, store the rendered YAML as an artifact, and run `kubectl apply --dry-run=server` against a validation cluster when that cluster is available. Server-side dry run asks the API server to validate and admit the request without persisting the objects.

## Common Patch Mistakes
<!-- section-summary: Most Kustomize mistakes show up as a target mismatch, an image mismatch, an array merge surprise, or an unsafe selector change. -->

The first common mistake is a patch that targets the wrong object name. If the production patch says `metadata.name: orders-api` while the base Deployment is named `devpolaris-orders-api`, Kustomize cannot find a unique target.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 3
```

The build can fail with a target error. That message tells the reviewer to compare the patch identity with the base object identity.

```bash
$ kubectl kustomize k8s/overlays/prod
Error: no matches for Id Deployment.v1.apps/orders-api.[noNs];
failed to find unique target for patch Deployment.v1.apps/orders-api.[noNs]
```

The practical diagnosis compares the base object identity with the patch identity. The names, API version, and kind should match the object the patch intends to change.

```bash
$ grep -n "apiVersion:\\|kind:\\|name:" k8s/base/deployment.yaml k8s/overlays/prod/deployment-prod-patch.yaml
k8s/base/deployment.yaml:1:apiVersion: apps/v1
k8s/base/deployment.yaml:2:kind: Deployment
k8s/base/deployment.yaml:4:  name: devpolaris-orders-api
k8s/overlays/prod/deployment-prod-patch.yaml:1:apiVersion: apps/v1
k8s/overlays/prod/deployment-prod-patch.yaml:2:kind: Deployment
k8s/overlays/prod/deployment-prod-patch.yaml:4:  name: orders-api
```

The second common mistake is an image name that does not match the base. Kustomize matches the image field by name, so an overlay entry for `orders-api` will not update `ghcr.io/devpolaris/orders-api`.

```yaml
images:
  - name: orders-api
    newTag: 2026.05.07
```

The rendered Deployment will expose the problem. The source overlay changed, but the image that reaches Kubernetes stayed on the old tag.

```bash
$ kubectl kustomize k8s/overlays/prod | grep -n "image:"
52:          image: ghcr.io/devpolaris/orders-api:dev
```

The third common mistake involves container lists. Kubernetes strategic merge patches use the container `name` field to merge container entries. If a patch says `name: orders` while the base container is `name: api`, the patch may add a second container or fail to affect the intended one, depending on the patch type and target.

The fourth common mistake is changing selector labels casually. Deployment selectors and Service selectors connect traffic to Pods, and some selector fields have immutability rules after creation. A rendered diff that changes selectors deserves careful review because it can break routing or force object replacement.

## Overlay Pull Request Review
<!-- section-summary: A good overlay review connects source changes to rendered output and then to live-cluster difference. -->

A production overlay pull request should include evidence, not only source YAML. The reviewer needs the overlay change, the rendered output, and the cluster diff when a cluster comparison is possible.

For an orders API release, the pull request description can include the exact commands and the important fields. That gives reviewers a short path from source change to rendered production behavior.

```bash
$ kubectl kustomize k8s/overlays/prod > rendered/prod.yaml
$ grep -n "kind: Deployment\\|replicas:\\|image:\\|orders.devpolaris.example" rendered/prod.yaml
18:kind: Deployment
28:  replicas: 3
52:          image: ghcr.io/devpolaris/orders-api:2026.05.07
91:  - host: orders.devpolaris.example
```

The reviewer then checks the fields that carry production risk. The image tag should match the release, replicas should match the capacity plan, the Service selector should still match Pod labels, ConfigMap references should point at generated names, and route hosts should point at the expected environment.

A good review also checks what did not change. If a simple image release changes namespace, selector labels, Service ports, or the Ingress class, the pull request needs more explanation before apply. The rendered diff gives the team a shared object to discuss instead of asking everyone to mentally combine the base and overlay.

The final review step is the rollout plan. The pull request should name the apply command, the rollout status command, and the rollback path. With Kustomize, rollback often means reverting the Git commit or applying the previous rendered artifact through the delivery system, so the team should know where that previous artifact lives.

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
