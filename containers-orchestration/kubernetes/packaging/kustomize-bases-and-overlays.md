---
title: "Kustomize Bases and Overlays"
description: "Use Kustomize bases and overlays to manage environment-specific Kubernetes manifests without a template language."
overview: "Kustomize starts from valid Kubernetes YAML and layers changes on top. This article builds staging and production overlays for `devpolaris-orders-api` and shows how to diagnose patch mistakes."
tags: ["kustomize", "bases", "overlays", "patches"]
order: 5
id: article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays
---

## Table of Contents

1. [Changing YAML Without Templates](#changing-yaml-without-templates)
2. [The Base Directory](#the-base-directory)
3. [The First Overlay](#the-first-overlay)
4. [Patching Specific Fields](#patching-specific-fields)
5. [ConfigMap Generators and Name Updates](#configmap-generators-and-name-updates)
6. [Rendering and Applying an Overlay](#rendering-and-applying-an-overlay)
7. [Failure Mode: A Patch Targets the Wrong Object](#failure-mode-a-patch-targets-the-wrong-object)
8. [When Overlays Start to Hurt](#when-overlays-start-to-hurt)
9. [Reviewing an Overlay Pull Request](#reviewing-an-overlay-pull-request)
10. [Organizing Overlays as Environments Grow](#organizing-overlays-as-environments-grow)

## Changing YAML Without Templates

Kustomize is a Kubernetes configuration tool that builds final manifests from directories containing a `kustomization.yaml` file. Its main idea is simple: start with valid Kubernetes YAML, then apply named customizations such as patches, image changes, labels, namespaces, and generated ConfigMaps.

This exists for teams that like plain manifests but dislike copying them for every environment. Instead of writing template placeholders, you keep a base that can be read as normal Kubernetes YAML and add overlays for staging, production, or preview environments.

For `devpolaris-orders-api`, the base contains the Deployment and Service. The staging overlay changes the namespace and replica count. The production overlay changes the namespace, replica count, image tag, and ingress host.

## The Base Directory

A base is a reusable directory of ordinary Kubernetes YAML plus a `kustomization.yaml` file. Other kustomizations can reference it, and it should not know who is reusing it.

Example: the orders API base can define the shared Deployment and Service once, while staging and production overlays decide namespace, replicas, and image tag.

```text
k8s/
  base/
    kustomization.yaml
    deployment.yaml
    service.yaml
  overlays/
    staging/
      kustomization.yaml
    prod/
      kustomization.yaml
```

The base `kustomization.yaml` lists resources:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
commonLabels:
  app.kubernetes.io/name: devpolaris-orders-api
```

The Deployment is ordinary Kubernetes YAML:

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
            - containerPort: 8080
```

Because the base is valid YAML, a beginner can inspect it without learning a template language first.

## The First Overlay

An overlay is a kustomization that references a base and adds environment-specific changes. It exists so staging and production can share the same workload shape without copying the whole Deployment.

Example: staging can set a namespace, reduce replicas to one, and use a staging image tag.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: devpolaris-staging
resources:
  - ../../base
replicas:
  - name: devpolaris-orders-api
    count: 1
images:
  - name: ghcr.io/devpolaris/orders-api
    newTag: 2026.05.07-rc.2
```

Render the overlay:

```bash
$ kubectl kustomize k8s/overlays/staging | grep -n "namespace:\\|replicas:\\|image:"
5:  namespace: devpolaris-staging
24:  replicas: 1
48:          image: ghcr.io/devpolaris/orders-api:2026.05.07-rc.2
```

The source files remain readable, and the rendered output shows the final Kubernetes object.

## Patching Specific Fields

A Kustomize patch is a small YAML fragment that changes selected fields on a target object. Use it when a built-in customization is not enough.

Example: production can add stronger resource requests to the orders API Deployment without duplicating the whole Deployment.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: devpolaris-prod
resources:
  - ../../base
replicas:
  - name: devpolaris-orders-api
    count: 3
patches:
  - path: resources-patch.yaml
```

The patch targets the Deployment and changes only the container resources.

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

Keep patches small. A patch that rewrites most of the Deployment is a copied manifest with extra steps.

## ConfigMap Generators and Name Updates

A ConfigMap generator creates ConfigMap objects from literals or files during rendering. The generated name often includes a hash so Pods roll when the config changes.

Example: if `LOG_LEVEL` changes in the generator, Kustomize can render a new ConfigMap name and update the Deployment reference, which changes the Pod template.

```yaml
configMapGenerator:
  - name: orders-api-config
    literals:
      - LOG_LEVEL=info
      - CATALOG_API_URL=http://catalog-api.devpolaris-prod.svc.cluster.local:8080
```

If the Deployment references `orders-api-config`, Kustomize updates the reference to the generated name.

```yaml
envFrom:
  - configMapRef:
      name: orders-api-config
```

Rendered output might look like this:

```bash
$ kubectl kustomize k8s/overlays/prod | grep -n "name: orders-api-config"
4:  name: orders-api-config-6t7b8g7h5k
57:          name: orders-api-config-6t7b8g7h5k
```

That hash is useful because a changed ConfigMap name changes the Pod template, which triggers a rollout. The tradeoff is that object names become less predictable, so labels and selectors matter for queries.

## Rendering and Applying an Overlay

Rendering an overlay means building the final YAML from the base plus overlay changes. Kustomize is built into `kubectl`, so you can render or apply a directory with `-k`.

Example: `kubectl kustomize k8s/overlays/prod` prints the production orders API manifests, while `kubectl apply -k k8s/overlays/prod` sends them to the API server.

```bash
$ kubectl kustomize k8s/overlays/prod > rendered/prod.yaml
$ kubectl diff -f rendered/prod.yaml
$ kubectl apply -k k8s/overlays/prod
deployment.apps/devpolaris-orders-api configured
service/devpolaris-orders-api unchanged
configmap/orders-api-config-6t7b8g7h5k created
```

Use `kubectl diff` before `apply` when you have cluster access. It shows the difference between the rendered output and the live objects. That protects you from applying an overlay that changes more than you intended.

After apply, check the rollout:

```bash
$ kubectl rollout status deployment/devpolaris-orders-api -n devpolaris-prod
deployment "devpolaris-orders-api" successfully rolled out
```

Kustomize builds YAML. Kubernetes still owns rollout behavior.

## Failure Mode: A Patch Targets the Wrong Object

A patch target is the Kubernetes object identity the patch is supposed to change. Kustomize matches that target by fields such as `kind`, `metadata.name`, API group, version, and sometimes namespace. Suppose a patch uses the wrong Deployment name. Kustomize cannot find a target.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 3
```

The build fails:

```bash
$ kubectl kustomize k8s/overlays/prod
Error: no matches for Id Deployment.v1.apps/orders-api.[noNs];
failed to find unique target for patch Deployment.v1.apps/orders-api.[noNs]
```

The diagnostic path is to list resource names in the base, then compare them with the patch metadata.

```bash
$ grep -n "kind:\\|name:" k8s/base/deployment.yaml k8s/overlays/prod/replica-patch.yaml
k8s/base/deployment.yaml:2:kind: Deployment
k8s/base/deployment.yaml:4:  name: devpolaris-orders-api
k8s/overlays/prod/replica-patch.yaml:2:kind: Deployment
k8s/overlays/prod/replica-patch.yaml:4:  name: orders-api
```

Fix the patch target name, render again, and inspect the final replica count. Do not apply until the rendered object proves the patch landed.

## When Overlays Start to Hurt

Kustomize works best when the base is understandable and overlays are small. It starts to hurt when every environment has many patches that rewrite the same object in different ways. At that point, readers must mentally apply several patches before they know what will run.

For `devpolaris-orders-api`, Kustomize is a good fit if the app has a few environment differences. If the team needs lots of optional resources, repeated conditional behavior, or a reusable package for many services, Helm may be a better fit.

The tradeoff is directness versus flexibility. Kustomize keeps the source close to Kubernetes YAML. Helm gives you a stronger packaging model and release lifecycle. Neither choice removes the need to render, diff, and inspect the final manifest.

## Reviewing an Overlay Pull Request

An overlay review should connect the source patch to the final rendered object. If the patch changes production replicas, the rendered Deployment should prove the final count. If the patch changes a ConfigMap literal, the rendered ConfigMap and Deployment reference should both be checked.

```diff
 replicas:
   - name: devpolaris-orders-api
-    count: 2
+    count: 3
```

The rendered check is simple:

```bash
$ kubectl kustomize k8s/overlays/prod \
  | grep -n "kind: Deployment\\|replicas:\\|image:"
18:kind: Deployment
26:  replicas: 3
49:          image: ghcr.io/devpolaris/orders-api:2026.05.07
```

Then compare with the live cluster:

```bash
$ kubectl diff -k k8s/overlays/prod
diff -u -N /tmp/LIVE/apps.v1.Deployment.devpolaris-prod.devpolaris-orders-api /tmp/MERGED/apps.v1.Deployment.devpolaris-prod.devpolaris-orders-api
@@
-  replicas: 2
+  replicas: 3
```

That diff should match the pull request description. If the diff includes namespace changes, selector changes, or unexpected object deletion, diagnose before applying.

## Organizing Overlays as Environments Grow

The common starting layout is `base`, `overlays/staging`, and `overlays/prod`. That is enough for many teams. As environments grow, avoid creating deep overlay chains that only one person understands.

```text
k8s/
  base/
  overlays/
    dev/
    staging/
    prod/
    preview/
```

If preview environments need unique hostnames and image tags, keep that logic in the delivery system or generate a small overlay for each preview. Do not make production depend on preview-specific patches.

For `devpolaris-orders-api`, production should stay boring. It should reference the base, set the production namespace, set production replicas, set the production image tag, and patch production resources. If production needs many special patches, revisit the base design. The base might be missing a shared behavior that all environments now need.

---

**References**

- [Declarative Management of Kubernetes Objects Using Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/) - Official Kubernetes task guide for bases, overlays, generators, and applying with `-k`.
- [kubectl kustomize](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_kustomize/) - Official command reference for rendering Kustomize directories through `kubectl`.
- [Kustomize Official Site](https://kustomize.io/) - Official project documentation and examples for Kustomize concepts.
- [kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/) - Official command reference for applying rendered or kustomized resources.
