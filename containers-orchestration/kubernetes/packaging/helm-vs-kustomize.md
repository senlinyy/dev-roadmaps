---
title: "Helm vs Kustomize"
description: "Choose between Helm and Kustomize by looking at ownership, release lifecycle, reuse, and how clearly the final manifests can be reviewed."
overview: "Helm and Kustomize both help teams avoid copied Kubernetes YAML, but they optimize for different operating models. This article compares them through the same `devpolaris-orders-api` release."
tags: ["helm", "kustomize", "tradeoffs", "manifests"]
order: 6
id: article-containers-orchestration-kubernetes-packaging-helm-vs-kustomize
---

## Table of Contents

1. [The Shared Goal](#the-shared-goal)
2. [How Helm Packages an App](#how-helm-packages-an-app)
3. [How Kustomize Packages an App](#how-kustomize-packages-an-app)
4. [Ownership and Reuse](#ownership-and-reuse)
5. [Release Lifecycle and Rollback](#release-lifecycle-and-rollback)
6. [GitOps and Reviewability](#gitops-and-reviewability)
7. [Incident Response](#incident-response)
8. [A Decision for devpolaris-orders-api](#a-decision-for-devpolaris-orders-api)
9. [A Practical Selection Checklist](#a-practical-selection-checklist)
10. [What's Next](#whats-next)

## The Shared Goal
<!-- section-summary: Helm and Kustomize both produce Kubernetes objects, so the final rendered YAML remains the main evidence. -->

Helm and Kustomize solve the same broad problem. Teams need a repeatable way to produce Kubernetes manifests for Deployments, Services, ConfigMaps, Secrets, Ingresses, Gateway routes, and other API objects.

The cluster receives the same kind of final objects either way. Kubernetes does not care whether a Deployment came from a Helm template or a Kustomize overlay; it cares about the API version, kind, metadata, spec, selectors, ports, probes, resources, and labels in the final request.

That shared endpoint should calm down the tool debate a little. The practical question is which source format helps your team change and review `devpolaris-orders-api` with fewer surprises.

In this article, the release is the same release from the previous lesson. Production should run `ghcr.io/devpolaris/orders-api:2026.05.07`, use three replicas, serve traffic through `orders.devpolaris.example`, and keep the Service selector matched to the Pod labels. Helm and Kustomize can both express that result, and the team still needs to render the output before trusting it.

![Helm chart and Kustomize overlay both producing rendered YAML, Kubernetes API input, and review evidence](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-vs-kustomize/one-shared-goal.png)

*The source format differs, but the review target stays the same: rendered Kubernetes YAML that the API server can receive.*

## How Helm Packages an App
<!-- section-summary: Helm packages templates, values, metadata, and release commands into a chart. -->

Helm uses a package format called a **chart**. A chart is a directory of files that describes a related set of Kubernetes resources, and it can include templates, default values, metadata, helper templates, and optional chart dependencies.

For the orders API, a small chart might use this layout. The chart owns the reusable templates, while the environment values files carry release choices.

- `charts/orders-api/Chart.yaml`
- `charts/orders-api/values.yaml`
- `charts/orders-api/templates/deployment.yaml`
- `charts/orders-api/templates/service.yaml`
- `charts/orders-api/templates/configmap.yaml`
- `charts/orders-api/templates/ingress.yaml`
- `environments/staging.values.yaml`
- `environments/prod.values.yaml`

The values file carries release decisions. For production, the values might name the image tag, replica count, log level, catalog API URL, and public host.

```yaml
replicaCount: 3
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.05.07"
config:
  logLevel: info
  catalogApiUrl: http://catalog-api.devpolaris-prod.svc.cluster.local:8080
ingress:
  enabled: true
  host: orders.devpolaris.example
```

The template reads those values and renders Kubernetes YAML. A Deployment template can keep the workload shape visible while still accepting the parts that change per environment.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "orders-api.fullname" . }}
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          envFrom:
            - configMapRef:
                name: {{ include "orders-api.fullname" . }}-config
```

Helm also gives a release workflow. The team can install, upgrade, inspect history, roll back to an earlier revision, and uninstall a release with Helm commands. That release layer matters for teams that deploy with Helm directly or use a Helm-aware delivery controller.

The cost is that templates can hide behavior. If the chart has many helpers and conditionals, a reviewer may need to read several files before they know which image or selector reaches production. Helm works well when the chart has a clear values contract and the team renders the manifest as part of every review.

## How Kustomize Packages an App
<!-- section-summary: Kustomize starts with plain YAML and applies overlays, patches, generators, labels, images, and replicas. -->

Kustomize starts from valid Kubernetes YAML. The base contains objects such as `deployment.yaml` and `service.yaml`, and each overlay references the base while adding environment-specific changes.

For the orders API, the Kustomize layout might look like this. The base holds shared Kubernetes objects, and each overlay holds the environment-specific changes.

- `k8s/base/kustomization.yaml`
- `k8s/base/deployment.yaml`
- `k8s/base/service.yaml`
- `k8s/overlays/staging/kustomization.yaml`
- `k8s/overlays/prod/kustomization.yaml`
- `k8s/overlays/prod/deployment-prod-patch.yaml`

Production can set the image and replicas directly in the overlay. The file reads like a list of production decisions rather than a second Deployment copy.

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
patches:
  - path: deployment-prod-patch.yaml
```

That shape helps learners because the base files stay readable as Kubernetes objects. A teammate can open `deployment.yaml`, see a real Deployment, and then open the overlay to see the production changes.

Kustomize has a smaller release layer than Helm. It builds YAML, and then `kubectl`, Git history, a GitOps controller, or a deployment pipeline handles apply history and rollback. That can work very well, especially in repositories where an environment folder already represents desired state.

The cost appears when overlays accumulate many patches. A base plus ten patches can force reviewers to reconstruct the object from fragments. Kustomize works best when the base stays clear and overlays stay small.

## Ownership and Reuse
<!-- section-summary: Helm often fits platform-owned reusable packages, while Kustomize often fits app-owned manifests with environment overlays. -->

Ownership means who maintains the package and who carries the support burden during a release. This matters more than the tool name because the owners decide what the package exposes and how reviewers prove safety.

Kustomize often fits an app team that owns its Kubernetes manifests directly. The orders team can keep the Deployment and Service in the app repository, add staging and production overlays, and review environment differences without learning a template language first.

Helm often fits a platform team that owns a reusable application contract. If twenty internal HTTP APIs share the same labels, probes, resource defaults, service ports, Ingress structure, and rollout strategy, a shared chart can reduce repeated work across services.

The Helm chart should still have a clear boundary. Values such as image tag, replica count, public host, and resource requests are real service decisions. Internal label helpers, naming rules, and safe defaults can stay in the chart. A chart that exposes every Kubernetes field as a value has moved the complexity into another file rather than reducing it.

Third-party software changes the decision too. Many controllers and platform tools ship official or community Helm charts, and installing those charts can make more sense than rewriting every object by hand. In that case, the local review focuses on chart version, values, rendered output, CRDs, and upgrade notes.

## Release Lifecycle and Rollback
<!-- section-summary: Helm stores release history, while Kustomize usually relies on Git, rendered artifacts, and the delivery system. -->

A **release lifecycle** is the path for install, upgrade, rollback, and uninstall. Helm has this lifecycle built into the tool, so the team can ask Helm for release history and roll back a release to a previous revision.

```bash
$ helm history orders -n devpolaris-prod
REVISION  STATUS      CHART             DESCRIPTION
1         superseded  orders-api-0.1.0  Install complete
2         deployed    orders-api-0.1.1  Upgrade complete
```

If revision 2 has a bad image tag or a broken route, Helm gives the operator a direct rollback command. That command uses Helm's stored release history instead of asking the operator to find a previous YAML file first.

```bash
$ helm rollback orders 1 -n devpolaris-prod
Rollback was a success! Happy Helming!
```

Kustomize usually uses a different release memory. The repository commit, rendered YAML artifact, GitOps sync record, or deployment pipeline record tells the team what changed and how to restore the previous desired state.

```bash
$ git log --oneline -- k8s/overlays/prod
$ git revert <bad-release-commit>
$ kubectl apply -k k8s/overlays/prod
```

Neither workflow removes the need to understand Kubernetes rollout behavior. A Helm rollback still changes Kubernetes objects and waits on controllers. A Kustomize revert still needs a rollout check. The difference is where the team finds the previous desired state and which command starts the recovery.

![Tool choice map showing ownership, reuse, release history, GitOps, incident evidence, and choosing between Helm and Kustomize](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-vs-kustomize/tool-choice-map.png)

*Tool choice should rest on ownership, reuse, release history, GitOps workflow, and incident evidence instead of tool popularity.*

## GitOps and Reviewability
<!-- section-summary: GitOps workflows can use either tool, but every workflow needs rendered output that reviewers can inspect. -->

GitOps means the repository describes the desired cluster state, and a controller or pipeline reconciles the cluster toward that state. Both Helm and Kustomize can participate in GitOps workflows, depending on the controller and repository structure.

Kustomize maps naturally to environment folders. A controller can point at `k8s/overlays/prod`, render that directory, and apply the result. The overlay directory itself acts like the production package.

Helm maps naturally to chart plus values. A controller can point at `charts/orders-api` with `environments/prod.values.yaml`, render the chart, and apply the result. The values file acts like the production release input.

Reviewability is the practical test for both choices. A reviewer should be able to render the proposed package, find the final Deployment image, verify the Service selector, inspect ConfigMap references, and compare the route host with the intended environment.

```bash
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml > rendered/prod.yaml

$ kubectl kustomize k8s/overlays/prod > rendered/prod.yaml
```

The render command should appear in the repository or pull request template. If nobody can name the command, the team has not finished designing the packaging workflow. A packaging tool should make production changes easier to inspect, and rendered output is the inspection surface.

## Incident Response
<!-- section-summary: During incidents, the tool choice changes where operators find release evidence. -->

Imagine production traffic starts failing after the orders API release. The team needs to know which image reached the cluster, which values or overlay produced it, whether the Service still selects the Pods, and which release can restore traffic.

With Helm, the operator starts from the release record. That keeps the first questions close to the tool that performed the release.

```bash
$ helm history orders -n devpolaris-prod
$ helm get values orders -n devpolaris-prod
$ helm get manifest orders -n devpolaris-prod > /tmp/orders-release.yaml
```

Those commands show the Helm revision timeline, the values Helm stored for the release, and the manifest Helm rendered for the deployed revision. After that, the operator moves into normal Kubernetes checks.

```bash
$ kubectl rollout status deployment/devpolaris-orders-api -n devpolaris-prod
$ kubectl describe deployment devpolaris-orders-api -n devpolaris-prod
$ kubectl get endpointslice -n devpolaris-prod -l kubernetes.io/service-name=devpolaris-orders-api
```

With Kustomize, the operator usually starts from Git and the desired overlay. That keeps the first questions close to the repository state and the delivery controller.

```bash
$ git log --oneline -- k8s/overlays/prod
$ kubectl kustomize k8s/overlays/prod > /tmp/orders-desired.yaml
$ kubectl diff -f /tmp/orders-desired.yaml
```

If a GitOps controller manages the overlay, its sync status joins the evidence. The operator checks whether the controller applied the commit, whether the live cluster drifted from the desired output, and whether reverting the commit will restore the previous object state.

The same production questions show up in both workflows. The difference is the first evidence source: Helm release history for Helm, and Git plus delivery-controller history for Kustomize.

## A Decision for devpolaris-orders-api
<!-- section-summary: The orders API can start with Kustomize and move to Helm if reuse and release needs justify the extra package layer. -->

For the first version of `devpolaris-orders-api`, Kustomize is a strong fit. The team owns a small set of plain manifests, needs staging and production differences, and benefits from source files that look like the Kubernetes objects learners are studying.

The production overlay can stay small: namespace, image tag, replica count, ConfigMap values, resource patch, and optional Ingress or Gateway route. CI can render the overlay, store the YAML artifact, and run a server-side dry run against a validation cluster.

Helm starts to make more sense when the same workload pattern repeats across many services. If the platform team already knows that every API should expose the same values, labels, probes, rollout defaults, Service shape, and route options, a shared chart can reduce repeated decisions.

A migration from Kustomize to Helm should prove that the runtime behavior stays the same. The team can render the old Kustomize overlay and the new Helm chart, then compare the important fields.

```bash
$ kubectl kustomize k8s/overlays/prod > /tmp/orders-kustomize.yaml
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml > /tmp/orders-helm.yaml
$ diff -u /tmp/orders-kustomize.yaml /tmp/orders-helm.yaml
```

The files may not match byte for byte because tools can order fields and labels differently. The reviewer should focus on image, replicas, selectors, ports, probes, resources, namespace, ConfigMap references, and route host.

## A Practical Selection Checklist
<!-- section-summary: The right tool is the one that matches ownership, reuse, release history, review path, and incident workflow. -->

This checklist turns the tool choice into production questions. It helps the team avoid a popularity contest and pick the workflow they can operate.

| Question | Helm usually fits when... | Kustomize usually fits when... |
|---|---|---|
| Who owns the package? | A platform team owns a reusable chart | The app team owns its manifests |
| How much reuse exists? | Many services share one workload contract | One service needs a few environment differences |
| How does rollback work? | Operators want Helm release history and rollback commands | The team relies on Git, artifacts, or GitOps rollback |
| How do reviewers inspect output? | Values plus templates render clearly | Base plus overlays render clearly |
| How does incident response start? | Operators start from `helm history` and `helm get manifest` | Operators start from Git history and rendered overlay output |
| How common are third-party packages? | The software already ships as a maintained chart | The team mainly owns plain Kubernetes YAML |

For the orders API, the answer can change over time. A small team can start with Kustomize while the app shape settles, then move to Helm after the organization standardizes many APIs around the same package contract.

The team should write down the render, diff, apply, and rollback commands in the repository either way. The package choice matters less than the review habit that proves what Kubernetes will receive.

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
