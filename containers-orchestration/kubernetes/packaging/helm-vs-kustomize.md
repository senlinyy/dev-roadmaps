---
title: "Helm vs Kustomize"
description: "Choose between Helm and Kustomize by looking at ownership, release lifecycle, reuse, and how clearly the final manifests can be reviewed."
overview: "Helm and Kustomize both help teams avoid copied Kubernetes YAML, but they optimize for different operating models. This article compares them through the same `devpolaris-orders-api` release."
tags: ["helm", "kustomize", "tradeoffs", "manifests"]
order: 6
id: article-containers-orchestration-kubernetes-packaging-helm-vs-kustomize
---

## Table of Contents

1. [One Goal, Two Source Shapes](#one-goal-two-source-shapes)
2. [The Same Tiny Release In Helm](#the-same-tiny-release-in-helm)
3. [The Same Tiny Release In Kustomize](#the-same-tiny-release-in-kustomize)
4. [Ownership Drives The Choice](#ownership-drives-the-choice)
5. [Reuse And Distribution](#reuse-and-distribution)
6. [Release History And Rollback](#release-history-and-rollback)
7. [GitOps And Review Flow](#gitops-and-review-flow)
8. [How To Compare Rendered Output](#how-to-compare-rendered-output)
9. [A Practical Selection Checklist](#a-practical-selection-checklist)
10. [What's Next](#whats-next)

## One Goal, Two Source Shapes
<!-- section-summary: Helm and Kustomize both produce Kubernetes YAML, but they ask teams to maintain different source shapes. -->

The team starts with readable Kubernetes YAML. Then dev, staging, and production need different image tags, replicas, config values, and hostnames. Copying the YAML into three folders repeats the same selectors, ports, labels, and probes, so the team reaches for a packaging tool.

**Helm** packages Kubernetes templates, default values, chart metadata, dependencies, and release commands. A Helm chart can expose inputs such as image tag, replica count, host, and resources, then render Deployments, Services, ConfigMaps, and routes.

**Kustomize** starts from valid Kubernetes YAML, then applies overlays, patches, generators, labels, names, images, and replicas. A Kustomize base can contain a real Deployment and Service, while each overlay describes staging or production choices.

The plain-English choice is about source shape and operations. Helm says, "Keep a package with values and templates, then let Helm record releases." Kustomize says, "Keep real YAML in a base, then layer environment changes on top." The orders API team can choose either source shape and still ask the same production question: what exact objects will Kubernetes receive?

![Helm chart and Kustomize overlay both producing rendered YAML, Kubernetes API input, and review evidence](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-vs-kustomize/one-shared-goal.png)

*The source format differs, but the review target stays the same: rendered Kubernetes YAML that the API server can receive.*

## The Same Tiny Release In Helm
<!-- section-summary: Helm fits a chart-shaped workflow where templates consume values and Helm records release revisions. -->

Start with the smallest Helm version of the orders API release.

```
charts/orders-api/
  Chart.yaml
  values.yaml
  templates/
    deployment.yaml
    service.yaml
```

The values file describes release inputs.

```yaml
replicaCount: 3
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16.1"
service:
  port: 80
  targetPort: 8080
```

The Deployment template consumes image and replicas.

```yaml
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: orders-api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

Render for review.

```bash
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  > rendered/helm-prod.yaml
```

Install or upgrade with Helm when the release is approved.

```bash
$ helm upgrade --install orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  -n devpolaris-prod \
  --wait \
  --timeout 5m
```

The Helm workflow gives operators release history.

```bash
$ helm history orders -n devpolaris-prod
REVISION  STATUS    CHART             APP VERSION
1         deployed  orders-api-0.1.0  2026.06.16.1
```

Helm fits well when a team wants a packaged chart, reusable values, chart dependencies, and built-in release operations.

## The Same Tiny Release In Kustomize
<!-- section-summary: Kustomize fits a YAML-first workflow where bases stay readable and overlays carry environment differences. -->

The Kustomize version starts from valid YAML.

```
k8s/
  base/
    deployment.yaml
    service.yaml
    kustomization.yaml
  overlays/
    prod/
      kustomization.yaml
```

The base Deployment is a normal Kubernetes object.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: orders-api
          image: ghcr.io/devpolaris/orders-api:2026.06.16-dev
```

The production overlay describes environment choices.

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

Render for review.

```bash
$ kubectl kustomize k8s/overlays/prod \
  > rendered/kustomize-prod.yaml
```

Apply through Kustomize after approval.

```bash
$ kubectl apply -k k8s/overlays/prod
deployment.apps/devpolaris-orders-api configured
service/devpolaris-orders-api unchanged
```

Kustomize fits well when the app team owns plain Kubernetes YAML, environment changes are modest, and rollback lives in Git history, rendered artifacts, or the GitOps controller.

## Ownership Drives The Choice
<!-- section-summary: Tool choice should start with who owns the package and who supports it during releases and incidents. -->

**Ownership** means who maintains the package and who answers for it during release review and incidents. The owner decides which fields are configurable, how validation works, where rendered output appears, and how rollback happens.

Helm often fits platform-owned reusable packages. For example, a platform team might maintain one `http-api` chart used by twenty services. Each app team supplies values for image, replicas, resources, config, and route. The platform team owns the chart contract and keeps common probes, labels, and policies consistent.

Kustomize often fits app-owned manifests. For example, the orders API team may own its Deployment and Service directly, then keep `staging` and `prod` overlays in the same repository. The app team can read the YAML, patch the fields they own, and review the production overlay without learning a shared chart API.

The weak version of either workflow is unclear ownership. A shared Helm chart nobody owns can turn every release into template archaeology. A Kustomize overlay copied by five teams can drift into five private workload definitions. The tool should match the owner who will keep the package readable.

## Reuse And Distribution
<!-- section-summary: Helm usually gives stronger package distribution, while Kustomize keeps small service-specific YAML close to the app. -->

**Reuse** means how many services or teams share the same packaging contract. Helm has a strong distribution story through chart repositories and OCI registries. A platform team can version a chart, publish it, and let many services consume it with values files.

For example, DevPolaris might publish an internal `http-api` chart. Orders, catalog, billing, and inventory can all use the same chart, while each service supplies its own image and host.

```yaml
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16.1"
ingress:
  host: orders.devpolaris.example
```

Kustomize reuse usually looks more local. A base can be shared inside one app repository, then overlays customize staging, production, and preview. Kustomize can also compose remote bases, but teams should be careful with versioning and ownership when remote bases enter production.

For the orders API, Kustomize may be enough if only one service needs this exact shape. Helm may pay off if many services need the same chart behavior and the organization can support a chart contract.

![Tool choice map showing ownership, reuse, release history, GitOps, incident evidence, and choosing between Helm and Kustomize](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-vs-kustomize/tool-choice-map.png)

*Tool choice should rest on ownership, reuse, release history, GitOps workflow, and incident evidence instead of tool popularity.*

## Release History And Rollback
<!-- section-summary: Helm records release revisions, while Kustomize teams usually depend on Git, artifacts, or GitOps history for rollback. -->

**Release history** is the record that tells operators what was deployed and how to return to a previous state. Helm stores release revisions in the cluster. Kustomize does not add a release record by itself.

With Helm, rollback can start from Helm history.

```bash
$ helm history orders -n devpolaris-prod
REVISION  STATUS      CHART             APP VERSION
1         deployed    orders-api-0.1.0  2026.06.16.1
2         failed      orders-api-0.1.1  2026.06.16.2

$ helm rollback orders 1 -n devpolaris-prod --wait --timeout 5m
Rollback was a success! Happy Helming!
```

With Kustomize, rollback usually starts from Git or a stored rendered artifact.

```bash
$ git revert <overlay-change-commit>
$ kubectl apply -k k8s/overlays/prod
```

Some GitOps systems add their own history and sync controls. In that workflow, the operator may revert a Git commit or ask the controller to sync a previous revision. The important part is not the brand of tool; the team needs a documented rollback path before production release.

For stateful applications, both tools need extra care. Rolling back manifests does not automatically undo database migrations, emitted events, cache writes, or external API changes.

## GitOps And Review Flow
<!-- section-summary: GitOps workflows care most about rendered evidence, stable ownership, and a clear controller path from Git to cluster. -->

**GitOps** means Git acts as the desired-state source, and a controller applies changes to the cluster. Helm and Kustomize both fit GitOps, but they place the package source in different shapes.

In a Helm GitOps flow, the repository may store a chart reference and values files. The controller renders the chart and applies the output. Reviewers need the values diff, chart version, rendered manifest, and controller sync status.

In a Kustomize GitOps flow, the repository may store bases and overlays directly. The controller builds the overlay and applies the output. Reviewers need the overlay diff, rendered manifest, and controller sync status.

The orders API team should write down the same evidence either way.

```yaml
ReviewEvidence:
  renderedManifest: rendered/prod.yaml
  liveDiff: kubectl diff output or controller diff
  rolloutCheck: kubectl rollout status deployment/devpolaris-orders-api
  rollbackPath: Helm revision, Git revert, or previous artifact
```

The rendered manifest prevents tool arguments from drifting away from production reality. Helm source and Kustomize source both need the same final proof.

## How To Compare Rendered Output
<!-- section-summary: Comparing Helm and Kustomize should focus on the Kubernetes fields that affect runtime behavior. -->

When evaluating tools, compare rendered YAML from the same release goal. The files may not match byte for byte. Field order, labels, annotations, and generated names can differ. Focus on runtime behavior.

Render both versions.

```bash
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  > rendered/helm-prod.yaml

$ kubectl kustomize k8s/overlays/prod \
  > rendered/kustomize-prod.yaml
```

Check the fields that carry risk.

```bash
$ grep -n "replicas:\\|image:\\|targetPort:\\|host:" rendered/helm-prod.yaml
$ grep -n "replicas:\\|image:\\|targetPort:\\|host:" rendered/kustomize-prod.yaml
```

The reviewer should inspect image, replicas, selectors, ports, probes, resources, namespace, ConfigMap references, and route host. If both workflows render the same production behavior, the choice can move to ownership, reuse, release history, and team fluency.

## A Practical Selection Checklist
<!-- section-summary: A checklist turns the decision into concrete production questions instead of a tool popularity contest. -->

Use this checklist before choosing one tool for a service or module.

| Question | Helm usually fits when... | Kustomize usually fits when... |
|---|---|---|
| Who owns the package? | A platform team owns a reusable chart | The app team owns its manifests |
| How much reuse exists? | Many services share one workload contract | One service needs a few environment differences |
| How does rollback work? | Operators want Helm release history and rollback commands | The team relies on Git, artifacts, or GitOps rollback |
| How do reviewers inspect output? | Values plus templates render clearly | Base plus overlays render clearly |
| How does incident response start? | Operators start from `helm history` and `helm get manifest` | Operators start from Git history and rendered overlay output |
| How common are third-party packages? | The software already ships as a maintained chart | The team mainly owns plain Kubernetes YAML |

For the orders API, the answer can change over time. A small team can start with Kustomize while the app shape settles, then move to Helm after the organization standardizes many APIs around the same package contract.

The team should write down the render, diff, apply, verify, and rollback commands either way. The package choice has value only when the team can operate it under production pressure.

![Selection checklist with ownership, reuse, rollback path, review path, and production fit questions](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-vs-kustomize/selection-checklist.png)

*A practical checklist keeps the decision tied to the team's production workflow, not the packaging tool's reputation.*

## What's Next

Now the tool choice has a production frame: ownership, reuse, lifecycle, reviewability, GitOps, and incident response. The next risk is that either tool can grow too clever after a few releases.

The final article in this packaging module shows how Helm charts and Kustomize overlays drift into template sprawl, and how the orders API team can keep the package small enough for reviewers to trust. It closes the module with a production review checklist rather than sending readers into another packaging topic.

---

**References**

- [Helm Charts](https://helm.sh/docs/topics/charts/) - Official Helm documentation for the chart package format and chart directory structure.
- [Helm Values Files](https://helm.sh/docs/chart_template_guide/values_files/) - Official Helm template guide explaining values, default values, user-supplied files, and override precedence.
- [helm template](https://helm.sh/docs/helm/helm_template/) - Official command reference for rendering chart templates locally.
- [helm rollback](https://helm.sh/docs/helm/helm_rollback/) - Official command reference for rolling a release back to a previous revision.
- [Declarative Management of Kubernetes Objects Using Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/) - Official Kubernetes guide for Kustomize bases, overlays, generators, patches, and `kubectl apply -k`.
- [kubectl diff](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/) - Official command reference for comparing live resources with would-be applied configuration.
