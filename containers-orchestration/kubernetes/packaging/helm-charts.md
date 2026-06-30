---
title: "Helm Charts"
description: "Read and build Helm charts that render predictable Kubernetes manifests for an application."
overview: "A Helm chart packages Kubernetes templates, chart metadata, and values. The chart idea comes from the everyday problem of reusing Kubernetes YAML across dev, staging, and production."
tags: ["helm", "charts", "templates", "kubernetes"]
order: 2
id: article-containers-orchestration-kubernetes-packaging-helm-charts
---
## Table of Contents

1. [The YAML Reuse Problem](#the-yaml-reuse-problem)
2. [What a Helm Chart Contains](#what-a-helm-chart-contains)
3. [The Chart Metadata File](#the-chart-metadata-file)
4. [The Values File](#the-values-file)
5. [The Template Folder](#the-template-folder)
6. [How Rendering Connects Values to YAML](#how-rendering-connects-values-to-yaml)
7. [How Teams Review a Chart Change](#how-teams-review-a-chart-change)
8. [Helpers and Dependencies](#helpers-and-dependencies)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## The YAML Reuse Problem
<!-- section-summary: Helm helps a Kubernetes app keep one shared shape while each environment supplies its own choices. -->

**A Helm chart** is a reusable Kubernetes package made from chart metadata, values, and templates. Helm renders that package into ordinary Kubernetes YAML for a named release. Running one Kubernetes application usually means writing several YAML files: a Deployment runs the app, a Service gives it a stable network name, a ConfigMap holds ordinary settings, and an Ingress or HTTPRoute may expose it outside the cluster.

The common problem is repetition. Development may need one replica and a dev image tag. Production may need five replicas, a stable image tag, resource requests, and a real hostname. The structure of the Kubernetes objects should stay the same, but a few release choices need to change. Copying the same YAML into three folders creates drift because a label, port, probe, or selector can be changed in one place and missed in another.

**Helm** solves that packaging problem for Kubernetes. Think about the chart as the reusable application recipe. The values file supplies the environment-specific choices. Helm combines them and renders ordinary Kubernetes YAML that reviewers can inspect before the install or upgrade reaches the cluster.

Imagine a small `orders-api` that runs on Kubernetes. The team needs the same app in three places. Development should run one replica with a fast-moving image tag. Staging should run two replicas with a release-candidate tag. Production should run five replicas with the approved image tag, stricter resource requests, and the public hostname.

The team could copy raw manifests into three folders:

```markdown
k8s/
  dev/
    deployment.yaml
    service.yaml
  staging/
    deployment.yaml
    service.yaml
  prod/
    deployment.yaml
    service.yaml
```

Important points in this copied layout:

- Each environment owns its own Deployment and Service copies.
- The layout looks simple before the first few changes.
- Drift appears when one folder receives a label, port, probe, or image update that the others miss.

At first, that folder layout feels simple. The trouble appears during normal change. A developer adds a readiness probe to development and forgets staging. Someone renames a Pod label in production and misses the Service selector. Another release changes the container port in the Deployment and misses the Service `targetPort`. The files still look familiar, while the environments quietly drift away from the same application shape.

Helm gives the team a different split. The shared Kubernetes shape lives in templates. The environment choices live in values files. Helm renders the final Deployment, Service, ConfigMap, and route objects before the team applies them.

## What a Helm Chart Contains
<!-- section-summary: A chart has metadata, default values, and templates that render into ordinary Kubernetes objects. -->

A **Helm chart** is a folder that packages Kubernetes manifests as reusable templates. A beginner only needs three chart pieces at first:

Those pieces line up with the release path the orders API team already follows. Someone needs to name and version the package, someone needs to choose production inputs, and someone needs to review the Kubernetes objects that will run in the cluster. Helm keeps those jobs in separate files so the chart author can change the package shape without mixing it with every environment choice. Before looking at the folder tree, it helps to know what each file is responsible for.

| Chart piece | Simple meaning | What it does for `orders-api` |
| --- | --- | --- |
| **Chart.yaml** | The label on the package | Names the chart and records chart version metadata |
| **values.yaml** | The default settings | Supplies replica count, image tag, service port, and hostname defaults |
| **templates/** | Kubernetes YAML with placeholders | Renders Deployment, Service, ConfigMap, and route objects |

A small chart folder can look like this:

```markdown
charts/orders-api/
  Chart.yaml
  values.yaml
  templates/
    deployment.yaml
    service.yaml
    configmap.yaml
```

Important points in this chart folder:

- `Chart.yaml` describes the chart package.
- `values.yaml` contains default release inputs.
- `templates/` contains the Kubernetes objects Helm will render.
- `deployment.yaml`, `service.yaml`, and `configmap.yaml` should still be recognizable as Kubernetes resources.

The folder should stay easy to connect to Kubernetes. A beginner should be able to open `templates/deployment.yaml` and still recognize a Deployment. Helm syntax adds placeholders, but the rendered output is plain Kubernetes YAML.

![Small Helm chart directory showing Chart.yaml, values.yaml, templates, helpers, Deployment, and Service output](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/small-helm-chart.png)

*A useful chart keeps the source reusable while the rendered output still looks like normal Kubernetes objects.*

The chart structure has a clear reading order. `Chart.yaml` labels the package, `values.yaml` stores environment choices, and `templates/` shows where those choices land in Kubernetes YAML.

## The Chart Metadata File
<!-- section-summary: Chart.yaml describes the chart package, while the application image tag still lands in the rendered Deployment. -->

`Chart.yaml` is the metadata file for the chart package. It gives Helm the chart name, chart API version, package version, chart type, and human-readable description. A small application chart can start like this:

This file describes the package. For the orders API, reviewers use it to answer questions such as "Which chart version is this?" and "Is this an application chart?" The container image still appears later in the Deployment template and values. Keeping that separation clear helps a beginner avoid treating `Chart.yaml` as the place where all runtime settings belong.

```yaml
apiVersion: v2
name: orders-api
description: Helm chart for the Orders API
type: application
version: 0.1.0
appVersion: "2026.06.16.1"
```

Important points in this metadata file:

- `apiVersion: v2` says this chart uses the modern Helm chart format.
- `name` is the package name.
- `type: application` says the chart installs application resources.
- `version` is the chart package version, which changes after the chart source changes.
- `appVersion` records the application version for humans and tools.

Production reviews should keep **chart version** and **application version** separate. The chart version describes the packaging source. The application image tag describes the code build that Kubernetes will run. A chart change might update a Service port without changing the application image. An application release might update only the image tag through values.

Helm packages the Kubernetes release shape and usually points to the application build through image values. Once the package has a name and version, the next file supplies the choices that may differ by environment.

## The Values File
<!-- section-summary: values.yaml supplies the inputs that templates read, such as replica count, image tag, ports, and hostnames. -->

`values.yaml` is the default input file for a chart. A **value** is a named input that templates can read. For the Orders API, the first values should be release choices that a reviewer already understands:

The file is ordinary YAML, but its meaning comes from the templates that read it. A value should answer a release question, such as how many replicas to run or which image tag to deploy. It should also have a visible destination in rendered Kubernetes YAML. For this chart, the first defaults describe the small development release so production can override only the fields that change.

```yaml
replicaCount: 1

image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16-dev"
```

Important points in these defaults:

- `replicaCount: 1` says the default release should run one Pod.
- `image.repository` names the image repository shared by each environment.
- `image.tag` uses a development tag because production will override it.

Production can override only the parts that differ:

```yaml
replicaCount: 5

image:
  tag: "2026.06.16.1"
```

Important points in this production override:

- `replicaCount: 5` replaces the default count for production.
- `image.tag` replaces only the tag while keeping the shared repository.
- The destination matters: `replicaCount` should land in `Deployment.spec.replicas`, and the image values should land in the container image field.

Good values usually describe choices the release owner should make: image tags, replica counts, hostnames, resource sizes, feature flags, and optional integrations. Shared object shape should stay in templates. For example, labels and selectors should usually stay stable unless the chart author intentionally exposes them as a controlled option.

## The Template Folder
<!-- section-summary: Templates are Kubernetes manifests with placeholders, and each placeholder should point to a visible rendered field. -->

The `templates/` folder contains Kubernetes YAML with Helm expressions inside `{{ ... }}`. A **template** is still meant to read like the Kubernetes object it will render. Helm adds placeholders where values should fill in environment-specific choices.

This folder is where the chart turns release inputs into actual Kubernetes objects. The Deployment template owns the workload shape, so reviewers should still see fields such as replicas, container image, ports, probes, and resources in a recognizable Kubernetes structure. The placeholders should feel like named openings in that structure, not like a separate program that hides what the Deployment will do.

Here is a small Deployment template slice. It only shows the fields that connect to the values we just introduced:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-orders-api
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: orders-api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

Important points in this Deployment template:

- `.Release.Name` comes from the Helm release name chosen during install or upgrade.
- `.Values.replicaCount` reads the value from `values.yaml` or an override file.
- `.Values.image.repository` and `.Values.image.tag` combine into the final container image.
- The Kubernetes shape still looks like a Deployment after the placeholders are added.

This is the point where beginner confusion often starts. The values file alone has no visible effect. The template alone still has blanks. Helm renders the chart by combining the template source with the values and producing normal Kubernetes YAML.

The Service template can follow the same pattern. It should expose only the release choices that need to vary, such as the caller-facing port:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ .Release.Name }}-orders-api
spec:
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
```

Important points in this Service template:

- `.Release.Name` keeps the Service name tied to the Helm release.
- `.Values.service.port` lands in the caller-facing Service port.
- `targetPort: http` points to the named container port in the Deployment.

In a real chart, the Deployment and Service also need labels, selectors, probes, resources, and configuration references. Those details are important, but the beginner path stays the same: introduce one value, show the template field that consumes it, then render the chart to prove the final Kubernetes YAML.

## How Rendering Connects Values to YAML
<!-- section-summary: Rendering prints the Kubernetes YAML Helm will produce, which lets reviewers check the final objects before install or upgrade. -->

**Rendering** means asking Helm to print the Kubernetes YAML that the chart will produce. Rendering is the bridge between chart source and cluster changes. It helps beginners because they can see exactly where values landed. It helps production reviewers because they can inspect the final Deployment and Service before the cluster changes.

The orders API team should render before install or upgrade because the chart source is only half of the release. The final result also depends on values files, the release name, the namespace, and any command-line overrides. Rendering gathers those inputs into one concrete manifest stream. That stream is where the team can confirm the image tag, replica count, labels, Service ports, and route settings.

Run this command from the repository that contains the chart:

```bash
helm template orders-api ./charts/orders-api -f values-prod.yaml
```

Important points in this command:

- `helm template` renders the chart without installing anything.
- `orders-api` is the release name used during this render.
- `./charts/orders-api` points at the chart directory.
- `-f values-prod.yaml` supplies the production override file.

A shortened rendered Deployment should show the production choices:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api-orders-api
spec:
  replicas: 5
  template:
    spec:
      containers:
        - name: orders-api
          image: "ghcr.io/devpolaris/orders-api:2026.06.16.1"
```

Important points in this rendered Deployment:

- The production override set `replicaCount: 5`, and the rendered Deployment shows `replicas: 5`.
- The override set the image tag to `2026.06.16.1`, and the rendered container image uses that tag.
- The chart has produced a concrete Kubernetes object that reviewers can inspect.

![Template to objects flow showing Helm templates and values rendering Deployment, Service, and ConfigMap objects with selector and label checks](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/template-to-objects.png)

*Rendering connects chart source to final Kubernetes objects, so reviewers can check the Deployment, Service, and ConfigMap that the cluster will receive.*

After rendering, many teams run `helm lint` and a Kubernetes dry run. `helm lint` checks chart structure and template problems. A dry run asks Kubernetes to validate the rendered objects against the API server without creating or updating them.

```bash
helm lint ./charts/orders-api
```

```bash
==> Linting ./charts/orders-api
[INFO] Chart.yaml: icon is recommended

1 chart(s) linted, 0 chart(s) failed
```

Important points in this lint output:

- `[INFO] Chart.yaml: icon is recommended` is informational, not a failure.
- `0 chart(s) failed` means Helm did not find chart lint failures.
- Reviewers still need rendered YAML because linting cannot prove the release choices are correct.

## How Teams Review a Chart Change
<!-- section-summary: A chart review checks the source files, rendered Kubernetes objects, validation output, and rollback evidence together. -->

A production chart review should answer four practical questions. What changed in the chart source? What Kubernetes objects will Helm render? Did validation pass? What is the rollback path if the release fails?

This section moves from chart mechanics into team practice. A chart pull request can include template edits, values changes, or both. Reviewers need a short note that separates those facts and points to the evidence. For the orders API, the note should help someone quickly find the chart version, application image, rendered fields, validation commands, and rollback material without reading the whole repository first.

For the Orders API, a short pull request note can stay concrete:

```yaml
Change:
  chart: orders-api
  chartVersion: 0.1.1
  applicationImage: ghcr.io/devpolaris/orders-api:2026.06.16.1
RenderedEvidence:
  - Deployment replicas are 5 in production
  - Service selector matches Pod labels
  - ConfigMap contains only plain settings
  - Ingress host is orders.example.internal
Validation:
  - helm lint passed
  - helm template reviewed for staging and production
  - server-side dry run passed
Rollback:
  - previous chart artifact remains available
  - previous values file remains available
```

Important points in this pull request note:

- `Change` separates chart version from application image.
- `RenderedEvidence` lists the Kubernetes fields reviewers should confirm.
- `Validation` records the checks that ran before release.
- `Rollback` names the artifacts needed to recover.

This review note is a human-friendly summary of the evidence reviewers need. The rendered YAML still carries the final truth. The note helps reviewers focus on the fields that tend to break releases: names, namespaces, selector labels, Service ports, image tags, resource requests, probes, hostnames, TLS Secret names, and dependency changes.

Helm is popular partly because it gives this review process a clear package boundary. The chart source can live in Git. Chart versions can be published as artifacts. Releases can be installed, upgraded, inspected, and rolled back through Helm commands. Those features make a chart useful beyond simple string replacement.

## Helpers and Dependencies
<!-- section-summary: Helpers and dependencies are useful after the basic chart is clear, but they should not hide important runtime behavior. -->

Helm has advanced features, and beginners usually meet two of them early: helpers and dependencies. Both exist for practical reasons. Helpers reduce repeated template snippets such as names and labels. Dependencies let one chart pull in another chart that the release needs. They are powerful, so the safe habit is to keep the important runtime behavior visible in rendered Kubernetes YAML.

The reason helpers show up early is that Kubernetes objects repeat the same names and labels in several places. The Deployment selector, Pod labels, and Service selector must agree, so a tiny shared snippet can prevent a copy-paste mismatch. The safe boundary is metadata. A helper that repeats selector labels is easy to review. A helper that builds the whole container block hides the part of the workload operators inspect during incidents.

A **helper template** is a reusable template snippet, often stored in `templates/_helpers.tpl`. Teams use helpers for repeated names and labels. For example, a chart might define the standard selector labels once:

```yaml
{{- define "orders-api.selectorLabels" -}}
app.kubernetes.io/name: orders-api
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
```

Important points in this helper:

- `define` gives the helper a chart-scoped name.
- The helper contains only selector labels.
- `.Release.Name` keeps labels distinct for separate installs of the same chart.

Then the Deployment can include the helper inside the selector and Pod labels:

```yaml
selector:
  matchLabels:
{{ include "orders-api.selectorLabels" . | nindent 6 }}
template:
  metadata:
    labels:
{{ include "orders-api.selectorLabels" . | nindent 8 }}
```

- `define "orders-api.selectorLabels"` gives the helper a chart-scoped name so other templates can call it.
- `.Release.Name` reads the Helm release name, which keeps labels different for separate installs of the same chart.
- `include "orders-api.selectorLabels" .` renders the helper with the current template context.
- `| nindent 6` adds a newline and indents the rendered helper by six spaces, so the labels land at the correct YAML level under `matchLabels`.
- The Deployment and Service can call the same helper, which lowers the chance that selectors and Pod labels drift apart.

Helpers should stay small. Names and labels are good helper content. The container image, ports, probes, resources, and environment references usually deserve visible template sections because reviewers need to see runtime behavior in the object that owns it.

A **chart dependency** is another chart listed in `Chart.yaml`. Dependencies can help when one chart intentionally includes another chart, such as a shared library chart or a small backing service for preview environments.

Dependencies need the same kind of review discipline as templates. Pulling in another chart means the release may create extra Kubernetes objects, bring its own values, and follow its own upgrade path. For the orders API, a Redis dependency might be helpful in a short-lived preview environment where the app needs a disposable cache. Production usually needs a stronger ownership story before a backing service is bundled into the application release.

```yaml
apiVersion: v2
name: orders-api
version: 0.1.0
dependencies:
  - name: redis
    version: 20.6.1
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
```

- `dependencies:` tells Helm which extra charts belong to this chart package.
- `name: redis` is the dependency chart name.
- `version: 20.6.1` pins the dependency chart version so installs are repeatable.
- `repository:` tells Helm where to download the dependency chart.
- `condition: redis.enabled` connects the dependency to a values toggle.

The values file can turn that dependency on for a preview environment:

```yaml
redis:
  enabled: true
  auth:
    enabled: false
```

Important points in this preview value:

- `redis.enabled: true` turns on the dependency for the preview release.
- `auth.enabled: false` keeps the example small, but production Redis needs a stronger security plan.
- The rendered output should show any extra Kubernetes objects created by the dependency.

For production, the same chart may point at a managed Redis service instead:

```yaml
redis:
  enabled: false

externalRedis:
  host: redis-prod.devpolaris.internal
  port: 6379
```

Important points in this production value:

- `redis.enabled: false` stops the bundled dependency from installing.
- `externalRedis.host` points the application at the managed service.
- The chart should document how the application consumes that external host and port.

That distinction matters in real release work. A disposable preview database may fit inside a preview environment chart. A production database usually needs its own release, backup plan, access policy, monitoring, and upgrade schedule.

The beginner rule is simple: use helpers and dependencies to reduce repeated structure while the important parts of the application stay visible. A reviewer should still be able to render the chart and understand what Kubernetes will receive.

## Putting It All Together
<!-- section-summary: Helm packages reusable Kubernetes shape, values supply release choices, and rendering proves the final objects. -->

A Helm chart has a simple job. It packages a reusable Kubernetes application shape so the team can install and upgrade it with different values in different environments. `Chart.yaml` labels the package. `values.yaml` supplies inputs. The `templates/` folder turns those inputs into Kubernetes objects. Rendering shows the exact YAML before the cluster changes.

For the orders API, those pieces form one release loop. The chart source describes the Deployment and Service pattern. The production values file supplies the approved image, scale, and route choices. Helm renders the final manifest, then the team validates and reviews it before the cluster sees the change. That loop is the habit that keeps a chart from feeling like string substitution.

![Chart review loop showing metadata, values, templates, rendered YAML, lint, and rollback evidence](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/chart-review-loop.png)

*A good chart review moves from package metadata to values, templates, rendered YAML, validation, and rollback evidence.*

The most important habit is to keep chart source connected to rendered output. If a value changes, reviewers should know which Kubernetes field changes. If a template changes, reviewers should inspect the final object. Helm is powerful because it packages Kubernetes applications, but the final review still comes back to plain Kubernetes YAML.

## What's Next

The chart structure is now clear: metadata, values, templates, render checks, validation, helpers, dependencies, and review evidence. The next article goes deeper into values, starting from a few release choices and following each value into the rendered Kubernetes object that actually uses it.

## References

- [Helm Charts](https://helm.sh/docs/topics/charts/) - Official Helm documentation for chart structure, `Chart.yaml`, templates, values, chart types, dependencies, and schema files.
- [Helm Chart Template Guide](https://helm.sh/docs/chart_template_guide/) - Official guide to Helm templates, values, functions, pipelines, named templates, and debugging.
- [helm template](https://helm.sh/docs/helm/helm_template/) - Official command reference for rendering chart templates locally.
- [helm lint](https://helm.sh/docs/helm/helm_lint/) - Official command reference for checking chart structure and template rendering problems.
- [Helm Dependency Commands](https://helm.sh/docs/helm/helm_dependency/) - Official command family for updating and building chart dependencies.
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official Kubernetes documentation for Deployment behavior, selectors, Pod templates, and rollout status.
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Official Kubernetes guide for stable access to Pods through selectors and ports.
- [Recommended Kubernetes Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/) - Official guidance for shared `app.kubernetes.io/*` labels.
- [kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/) - Official command reference for applying manifests and using server-side dry run.
