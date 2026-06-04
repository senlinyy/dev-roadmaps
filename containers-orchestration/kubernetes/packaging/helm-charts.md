---
title: "Helm Charts"
description: "Read and build Helm charts that render predictable Kubernetes manifests for an application."
overview: "A Helm chart is a packaged set of Kubernetes templates plus metadata. This article shows how `devpolaris-orders-api` becomes a chart while keeping the rendered Deployment and Service easy to inspect."
tags: ["helm", "charts", "templates", "kubernetes"]
order: 2
id: article-containers-orchestration-kubernetes-packaging-helm-charts
---

## Table of Contents

1. [From Manifests to a Chart](#from-manifests-to-a-chart)
2. [The Smallest Useful Chart Directory](#the-smallest-useful-chart-directory)
3. [Chart.yaml and Application Metadata](#chartyaml-and-application-metadata)
4. [Templates Produce Kubernetes Objects](#templates-produce-kubernetes-objects)
5. [Named Helpers Keep Labels Consistent](#named-helpers-keep-labels-consistent)
6. [Rendering and Linting a Chart](#rendering-and-linting-a-chart)
7. [Failure Mode: A Template Renders Broken YAML](#failure-mode-a-template-renders-broken-yaml)
8. [What Belongs in a Chart](#what-belongs-in-a-chart)
9. [Chart Dependencies and Boundaries](#chart-dependencies-and-boundaries)
10. [A Chart Review Walkthrough](#a-chart-review-walkthrough)

## From Manifests to a Chart

A Helm chart is a directory that contains Kubernetes manifest templates, default values, and chart metadata. Helm renders the templates into normal Kubernetes YAML, then can install or upgrade those objects as a named release.

The reason charts exist is repetition. If every service in a platform needs a Deployment, Service, resource requests, probes, labels, and optional ingress, copying full YAML into every repository creates drift. A chart lets the platform team define the repeatable shape once while each service supplies values.

For `devpolaris-orders-api`, the first chart will package a Deployment and a Service. Later, values will control the image tag, replica count, port, and resource requests. The goal is to make the common shape consistent while preserving a clear rendered manifest.

## The Smallest Useful Chart Directory

A chart directory is a filesystem layout Helm understands. It contains chart metadata, default values, and templates that generate Kubernetes objects.

![Helm chart directory map showing Chart.yaml, values.yaml, templates, helpers, README, and rendered YAML](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/chart-directory-map.png)

*A chart is a small package that turns templates and values into Kubernetes objects.*


Example: the first orders API chart can have `Chart.yaml`, `values.yaml`, a Deployment template, and a Service template. Helm recognizes some names, and the `templates/` directory is where Kubernetes objects are generated.

```text
charts/orders-api/
  Chart.yaml
  values.yaml
  templates/
    _helpers.tpl
    deployment.yaml
    service.yaml
```

`Chart.yaml` describes the chart. `values.yaml` provides defaults. Files under `templates/` are processed by Helm's template engine. Files beginning with an underscore, such as `_helpers.tpl`, define reusable snippets rather than standalone Kubernetes objects.

That structure is small enough for a junior engineer to inspect. If a first chart already has twenty helper files and five layers of indirection, review becomes harder than copied YAML. Start with the objects the app actually needs.

You may also see a `charts/` directory inside a chart. That directory holds packaged chart dependencies. A beginner-owned application chart often does not need it at first. Leave it out until there is a real dependency to manage.

```text
Not needed in the first orders-api chart

charts/
  postgresql-12.1.4.tgz
  redis-18.3.0.tgz
```

Those archives would make the API release responsible for database or cache lifecycle. That may be appropriate in a disposable local environment, but it is usually the wrong boundary for production.

## Chart.yaml and Application Metadata

`Chart.yaml` is the chart metadata file. It gives Helm enough information to identify the package, but it is not the same thing as the container image version.

Example: chart version `0.1.0` can describe the package structure, while app version `2026.05.07` describes the application release the chart commonly deploys. The actual Deployment image still comes from templates and values.

```yaml
apiVersion: v2
name: orders-api
description: Helm chart for devpolaris-orders-api
type: application
version: 0.1.0
appVersion: "2026.05.07"
```

The `apiVersion: v2` field means this is the current chart format used by Helm 3. The `type: application` field tells readers that this chart deploys an application, not a reusable library chart. The `version` field should change when the chart package changes. The `appVersion` field is information for humans and tooling, but the image tag still comes from templates and values.

One common mistake is to bump `appVersion` and assume the Deployment image changed. It does not unless the template uses that value. Prefer an explicit image value so the rendered manifest tells the truth.

## Templates Produce Kubernetes Objects

A Helm template is Kubernetes YAML plus placeholders that Helm fills from release data and values. Helm uses Go templates, so placeholders appear inside `{{ ... }}`.

![Helm render path showing chart, values, template engine, rendered YAML, and Kubernetes API](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/helm-render-path.png)

*Helm templates are only useful if the rendered YAML is clear enough to review.*


Example: `.Values.replicaCount` can render into `spec.replicas: 3` for production and `spec.replicas: 1` for staging. The rendered output should be valid YAML after those placeholders are replaced.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "orders-api.fullname" . }}
  labels:
    {{- include "orders-api.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ include "orders-api.name" . }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {{ include "orders-api.name" . }}
    spec:
      containers:
        - name: api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports:
            - containerPort: {{ .Values.service.port }}
```

The dot, written as `.`, is the current template context. `.Values.replicaCount` reads the `replicaCount` key from `values.yaml` or from a values file passed at install time. `include` calls a named helper.

Here is the matching default values file:

```yaml
replicaCount: 2

image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.05.07"

service:
  port: 8080
```

The important review habit is to read both the template and the rendered Deployment. Template source explains how the package works. Rendered YAML proves what Kubernetes will receive.

When you are learning a chart, render one object at a time mentally. Start with the `metadata.name`, then labels, then selectors, then the Pod template. If those pieces make sense, the rest of the workload is easier to inspect.

```text
Deployment fields to verify first

metadata.name:
  The object name that operators query.

spec.selector.matchLabels:
  The labels the Deployment uses to own Pods.

template.metadata.labels:
  The labels placed on each Pod.

containers[0].image:
  The image Kubernetes pulls for the API container.
```

Selectors deserve special attention because they are hard to change safely after a Deployment exists. A chart helper that keeps selector labels stable is doing useful work.

## Named Helpers Keep Labels Consistent

Named helpers are reusable template snippets, often used for names and labels that must stay identical across objects. They reduce copy mistakes in places where a small mismatch breaks behavior.

Example: a Service selector must match Pod labels exactly. If one template spells the app label differently from another template, traffic can disappear even when Pods are healthy.

Helm helpers reduce that risk by putting repeated names and labels in one place.

```yaml
{{- define "orders-api.name" -}}
devpolaris-orders-api
{{- end -}}

{{- define "orders-api.fullname" -}}
{{ .Release.Name }}-devpolaris-orders-api
{{- end -}}

{{- define "orders-api.labels" -}}
app.kubernetes.io/name: {{ include "orders-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
```

The helper file can look strange at first because it is template code, not Kubernetes YAML. Its job is to make the actual YAML boring and consistent. Use helpers for names and labels that must match across objects. Avoid helpers that hide important workload behavior such as probes, resources, or environment variables.

## Rendering and Linting a Chart

Rendering prints the Kubernetes YAML that Helm will send to the cluster. Linting checks the chart source for common chart and template mistakes. Run both before installing so indentation errors, missing values, and malformed objects are caught while the change is still easy to fix.

```bash
$ helm template orders ./charts/orders-api --namespace devpolaris-staging
---
# Source: orders-api/templates/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-devpolaris-orders-api
```

`helm lint` checks chart structure and common template issues. It gives pull requests a useful mechanical check before Kubernetes admission testing.

```bash
$ helm lint ./charts/orders-api
==> Linting ./charts/orders-api
[INFO] Chart.yaml: icon is recommended

1 chart(s) linted, 0 chart(s) failed
```

After rendering, pipe the output into `kubectl diff` when you have cluster access.

```bash
$ helm template orders ./charts/orders-api -f values-staging.yaml | kubectl diff -n devpolaris-staging -f -
```

That command compares rendered output with live objects. It helps separate chart rendering problems from cluster apply problems.

For shared charts, add rendering to CI with at least one realistic values file. A chart that renders only with empty defaults may still fail when production values enable ingress, resources, or extra environment variables.

```text
Chart CI matrix

lint:
  helm lint ./charts/orders-api

render-staging:
  helm template orders ./charts/orders-api -f environments/staging.values.yaml

render-prod:
  helm template orders ./charts/orders-api -f environments/prod.values.yaml
```

This is a cheap check. It does not prove the app works, but it catches broken templates before a release command reaches the cluster.

## Failure Mode: A Template Renders Broken YAML

YAML uses indentation to decide which fields belong together, and Helm templates can change that indentation while they render. Suppose a helper is inserted without the right spacing. The chart source looks reasonable, but rendering produces invalid YAML.

```bash
$ helm template orders ./charts/orders-api
Error: YAML parse error on orders-api/templates/deployment.yaml:
error converting YAML to JSON: yaml: line 9: did not find expected key
```

Now render with debug output so Helm prints the generated content around the failure.

```bash
$ helm template orders ./charts/orders-api --debug
install.go:214: [debug] Original chart version: ""
Error: YAML parse error on orders-api/templates/deployment.yaml:
  labels:
app.kubernetes.io/name: devpolaris-orders-api
    app.kubernetes.io/instance: orders
```

The label block lost its indentation. The fix is usually to use `nindent`, which adds a newline and indents the included text.

```yaml
labels:
  {{- include "orders-api.labels" . | nindent 4 }}
```

After the fix, render again and inspect the actual YAML. Do not stop at "the command passed." Check the fields that connect objects, especially labels and selectors.

## What Belongs in a Chart

A chart boundary is the line between reusable application shape and one environment's deployment choice. For `devpolaris-orders-api`, the chart might include the Deployment, Service, ConfigMap shape, default probes, default resources, and optional ingress. It should not include environment-specific secrets or one-off production edits hidden deep in templates.

There is a real tradeoff here. A shared chart gives consistency across services, but a chart that accepts every possible knob becomes a second programming language. A service-owned chart gives app teams control, but repeated patterns can drift across repositories.

Use this rule when deciding what to put in the chart: if the setting is part of how this class of service should run, it belongs in the chart. If the setting is a deployment choice for one environment, it probably belongs in values. If the setting is secret, it belongs outside both chart source and plain values files unless your secret management flow encrypts it safely.

## Chart Dependencies and Boundaries

Helm charts can depend on other charts. That is useful when an application package needs a standard sidecar, a common exporter, or a dependency that is managed as a chart. Use this carefully. A dependency should make the release easier to operate, not quietly install a database that nobody expected.

For `devpolaris-orders-api`, the API chart should not install the production PostgreSQL database as a child chart. The database has a different lifecycle, backup policy, access model, and failure impact. If rolling back the API should not roll back the database, the database does not belong inside the API release.

```yaml
dependencies:
  - name: common-http-api
    version: 1.4.2
    repository: https://charts.devpolaris.example/platform
```

That dependency shape can be reasonable if `common-http-api` is a library chart or a shared helper chart that standardizes labels and template fragments. It is more risky if the dependency creates real infrastructure that should be owned separately.

A useful boundary test is to ask what should happen during rollback. If `helm rollback orders 4` should change only the API workload, keep the chart focused on the API workload. If a component needs its own rollback decision, give it its own release or manage it through another system.

## A Chart Review Walkthrough

A chart review should follow the path from source to rendered object. Start with `Chart.yaml` to see whether the chart package changed. Then read `values.yaml` and the environment values file to understand inputs. Then read the relevant templates. Finally, inspect the rendered YAML.

```text
Review order for orders-api chart

1. Chart.yaml
   Check chart version and chart type.

2. values.yaml
   Check defaults and whether new values are documented by shape.

3. environments/prod.values.yaml
   Check release decisions for production.

4. templates/deployment.yaml
   Check where values land in the workload.

5. rendered/prod.yaml
   Check the final Deployment, Service, ConfigMap, and Ingress.
```

Here is the kind of rendered evidence a reviewer should look for before approving:

```bash
$ helm template orders ./charts/orders-api -f environments/prod.values.yaml \
  | grep -n "kind:\\|name:\\|replicas:\\|image:\\|readinessProbe:"
2:kind: Service
4:  name: orders-devpolaris-orders-api
18:kind: Deployment
20:  name: orders-devpolaris-orders-api
27:  replicas: 3
51:          image: "ghcr.io/devpolaris/orders-api:2026.05.07"
57:          readinessProbe:
```

If the source says the release is only an image update but the rendered output changes selectors, probes, ports, or namespaces, pause the review. Either the chart changed more than the author realized, or the pull request description is incomplete.


![Helm chart summary covering Chart.yaml, values, templates, helpers, lint, and render](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/helm-chart-summary.png)

*Use this checklist when building a chart that teammates can safely review.*

---

**References**

- [Helm Charts](https://helm.sh/docs/topics/charts/) - Official chart structure reference, including `Chart.yaml`, templates, and chart types.
- [Helm Chart Template Guide](https://helm.sh/docs/chart_template_guide/) - Official guide to Helm's template language and rendering behavior.
- [Helm Lint](https://helm.sh/docs/helm/helm_lint/) - Official command reference for checking chart structure and template issues.
- [Recommended Kubernetes Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/) - Official Kubernetes guidance for labels that make app objects easier to query and manage.
