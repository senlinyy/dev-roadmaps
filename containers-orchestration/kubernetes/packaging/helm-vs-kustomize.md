---
title: "Helm vs Kustomize"
description: "Choose between Helm and Kustomize by looking at ownership, release lifecycle, reuse, and how clearly the final manifests can be reviewed."
overview: "Helm and Kustomize both produce Kubernetes YAML from smaller source files. The same `devpolaris-orders-api` release shows the tradeoffs around ownership, reuse, rollback, GitOps review, and rendered output."
tags: ["helm", "kustomize", "tradeoffs", "manifests"]
order: 6
id: article-containers-orchestration-kubernetes-packaging-helm-vs-kustomize
---
## Table of Contents

1. [The Same Release Goal](#the-same-release-goal)
2. [The Helm Shape](#the-helm-shape)
3. [The Kustomize Shape](#the-kustomize-shape)
4. [Compare Source Ownership](#compare-source-ownership)
5. [Compare Reuse And Distribution](#compare-reuse-and-distribution)
6. [Compare Rollback Paths](#compare-rollback-paths)
7. [Compare GitOps Review](#compare-gitops-review)
8. [Compare Rendered Output](#compare-rendered-output)
9. [Use A Selection Checklist](#use-a-selection-checklist)
10. [What's Next](#whats-next)
11. [References](#references)

## The Same Release Goal
<!-- section-summary: Tool comparison should start from the same Kubernetes release goal so the tradeoffs stay concrete. -->

**Helm** and **Kustomize** are two ways to package Kubernetes manifests so teams can reuse shared shape and still make environment-specific changes. Teams usually ask "Helm or Kustomize?" after they have copied Kubernetes YAML across environments, changed one line for production, missed another line in staging, and learned that valid YAML can still produce a risky release.

Both tools help produce Kubernetes manifests from a smaller source shape. Helm uses charts, templates, values, and release records. Kustomize uses valid YAML bases, overlays, patches, and usually relies on Git or a GitOps tool for release history.

The practical choice comes from the team's release situation. A platform team supporting many similar services may need a versioned chart contract. An application team owning one custom workload may prefer overlays beside the service code. A GitOps team may care most about rendered manifests in pull requests. During an incident, the team also needs a clear rollback path for a failed release. The comparison uses the same `devpolaris-orders-api` production release for both tools.

The orders API needs a Deployment and a Service. Production should run three replicas of image `ghcr.io/devpolaris/orders-api:2026.06.16.1`, expose Service port `80`, send traffic to container port `8080`, and keep labels and selectors aligned.

A small Deployment slice shows the release goal:

```yaml
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: orders-api
          image: ghcr.io/devpolaris/orders-api:2026.06.16.1
```

Important points in this target output:

- `replicas: 3` is the production scale goal.
- The image tag is the approved production build.
- The reviewer needs to see the final image, replica count, Service wiring, namespace, resources, and route settings before the release reaches the cluster.

![Helm chart and Kustomize overlay both producing rendered YAML, Kubernetes API input, and review evidence](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-vs-kustomize/one-shared-goal.png)

*Both tools should lead reviewers to the same proof: rendered Kubernetes YAML for the release under review.*

## The Helm Shape
<!-- section-summary: Helm uses a chart folder with metadata, values, and templates, then stores release revisions after install or upgrade. -->

A **Helm chart** is a package for Kubernetes manifests. The chart source usually has metadata, default values, and templates:

The Helm shape works like a contract between a package author and a release owner. The chart author decides which Kubernetes structure is reusable. The release owner supplies values for the environment. Helm then renders a concrete manifest and stores a release record after install or upgrade. For the orders API, that means image tag, replica count, and Service port can change through values while the Deployment and Service pattern stays inside the chart.

```markdown
charts/orders-api/
  Chart.yaml
  values.yaml
  templates/
    deployment.yaml
    service.yaml
```

Important points in this Helm folder:

- `Chart.yaml` describes the chart package.
- `values.yaml` holds default release inputs.
- `templates/` holds the Kubernetes manifests with Helm expressions.

The values file describes release inputs:

```yaml
replicaCount: 3
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16.1"
service:
  port: 80
  targetPort: 8080
```

Important points in these Helm values:

- `replicaCount` is the production scale input.
- `image.repository` and `image.tag` combine into the container image.
- `service.port` and `service.targetPort` describe the Service contract.

The template consumes those inputs:

```yaml
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: orders-api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports:
            - containerPort: {{ .Values.service.targetPort }}
```

Important points in this Helm template:

- `.Values.replicaCount` lands in the Deployment replica field.
- The image repository and tag values land in the container image.
- `.Values.service.targetPort` lands in the container port.

Render for review:

```bash
helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  > rendered/helm-prod.yaml
```

Important points in this render command:

- `helm template` prints manifests without changing the cluster.
- `orders` is the release name used during rendering.
- `-f environments/prod.values.yaml` applies the production values file.
- `> rendered/helm-prod.yaml` saves final Kubernetes YAML.

After approval, install or upgrade:

```bash
helm upgrade --install orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  -n devpolaris-prod \
  --wait \
  --timeout 5m
```

Important points in this upgrade command:

- `helm upgrade --install` updates the release or creates it if it is missing.
- `-n devpolaris-prod` chooses the production namespace.
- `--wait` and `--timeout 5m` make the command wait for readiness before reporting success or timeout.

Helm records release history:

```bash
helm history orders -n devpolaris-prod
```

```bash
REVISION  STATUS    CHART             APP VERSION
1         deployed  orders-api-0.1.0  2026.06.16.1
```

Important points in this history output:

- `REVISION 1` is the first stored release state.
- `STATUS deployed` means Helm considers this revision active.
- `CHART` and `APP VERSION` connect the release to chart package version and application version.

Helm fits a chart-shaped workflow. Values define release inputs, templates define reusable manifest shape, and Helm stores release revisions for operations.

## The Kustomize Shape
<!-- section-summary: Kustomize uses valid Kubernetes YAML in a base and overlays that apply environment changes. -->

**Kustomize** starts from valid Kubernetes YAML. A base contains the shared Deployment and Service. An overlay points at the base and applies production choices.

The Kustomize shape is a layered set of Kubernetes files. The base is the shared application definition, and the overlay records the environment differences. There is no template placeholder to resolve; the source already stays close to Kubernetes YAML. For the orders API, reviewers can open the base Deployment, then open the production overlay to see the namespace, image tag, and replica count changes.

```markdown
k8s/
  base/
    deployment.yaml
    service.yaml
    kustomization.yaml
  overlays/
    prod/
      kustomization.yaml
```

Important points in this Kustomize layout:

- `base/` holds the shared Kubernetes resources.
- `overlays/prod/` records production differences.
- Each directory has its own `kustomization.yaml` so Kustomize can render it.

The base Deployment is a normal Kubernetes object:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: orders-api
          image: ghcr.io/devpolaris/orders-api:2026.06.16-dev
```

Important points in this base Deployment:

- The file is valid Kubernetes YAML before Kustomize changes it.
- The base uses one replica and a development image tag.
- Production changes these fields through the overlay.

The production overlay records environment choices:

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

Important points in this Kustomize overlay:

- `resources: ../../base` imports the shared base.
- `namespace: devpolaris-prod` places namespaced resources in production.
- `images` and `replicas` record the production image tag and replica count.

Render for review:

```bash
kubectl kustomize k8s/overlays/prod \
  > rendered/kustomize-prod.yaml
```

Important points in this render command:

- `kubectl kustomize` builds the production overlay.
- `k8s/overlays/prod` points at the overlay directory.
- The redirected file lets reviewers inspect the final Kubernetes YAML.

Apply after approval:

```bash
kubectl apply -k k8s/overlays/prod
```

```bash
deployment.apps/orders-api configured
service/orders-api unchanged
```

Important points in this apply output:

- `deployment.apps/orders-api configured` means Kubernetes updated the Deployment.
- `service/orders-api unchanged` means the rendered Service already matched the live Service.
- A successful apply still needs rollout and application checks.

Kustomize fits a YAML-first workflow. The base stays close to Kubernetes, overlays carry environment changes, and rollback usually comes from Git history, rendered artifacts, or a GitOps controller.

## Compare Source Ownership
<!-- section-summary: Tool choice depends heavily on who owns the package contract and who supports releases during incidents. -->

The owning team should guide the source shape after the first release. If the platform team owns the package for many services, reviewers need a clear chart contract. If the orders API team owns its own Kubernetes objects, reviewers may prefer source files that stay close to the workload.

**Ownership** means who maintains the package and who answers for it during release review and incidents. The owner decides which fields are configurable, how validation works, where rendered output appears, and how rollback happens.

Helm often fits platform-owned reusable packages. A platform team might maintain one internal `http-api` chart used by many services. App teams supply values for image, replicas, resources, config, and route host. The platform team owns labels, probes, common policies, chart validation, and helper templates.

Kustomize often fits app-owned manifests. The orders API team may own its Deployment and Service directly, then keep `staging` and `prod` overlays beside the application code. The team can review workload shape as Kubernetes YAML and patch only the fields it owns.

Unclear ownership hurts either workflow. A shared chart with no owner turns release review into template archaeology. An overlay pattern with no owner can drift into many private workload definitions. Choose the source shape that the owning team will actually keep readable.

## Compare Reuse And Distribution
<!-- section-summary: Helm has strong package distribution, while Kustomize keeps small service-specific YAML close to the app. -->

Picture four HTTP APIs with the same runtime shape: orders, catalog, billing, and inventory. They all need a Deployment, Service, probes, resources, common labels, and a route. That is a reuse scenario.

**Reuse** means how many services or teams share the same packaging contract. Helm has a strong distribution story through chart repositories and OCI registries. A platform team can version a chart, publish it, and let many services consume it with values files.

For example, DevPolaris might publish an internal `http-api` chart. Orders, catalog, billing, and inventory can all use the same chart while each service supplies its own image and host:

```yaml
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16.1"
ingress:
  host: orders.devpolaris.example
```

Important points in this reuse example:

- The shared chart can stay the same across services.
- Each service supplies its own image repository, tag, and host.
- The rendered output still needs review for the specific service release.

Kustomize reuse usually stays local. A base can be shared inside one app repository, then overlays customize staging, production, and preview. Kustomize can compose remote bases too, but production teams need clear versioning and ownership before remote bases enter the release path.

For the orders API, Kustomize may fit while the service shape is unique. Helm may pay off after many services share the same chart behavior and the organization can support the chart contract.

![Tool choice map showing ownership, reuse, release history, GitOps, incident evidence, and choosing between Helm and Kustomize](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-vs-kustomize/tool-choice-map.png)

*The tool choice depends on ownership, reuse, release history, GitOps review, incident evidence, and how the team wants to inspect final manifests.*

## Compare Rollback Paths
<!-- section-summary: Helm offers built-in release rollback, while Kustomize rollback depends on Git, GitOps, or saved rendered artifacts. -->

A rollback discussion should start from a failed release. The orders API team deploys image `2026.06.16.2`, the new Pods fail readiness, and production needs the previous known-good state.

**Rollback** means returning the running application to a previous known-good state. Helm stores release revisions, so a rollback can target a previous revision:

The important question is where the previous known-good state lives. In Helm, it lives in the release history as stored revisions. In a Kustomize workflow, it usually lives in Git history, a GitOps controller state, or a saved rendered artifact. Both can support recovery, but the team needs the command path documented before the incident.

```bash
helm history orders -n devpolaris-prod
helm rollback orders 1 -n devpolaris-prod --wait --timeout 5m
```

Important points in these rollback commands:

- `helm history` lists the stored release revisions.
- `helm rollback orders 1` asks Helm to return the release to revision `1`.
- `--wait --timeout 5m` makes Helm wait for readiness and stop after five minutes.

Kustomize has no Helm-style release store by itself. Rollback usually means reverting the Git commit that changed the overlay, letting a GitOps controller sync the previous state, or applying a previous rendered artifact:

```bash
git revert <bad-overlay-commit>
kubectl apply -k k8s/overlays/prod
```

Important points in these Git/Kustomize commands:

- `git revert <bad-overlay-commit>` records a new Git commit that undoes the bad overlay change.
- `kubectl apply -k k8s/overlays/prod` applies the desired state from the production overlay.
- This path can be reliable when the team has good Git history and release automation, but the runbook must name it clearly.

## Compare GitOps Review
<!-- section-summary: GitOps can work with both tools, but reviewers still need rendered manifests and clear ownership of the source shape. -->

In a GitOps workflow, the pull request is the release conversation. The orders API team opens a change, reviewers inspect the source and rendered YAML, and automation syncs the approved state to the cluster.

**GitOps** means Git holds the desired application state, and automation reconciles the cluster toward that state. Both Helm and Kustomize can fit GitOps workflows.

With Helm, Git might store chart source and values files, while the GitOps controller renders and applies the chart. With Kustomize, Git often stores bases and overlays directly. In both cases, reviewers need rendered evidence.

A useful pull request note can look the same for either tool:

```yaml
RenderedEvidence:
  - Deployment image changed to ghcr.io/devpolaris/orders-api:2026.06.16.1
  - replicas changed from 2 to 3
  - Service selector still matches Pod labels
  - route host stayed orders.example.internal
Validation:
  - rendered YAML attached
  - server-side dry run passed
```

Important points in this GitOps review note:

- `RenderedEvidence` names the final Kubernetes fields reviewers should inspect.
- The selector line calls out traffic wiring, not just image and scale.
- `Validation` records the rendered artifact and API validation evidence.

GitOps changes should never rely on "the controller will figure it out" as review evidence. The controller applies what the source describes. Humans still need to inspect the final Kubernetes objects.

## Compare Rendered Output
<!-- section-summary: Rendered output is the common review language for both Helm and Kustomize. -->

Rendered output gives both teams the same review language. A Helm chart and a Kustomize overlay may look different in source, but Kubernetes still receives YAML. The reviewer should see that YAML before approval.

This section is the tie-breaker for many comparisons. Source style can differ, ownership can differ, and rollback mechanics can differ, but the cluster accepts Kubernetes objects. For the orders API, the rendered Deployment and Service should show the same production image, replica count, labels, ports, namespace, resources, and route settings whether Helm or Kustomize produced them.

Helm render command:

```bash
helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  > rendered/helm-prod.yaml
```

Important points in this Helm render command:

- It uses the Helm chart source and production values file.
- It writes the final Kubernetes YAML into a review artifact.

Kustomize render command:

```bash
kubectl kustomize k8s/overlays/prod \
  > rendered/kustomize-prod.yaml
```

Important points in this Kustomize render command:

- It uses the production overlay source.
- It writes the final Kubernetes YAML into a review artifact.

After rendering, both tools give you Kubernetes YAML. Reviewers should check the same fields:

| Field | Why reviewers care |
| --- | --- |
| Namespace | A production release should not land in staging |
| Image tag | The cluster should run the approved build |
| Replicas | Capacity and rollout behavior depend on it |
| Labels and selectors | Service traffic depends on matching labels |
| Service ports | Callers depend on the stable port contract |
| ConfigMap and Secret references | Pods must receive the intended runtime settings |
| Route host and TLS | External traffic depends on correct routing |
| Resources and probes | Scheduling and rollout health depend on them |

Tool choice matters, but rendered YAML is the shared review language.

## Use A Selection Checklist
<!-- section-summary: Pick the tool that matches ownership, reuse, release history, review style, and rollback needs. -->

Use Helm when several services share a supported chart contract, release history matters, chart packaging and distribution matter, or the team needs built-in rollback commands. Use Kustomize when the team wants valid YAML as source, service-specific manifests stay close to the app, overlays are small, and Git or GitOps already owns release history.

The checklist is here to slow down tool choice until the team names its release reality. The orders API team should ask who will maintain the package next quarter, how many services need the same shape, who supports production incidents, and where rollback evidence lives. A tool that matches those answers gives operators a release path they can explain under pressure.

Ask these questions before choosing:

| Question | Helm may fit when... | Kustomize may fit when... |
| --- | --- | --- |
| Who owns the package? | A platform team owns a reusable chart | The app team owns the Kubernetes YAML |
| How much reuse exists? | Many services share one contract | One service needs a few overlays |
| How is rollback handled? | Helm revision rollback is desired | Git or GitOps rollback is already standard |
| How do reviewers read source? | Values and templates are accepted | Plain YAML is preferred |
| How are packages distributed? | Charts are versioned and published | Source stays in the app repository |

![Selection checklist with ownership, reuse, rollback path, review path, and production fit questions](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-vs-kustomize/selection-checklist.png)

*The final choice should leave the team with a source shape, review path, rollback path, and production operating story they can explain during a release.*

The practical answer is often mixed. A team may use Helm for shared platform components and Kustomize for service-owned overlays. The important part is not tool loyalty. The important part is a release path that the team can review, validate, operate, and roll back.

## What's Next

You now have the comparison: Helm gives charts, values, package distribution, and release records; Kustomize gives valid YAML bases, overlays, and a YAML-first review path. The final packaging article focuses on keeping either tool readable as the package grows.

## References

- [Helm Charts](https://helm.sh/docs/topics/charts/) - Official Helm documentation for chart format, `Chart.yaml`, templates, values, versions, and dependencies.
- [Helm Values Files](https://helm.sh/docs/chart_template_guide/values_files/) - Official Helm template guide for values files, user-supplied files, and override precedence.
- [helm template](https://helm.sh/docs/helm/helm_template/) - Official command reference for rendering chart templates locally.
- [helm rollback](https://helm.sh/docs/helm/helm_rollback/) - Official command reference for rolling a release back to a previous revision.
- [Declarative Management of Kubernetes Objects Using Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/) - Official Kubernetes guide for Kustomize bases, overlays, generators, patches, and `kubectl apply -k`.
- [kubectl kustomize](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_kustomize/) - Official command reference for building Kustomize output.
- [kubectl diff](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/) - Official command reference for comparing live resources with would-be applied configuration.
