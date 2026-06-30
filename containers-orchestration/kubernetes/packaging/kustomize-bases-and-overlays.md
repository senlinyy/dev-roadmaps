---
title: "Kustomize Bases and Overlays"
description: "Use Kustomize bases and overlays to manage environment-specific Kubernetes manifests without a template language."
overview: "Kustomize starts from valid Kubernetes YAML and layers environment changes on top. A small `devpolaris-orders-api` base grows through production overlays, focused patches, rendered output, and common review checks."
tags: ["kustomize", "bases", "overlays", "patches"]
order: 5
id: article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays
---
## Table of Contents

1. [A Shared Base](#a-shared-base)
2. [Add A Base Kustomization](#add-a-base-kustomization)
3. [Add A Production Overlay](#add-a-production-overlay)
4. [Add One Small Patch](#add-one-small-patch)
5. [Render The Overlay](#render-the-overlay)
6. [Add Config And Route Changes](#add-config-and-route-changes)
7. [Avoid Common Overlay Mistakes](#avoid-common-overlay-mistakes)
8. [Review A Production Overlay](#review-a-production-overlay)
9. [What's Next](#whats-next)
10. [References](#references)

## A Shared Base
<!-- section-summary: Kustomize starts from valid Kubernetes YAML, so the base should be readable before overlays exist. -->

**Kustomize** is a Kubernetes packaging tool that starts with valid YAML and layers environment changes on top. Copying one Deployment into `dev`, another into `staging`, and another into `prod` creates a quiet problem: the files look similar, but nobody can quickly prove which differences are intentional. A label change in one folder, a Service port change in another folder, or a forgotten readiness probe can turn into a production release mistake.

Kustomize solves that problem while keeping the source files close to normal Kubernetes YAML. Instead of writing template placeholders, the team keeps a shared **base** with ordinary manifests, then adds **overlays** that describe environment differences. This is a good fit for teams that want reviewers to read Kubernetes objects directly and then inspect the final rendered YAML before applying it.

The running example is `devpolaris-orders-api`. The shared app shape is simple: a Deployment runs the API container, and a Service gives other Pods a stable name for it. Development can run one replica with a development image tag. Production can use the same base, then choose the production namespace, approved image tag, replica count, resource requests, and route settings.

A **base** is the shared directory of Kubernetes resources. The smallest useful Deployment slice makes the structure visible before the full Pod template appears:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 1
```

Important points in this first slice:

- `kind: Deployment` says Kubernetes should manage a set of Pods for this app.
- `metadata.name: orders-api` gives every overlay the same object name to target.
- `replicas: 1` is a safe shared default for a learning base. Production can override it later.
- This file is already valid Kubernetes YAML. Kustomize keeps it template-free.

A real Deployment also needs a selector and a Pod template. Add the container image and port next:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: orders-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: orders-api
    spec:
      containers:
        - name: orders-api
          image: ghcr.io/devpolaris/orders-api:2026.06.16-dev
          ports:
            - name: http
              containerPort: 8080
```

Important points in the full base Deployment:

- `selector.matchLabels` and `template.metadata.labels` use the same label. That link tells the Deployment which Pods belong to it.
- `image` uses a development tag here because the base is the shared starting point. The production overlay will replace only the tag.
- `ports[].name: http` gives the container port a stable name. The Service can target `http` instead of repeating `8080`.
- The base describes the app's shared shape. Environment choices belong in overlays.

That is the first Kustomize habit. Keep the base readable as plain Kubernetes. Put shared object shape there. Leave environment choices for overlays.

## Add A Base Kustomization
<!-- section-summary: kustomization.yaml lists the base resources that Kustomize should build together. -->

After the base has a Deployment and Service, Kustomize needs one file that says which resources belong to the base. That file is called `kustomization.yaml`. Think of it as the table of contents for a Kustomize directory. It tells Kustomize, "build these Kubernetes files together as one package."

This file is important for beginners because Kustomize works from directories. A directory can hold several resources, and the `kustomization.yaml` file turns that directory into a buildable unit. With this file in place, the reader sees a base package instead of loose manifests.

For `devpolaris-orders-api`, the base folder can have three files:

```markdown
k8s/base/
  deployment.yaml
  service.yaml
  kustomization.yaml
```

Important points in this folder shape:

- `deployment.yaml` holds the shared workload shape.
- `service.yaml` holds the stable internal network name.
- `kustomization.yaml` tells Kustomize to build those files together.
- The folder name `base` is a convention for humans. It helps people understand the package layout.

The base `kustomization.yaml` lists the raw resources:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
```

Important points in this file:

- `apiVersion` and `kind` describe a Kustomize configuration file.
- `resources` lists the Kubernetes manifests Kustomize should include.
- The paths are relative to this `kustomization.yaml` file.
- The base can grow later with ConfigMaps, Ingress, HTTPRoutes, or other shared resources.

Add a Service to the base so other workloads have a stable address for the API:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api
spec:
  selector:
    app.kubernetes.io/name: orders-api
  ports:
    - port: 80
      targetPort: http
```

Important points in the Service:

- `metadata.name: orders-api` gives callers a stable Service name.
- `selector` matches the Pod label from the Deployment template.
- `port: 80` is the port callers use through the Service.
- `targetPort: http` points to the named container port from the Deployment.

Now build the base:

```bash
kubectl kustomize k8s/base
```

Important points in this command:

- `kubectl kustomize` renders a Kustomize directory without applying anything.
- `k8s/base` points at the base directory.
- Kustomize reads `k8s/base/kustomization.yaml`, loads the listed resources, and prints the combined YAML.
- At this stage, the output should look very close to the source files because the base has not applied environment changes yet.

![Kustomize package shape showing a shared base, staging overlay, production overlay, kustomize build, and rendered YAML](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays/kustomize-package-shape.png)

*A Kustomize base keeps shared valid YAML together, while overlays apply environment changes.*

## Add A Production Overlay
<!-- section-summary: An overlay points at the base and records environment-specific changes such as namespace, image tag, and replica count. -->

The base now describes the shared app. That is useful, but production still needs choices that development should not carry. Production usually has a production namespace, an approved image tag, more replicas, stronger resource settings, and sometimes a real hostname. Copying the whole base into a production folder would bring back the copy-paste problem.

Kustomize handles that with an **overlay**. An overlay is an environment directory that points back to the base, then records only the differences for that environment. The beginner idea is simple: the base says "this is the app", and the overlay says "this is how this environment runs the app."

For `devpolaris-orders-api`, production starts as its own folder:

```markdown
k8s/overlays/prod/
  kustomization.yaml
```

Important points in this folder:

- `overlays/prod` tells humans this folder is for production.
- The overlay has its own `kustomization.yaml` because it is a buildable directory too.
- The overlay will reference `../../base` instead of copying the base files.
- More production-only files can be added beside this file later.

The production overlay can set namespace, image tag, and replica count:

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
  - name: orders-api
    count: 3
```

Important points in the overlay:

- `namespace: devpolaris-prod` adds the production namespace to namespaced resources.
- `resources: ../../base` imports the shared Deployment and Service.
- `images[].name` matches the image repository used in the base Deployment.
- `images[].newTag` replaces only the tag, so the repository stays the same.
- `replicas[].name: orders-api` targets the Deployment by name.
- `count: 3` changes the desired production replica count.

Render and check the production fields:

```bash
kubectl kustomize k8s/overlays/prod \
  | grep -E "namespace:|replicas:|image:"
```

Example output:

```bash
  namespace: devpolaris-prod
  replicas: 3
          image: ghcr.io/devpolaris/orders-api:2026.06.16.1
```

Important points in this output:

- The namespace proves the production overlay is active.
- The replica count proves production changed the base default from one Pod to three.
- The image tag proves the release is using the approved production build.
- This output is only a quick check. A real review should inspect the full rendered YAML too.

The base says what the orders API is. The overlay says how production runs it. The rendered output shows the final Kubernetes objects the API server will receive.

## Add One Small Patch
<!-- section-summary: A patch should change a few fields for one clear environment reason. -->

The production overlay already changed simple fields: namespace, image tag, and replica count. Some environment differences need more structure. Resource requests are a good example. Production may reserve more CPU and memory than development, and those fields live inside the Deployment's container block.

A **patch** changes part of an existing resource. In Kustomize, a patch should have a clear reason and a small target. For beginners, the safest first habit is to make one patch for one environment concern. A production resource patch should adjust resource settings, not secretly rewrite labels, ports, probes, and image tags at the same time.

Create a patch file for production resource settings:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
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

Important points in this patch:

- `kind: Deployment` and `metadata.name: orders-api` identify the resource to patch.
- The path under `spec.template.spec.containers` reaches the API container.
- `requests.cpu` and `requests.memory` tell the scheduler what capacity the Pod needs.
- `limits.memory` gives the container a memory boundary.
- The patch avoids selectors and Service ports because those are not part of the resource-sizing decision.

Reference the patch from the production overlay:

```yaml
patches:
  - path: deployment-prod-resources.yaml
```

Important points in this overlay entry:

- `patches` tells Kustomize to apply one or more patch files.
- `path` points to the patch file relative to the production overlay.
- The patch file itself carries the target kind and name.
- Reviewers should open the patch and the rendered output together with the overlay line.

Render and inspect the resource fields:

```bash
kubectl kustomize k8s/overlays/prod \
  | grep -n "resources:\\|cpu:\\|memory:"
```

Example output:

```bash
37:          resources:
39:              cpu: 400m
40:              memory: 512Mi
42:              memory: 768Mi
```

Important points in this output:

- The line numbers help reviewers jump to the resource block in the rendered YAML.
- The CPU and memory request values came from the production patch.
- The memory limit also came from the patch.
- If the rendered output shows resource changes in the wrong container, the patch target is wrong.

![Overlay patch flow showing base YAML, small patches for image tag, replicas, and host, and environment output](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays/overlay-patch-flow.png)

*A focused patch changes a few fields for one environment reason, then rendered output shows the final workload.*

## Render The Overlay
<!-- section-summary: Rendering creates the final YAML that reviewers can diff, validate, and apply. -->

At this point, the source files are split across base, overlay, and patch. That layout is readable for humans, but Kubernetes will only receive normal manifests. **Rendering** is the step that builds the final YAML from those pieces. This is the review moment where a beginner can stop thinking about Kustomize folders and read plain Kubernetes objects again.

Rendered YAML matters because source diffs can hide the final result. An overlay line such as `resources: ../../base` only points to the source directory. An image transformer only names the image replacement rule. Rendering answers the concrete question: "What YAML will Kubernetes receive for this production release?"

Save the rendered output so the pull request has evidence:

```bash
kubectl kustomize k8s/overlays/prod > rendered/orders-api-prod.yaml
```

Important points in this command:

- `kubectl kustomize` builds the production overlay.
- `k8s/overlays/prod` is the directory with the production `kustomization.yaml`.
- `>` saves the rendered YAML as a review artifact.
- The saved file should be attached to CI output or made visible in the pull request.

Compare the rendered file with the live cluster:

```bash
kubectl diff -f rendered/orders-api-prod.yaml
```

Important points in this command:

- `kubectl diff` shows what Kubernetes would change if the rendered file were applied.
- `-f rendered/orders-api-prod.yaml` points at the proposed output.
- Reviewers should pay close attention to names, namespaces, labels, selectors, Service ports, route hosts, images, replicas, and resource requests.

Example diff:

```diff
 metadata:
+  namespace: devpolaris-prod
 spec:
-  replicas: 1
+  replicas: 3
```

Important points in this diff:

- The namespace line confirms that the production overlay placed the object in `devpolaris-prod`.
- The replica line confirms that the overlay changed the base default from one Pod to three.
- Any selector or Service port diff should pause the review because those fields control traffic.
- The diff is only as useful as the rendered file. Always render the overlay being released.

Validate before apply:

```bash
kubectl apply --dry-run=server -f rendered/orders-api-prod.yaml
```

Important points in this command:

- `kubectl apply` uses the normal apply path for the rendered objects.
- `--dry-run=server` asks the Kubernetes API server to validate the objects without saving them.
- The check can catch API compatibility problems and admission-policy problems before the real apply.

Example output:

```bash
deployment.apps/orders-api serverside-applied (server dry run)
service/orders-api serverside-applied (server dry run)
```

Important points in this output:

- `server dry run` means the API server accepted the request for validation only.
- The Deployment and Service names show which objects were checked.
- This output proves the API server accepted the object shape. Rollout checks prove whether the app turns healthy afterward.
- Rollout checks still need to run after a real apply.

Apply after approval:

```bash
kubectl apply -k k8s/overlays/prod
```

Important points in this apply command:

- `kubectl apply` sends the desired objects to the Kubernetes API.
- `-k` tells `kubectl` to build the Kustomize overlay first.
- `k8s/overlays/prod` is the production overlay directory.

Example output:

```bash
deployment.apps/orders-api configured
service/orders-api unchanged
```

Important points in this apply output:

- `configured` means Kubernetes updated the Deployment from the rendered overlay.
- `unchanged` means the Service already matched the rendered output.
- A successful apply still needs rollout status and application checks.

## Add Config And Route Changes
<!-- section-summary: Config and route changes should stay small and show exactly how the application reads them. -->

Once the Deployment, Service, and production overlay are clear, teams often add runtime settings and routes. This is where Kustomize packages can drift from readable to confusing. A ConfigMap generator, a route patch, and a Deployment reference can all be valid on their own, while the final relationship is hard to see.

The beginner rule is to show both sides of every configuration path. If Kustomize generates a ConfigMap, the Deployment should show how the Pod reads it. If production changes a hostname, the route object should show which Service receives that traffic. The source files should help the reader answer, "Where does this value land?"

ConfigMap generation is common in Kustomize. A **ConfigMap** stores non-secret configuration data that Pods can read at runtime:

```yaml
configMapGenerator:
  - name: orders-api-config
    literals:
      - LOG_LEVEL=info
      - CATALOG_URL=http://catalog-api.devpolaris-prod.svc.cluster.local:8080
```

Important points in this generator:

- `configMapGenerator` asks Kustomize to create a ConfigMap during rendering.
- `name: orders-api-config` is the base name of the generated ConfigMap.
- `literals` creates key-value pairs inside the generated ConfigMap.
- These values are ordinary configuration. Secrets should use a Secret-management path.

The Deployment should show the Pod consuming that generated ConfigMap:

```yaml
envFrom:
  - configMapRef:
      name: orders-api-config
```

Important points in this container fragment:

- `envFrom` imports all valid ConfigMap keys as environment variables.
- `configMapRef.name` points to the generated ConfigMap name.
- Reviewers should confirm that generated names still resolve correctly in the rendered output.
- For a small number of critical settings, explicit `env` entries can make review more precise.

For HTTP routing, keep the route object readable and patch only the production host if needed:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: orders-api
spec:
  rules:
    - host: orders.example.internal
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: orders-api
                port:
                  number: 80
```

Important points in this route:

- `host` is the production hostname.
- `path: /` sends all matching host traffic to the backend.
- `backend.service.name: orders-api` connects the route to the Service in the base.
- `port.number: 80` matches the Service port. The Service then sends traffic to the container port through `targetPort`.

Config and route changes are common, so they need strong review habits. Keep the base readable, keep overlays focused on environment differences, and always render the result so reviewers can trace settings into the final objects.

## Avoid Common Overlay Mistakes
<!-- section-summary: Most Kustomize problems come from hidden drift between base resources, patches, generated names, and rendered output. -->

Kustomize problems usually come from the distance between source files and rendered output. A patch can target the wrong name. An overlay can copy too much of the base. A generated ConfigMap name can surprise a Deployment reference. A route host can look correct in source but render into the wrong namespace or backend.

The fix is to keep every overlay small, render it in CI, and review the final YAML. The source files tell the story of intent. The rendered file proves the actual Kubernetes request.

The first common mistake is patching the wrong object name. A patch must match the target resource by kind and name. If the base Deployment is named `orders-api`, the patch metadata should use the same name:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
```

Important points in this patch target:

- `kind` tells Kustomize the type of resource to patch.
- `metadata.name` must match the base object.
- A typo can make the patch fail or miss the intended object.
- CI should render the overlay so missed patches show up before apply.

The second mistake is letting overlays copy too much of the base. If a production patch repeats most of the Deployment, reviewers have to compare two full workload definitions. Move shared behavior back to the base and keep patches focused on production differences.

The third mistake is skipping rendered review. Source files can look reasonable while the built output has the wrong namespace, generated ConfigMap name, selector, or route host.

```bash
kubectl kustomize k8s/overlays/prod > rendered/orders-api-prod.yaml
```

Important points in this CI render command:

- The command builds the production overlay.
- The redirected file is the artifact reviewers can diff and validate.
- CI should run this for the overlay being changed.

## Review A Production Overlay
<!-- section-summary: A production overlay review should connect source changes to rendered YAML, validation, rollout checks, and rollback evidence. -->

A production overlay review should feel like a normal release review. The reviewer should know which base resources are included, which environment fields changed, what YAML Kubernetes will receive, and how the team will recover if the release is wrong.

For `devpolaris-orders-api`, the reviewer starts from the source diff, then checks the rendered artifact. If the source changed `images.newTag`, the rendered Deployment should show the new container image. If the source changed `replicas.count`, the rendered Deployment should show the production replica count. If the source changed a route host, the rendered route should point at the expected Service.

A practical production review asks these questions:

| Review question | Evidence to check |
| --- | --- |
| Which base resources are included? | `resources:` in the overlay |
| Which environment fields changed? | `images`, `replicas`, `namespace`, and patches |
| What final YAML will Kubernetes receive? | `kubectl kustomize` artifact |
| Does live cluster diff look expected? | `kubectl diff` output |
| Did API validation pass? | server-side dry run output |
| What rollback path is ready? | previous Git commit or previous rendered artifact |

For the orders API, a release note can stay concise:

```yaml
Overlay: k8s/overlays/prod
RenderedFields:
  - namespace: devpolaris-prod
  - replicas: 3
  - image: ghcr.io/devpolaris/orders-api:2026.06.16.1
  - resources: production requests and memory limit
Validation:
  - rendered YAML attached
  - kubectl diff reviewed
  - server-side dry run passed
Rollback:
  - revert overlay commit
  - apply previous rendered artifact if urgent
```

Important points in this review note:

- `Overlay` names the exact source directory used for the release.
- `RenderedFields` lists the fields reviewers care about most.
- `Validation` records the checks that happened before apply.
- `Rollback` names the recovery path before the team needs it.

![Overlay review loop showing source diff, build, rendered diff, kubectl diff, and rollout check](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-kustomize-bases-and-overlays/overlay-review-loop.png)

*A strong overlay review moves from source diff to rendered YAML, then to cluster diff, validation, apply, and rollout checks.*

## What's Next

You now have the Kustomize path: valid YAML base, environment overlay, focused patches, rendered output, diff, validation, and apply. The next article compares Helm and Kustomize so you can choose the packaging style that fits the team and release process.

## References

- [Declarative Management of Kubernetes Objects Using Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/) - Official Kubernetes guide for Kustomize resources, generators, patches, overlays, and `kubectl apply -k`.
- [kubectl kustomize](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_kustomize/) - Official command reference for building resources from a `kustomization.yaml` directory.
- [kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/) - Official command reference for applying manifests and kustomization directories.
- [kubectl diff](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/) - Official command reference for comparing live resources with would-be applied configuration.
- [Kubernetes API dry run](https://kubernetes.io/docs/reference/using-api/api-concepts/#dry-run) - Official API concept for validation requests that validate objects without persisting them.
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Official concept guide for Services, selectors, and stable access to Pods.
- [Kubernetes ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) - Official concept guide for ConfigMap data and Pod consumption patterns.
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - Official concept guide for HTTP routing into Services.
