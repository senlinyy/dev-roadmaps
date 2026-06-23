---
title: "Helm Charts"
description: "Read and build Helm charts that render predictable Kubernetes manifests for an application."
overview: "A Helm chart is a packaged set of Kubernetes templates plus metadata. This article shows how `devpolaris-orders-api` becomes a chart while keeping the rendered Deployment and Service easy to inspect."
tags: ["helm", "charts", "templates", "kubernetes"]
order: 2
id: article-containers-orchestration-kubernetes-packaging-helm-charts
---

## Table of Contents

1. [What A Helm Chart Does](#what-a-helm-chart-does)
2. [The Smallest Chart Directory](#the-smallest-chart-directory)
3. [Chart.yaml, Values, And Release Inputs](#chartyaml-values-and-release-inputs)
4. [Deployment And Service Templates](#deployment-and-service-templates)
5. [Helpers For Names And Labels](#helpers-for-names-and-labels)
6. [ConfigMaps And Optional Routing](#configmaps-and-optional-routing)
7. [Linting And Rendering Checks](#linting-and-rendering-checks)
8. [Debugging Broken Templates](#debugging-broken-templates)
9. [Dependencies And Release Boundaries](#dependencies-and-release-boundaries)
10. [A Chart Review Walkthrough](#a-chart-review-walkthrough)
11. [What's Next](#whats-next)

## What A Helm Chart Does
<!-- section-summary: A Helm chart packages Kubernetes templates, default values, and metadata so a team can render predictable application manifests. -->

A **Helm chart** is a directory that contains Kubernetes templates, default values, metadata, and optional packaged dependencies. Helm reads those files, fills the templates with values, and renders normal Kubernetes YAML. Helm can also install or upgrade the rendered objects as a named release, which gives operators release history and rollback commands.

In the previous article, the orders team learned the most important packaging habit: render before apply. Now they want to package `devpolaris-orders-api` as a chart because several services in the company share the same basic shape. Each API needs a Deployment, a Service, labels, readiness probes, resource requests, a ConfigMap, and sometimes an Ingress or Gateway route.

The chart should help the team repeat that shape without copying a full manifest for every environment. Staging can pass one replica and a staging hostname. Production can pass three replicas and the public hostname. Both environments should still render a clear Deployment and Service that a reviewer can inspect without reading every template trick in Helm.

The chart acts like a small product for the teammates who review and operate the service. The output needs to stay boring in the best way: predictable names, stable labels, obvious image tags, and values files that explain the environment choices. If a chart saves typing but makes the rendered YAML hard to understand, the team has traded one maintenance problem for another.

## The Smallest Chart Directory
<!-- section-summary: A beginner-friendly chart uses metadata, defaults, helpers, and a few templates that match the application release. -->

Helm recognizes a chart through its directory layout. The useful beginner version has `Chart.yaml`, `values.yaml`, and a `templates/` directory. Template files under `templates/` render Kubernetes objects, while helper files such as `_helpers.tpl` define snippets that other templates can include.

For `devpolaris-orders-api`, the first useful chart can look like this. The directory mirrors the application pieces the team already reviews in raw YAML.

```
charts/orders-api/
  Chart.yaml
  values.yaml
  templates/
    _helpers.tpl
    configmap.yaml
    deployment.yaml
    service.yaml
    ingress.yaml
```

`Chart.yaml` describes the package itself. `values.yaml` provides default input values that make the chart render without extra files. The `templates/` directory holds the Kubernetes objects the chart produces. A file name beginning with `_`, such as `_helpers.tpl`, gives Helm reusable template definitions rather than a standalone manifest.

This small layout gives a junior engineer a fair chance at review. They can open `values.yaml` to see the knobs, open `deployment.yaml` to see where those knobs land, and render the chart to inspect the final object. A larger chart may need more files later, but the first version should earn trust before it grows.

Some generated charts include many optional templates, notes, tests, and helper patterns. Those can teach useful Helm features, yet they can also distract from the application the team actually runs. For the orders API, the first review should care about the Deployment, Service, ConfigMap, and route. Everything else can wait until a production need appears.

![Small Helm chart directory showing Chart.yaml, values.yaml, templates, helpers, Deployment, and Service output](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/small-helm-chart.png)

*A beginner-friendly chart keeps the source layout close to the Kubernetes objects the team already understands and reviews.*

## Chart.yaml, Values, And Release Inputs
<!-- section-summary: Chart metadata identifies the package, while values files carry the release choices that change between environments. -->

`Chart.yaml` is the chart metadata file. It names the chart, describes the package, declares the chart type, and carries the chart version. It can also include `appVersion`, which gives humans and tooling a convenient application version label.

Here is a small metadata file for the orders API chart. The file identifies the package before Helm reads any templates.

```yaml
apiVersion: v2
name: orders-api
description: Helm chart for devpolaris-orders-api
type: application
version: 0.1.0
appVersion: "2026.05.07"
```

The chart `version` should change when the chart package changes. A template fix, a values schema change, or a new chart dependency deserves a chart version bump. The `appVersion` field can record the application release, and the container image changes only when the template reads that field or another image value.

The image tag should usually appear as an explicit value. That choice keeps the rendered Deployment honest, because reviewers can trace the image from the values file into the final manifest.

```yaml
# values.yaml
replicaCount: 2

image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.05.07"
  pullPolicy: IfNotPresent

service:
  port: 80
  targetPort: 8080

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    memory: 256Mi
```

Environment values then override the defaults. Production can set a different replica count, hostname, or image tag while the template structure stays the same.

```yaml
# environments/prod.values.yaml
replicaCount: 3

image:
  tag: "2026.05.07"

ingress:
  enabled: true
  host: orders.devpolaris.example
```

Helm accepts values from files with `-f` or `--values`, and later files take priority over earlier ones. That matters in real CI because a command such as `helm template orders ./charts/orders-api -f values.yaml -f environments/prod.values.yaml` gives production values the final say for keys that appear in both files.

## Deployment And Service Templates
<!-- section-summary: Templates combine Kubernetes YAML with Helm expressions, so reviewers should inspect both the source template and the rendered object. -->

A **template** is Kubernetes YAML with Helm expressions inside `{{ ... }}`. Helm uses Go templates, and the current template context appears as a dot, written as `.`. A value such as `.Values.replicaCount` reads the `replicaCount` key from the merged values.

Here is a compact Deployment template for the orders API. It uses values for the image, port, replicas, and resources, while helpers provide names and labels.

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
      {{- include "orders-api.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "orders-api.selectorLabels" . | nindent 8 }}
    spec:
      containers:
        - name: api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.service.targetPort }}
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

The matching Service template should use the same selector helper. This keeps traffic routing tied to the Pod labels that the Deployment creates.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "orders-api.fullname" . }}
  labels:
    {{- include "orders-api.labels" . | nindent 4 }}
spec:
  selector:
    {{- include "orders-api.selectorLabels" . | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.service.port }}
      targetPort: http
```

The template source tells reviewers how the chart works. The rendered manifest tells reviewers what Kubernetes receives. A healthy review uses both views because a neat template can still render surprising YAML when values change.

Selectors deserve extra attention. A Deployment selector links the Deployment to its Pods, and Kubernetes treats selector changes carefully after creation. A Service selector controls which Pods receive traffic. Chart helpers should keep those labels stable unless the team plans a deliberate migration.

![Template to objects flow showing Helm templates and values rendering Deployment, Service, and ConfigMap objects with selector and label checks](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/template-to-objects.png)

*The template source explains how the chart works, while the rendered objects prove which Kubernetes fields will actually change.*

## Helpers For Names And Labels
<!-- section-summary: Helper templates keep repeated names and labels consistent across objects, especially where selectors and metadata must line up. -->

**Named helpers** are reusable template snippets. Helm charts usually place them in `_helpers.tpl`, and templates call them with `include`. Helpers work especially well for object names and labels because those values appear in several manifests and need consistent spelling.

For the orders API, the helper file can define a short app name, a release-scoped full name, common labels, and selector labels. Those helpers keep the Deployment, Service, ConfigMap, and route speaking the same naming language.

```yaml
{{- define "orders-api.name" -}}
devpolaris-orders-api
{{- end -}}

{{- define "orders-api.fullname" -}}
{{ .Release.Name }}-devpolaris-orders-api
{{- end -}}

{{- define "orders-api.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/name: {{ include "orders-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: devpolaris
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "orders-api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "orders-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
```

The Kubernetes recommended labels use the `app.kubernetes.io` prefix so tools can query and group application resources in a common way. Helm commonly fills `app.kubernetes.io/managed-by` with the release service and `app.kubernetes.io/instance` with the release name. Those labels help operators find every object connected to one release.

Helpers should stay focused. Names, labels, and small repeated metadata snippets make good helper content. Probes, environment variables, resources, and routing behavior usually deserve visible template sections because reviewers need to see how the workload runs.

The `nindent` function in the examples matters because YAML cares about spaces. It inserts a newline and indents the included helper output so the rendered labels land under the correct parent key. A missing `nindent` often creates the first confusing Helm error a beginner sees.

## ConfigMaps And Optional Routing
<!-- section-summary: Charts should expose environment configuration and optional routes through values while keeping rendered objects straightforward. -->

The orders API also needs plain environment configuration. A **ConfigMap** stores non-secret key-value data that Pods can read through environment variables or mounted files. The chart can render a ConfigMap from values, then the Deployment can load it with `envFrom`.

```yaml
# values.yaml
config:
  LOG_LEVEL: info
  CHECKOUT_TIMEOUT_MS: "1500"
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "orders-api.fullname" . }}
  labels:
    {{- include "orders-api.labels" . | nindent 4 }}
data:
  {{- range $key, $value := .Values.config }}
  {{ $key }}: {{ $value | quote }}
  {{- end }}
```

```yaml
envFrom:
  - configMapRef:
      name: {{ include "orders-api.fullname" . }}
```

Secrets need a different path. Plain Helm values files often live in Git, so they should not hold database passwords, API tokens, or private keys. Real teams usually pair charts with a secret management flow such as External Secrets, Sealed Secrets, SOPS, a cloud secret manager, or a platform-owned secret injection process. The chart can reference a Secret name while the secret value lives in the approved secret system.

Routing also belongs behind an explicit value. Many internal environments do not need an Ingress, while staging and production often do. The chart can render the Ingress only when `ingress.enabled` has a true value.

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "orders-api.fullname" . }}
  labels:
    {{- include "orders-api.labels" . | nindent 4 }}
spec:
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "orders-api.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
{{- end }}
```

Optional templates need realistic CI coverage. A chart that renders cleanly with `ingress.enabled: false` can still fail when production turns ingress on. The CI matrix should render the chart with staging and production values so every enabled path has a real example.

## Linting And Rendering Checks
<!-- section-summary: Helm lint catches chart issues, while helm template proves the Kubernetes YAML for each environment. -->

`helm lint` examines a chart for possible issues. The official command reference says the linter runs tests to verify that the chart has a well-formed structure and reports errors or warnings. It gives every pull request a fast mechanical check before the team looks at rendered output.

```bash
$ helm lint ./charts/orders-api
==> Linting ./charts/orders-api
[INFO] Chart.yaml: icon is recommended

1 chart(s) linted, 0 chart(s) failed
```

Rendering comes next. `helm template` renders chart templates locally and displays the generated YAML. Cluster-aware checks still matter because local rendering cannot confirm every API kind against the target production cluster.

```bash
$ helm template orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml \
  > rendered/prod.yaml
```

The team can inspect the rendered file directly. In a pull request, a short grep or summary helps reviewers focus on the high-risk fields before opening the full manifest.

```bash
$ grep -n "kind:\\|name:\\|replicas:\\|image:\\|readinessProbe:\\|host:" rendered/prod.yaml
2:kind: ConfigMap
4:  name: orders-devpolaris-orders-api
20:kind: Service
22:  name: orders-devpolaris-orders-api
38:kind: Deployment
40:  name: orders-devpolaris-orders-api
47:  replicas: 3
70:          image: "ghcr.io/devpolaris/orders-api:2026.05.07"
78:          readinessProbe:
111:  - host: "orders.devpolaris.example"
```

When CI can reach a Kubernetes API server, `kubectl apply --dry-run=server -f rendered/prod.yaml` asks the server to validate the request without persisting the resources. `kubectl diff -f rendered/prod.yaml` then compares the proposed configuration with live objects. Those two commands catch different problems: admission and schema issues in one case, unexpected live changes in the other.

## Debugging Broken Templates
<!-- section-summary: Template failures usually make more sense after the team renders with debug output and reads the generated YAML around the error. -->

The first painful Helm error often involves YAML indentation. Helm can produce a YAML file that Kubernetes cannot parse when a helper, range, or conditional lands at the wrong indentation level. The source template may look close, while the generated file places labels or fields under the wrong parent key.

Here is a realistic failure from the orders chart. The command fails before anything reaches the cluster, which is exactly where the team wants to catch template errors.

```bash
$ helm template orders ./charts/orders-api -f environments/prod.values.yaml
Error: YAML parse error on orders-api/templates/deployment.yaml:
error converting YAML to JSON: yaml: line 9: did not find expected key
```

Debug output helps because Helm prints more context around the generated manifest. The extra output usually points at the rendered YAML shape, not just the template line number.

```bash
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  --debug

Error: YAML parse error on orders-api/templates/deployment.yaml:
  labels:
app.kubernetes.io/name: devpolaris-orders-api
    app.kubernetes.io/instance: orders
```

The labels escaped the `metadata.labels` indentation. The helper call needs `nindent 4` under `metadata.labels`, or `nindent 8` under `template.metadata.labels`, depending on the parent key.

```yaml
metadata:
  labels:
    {{- include "orders-api.labels" . | nindent 4 }}
```

After the template renders again, the team should inspect the rendered YAML instead of stopping at a green command. A passing render can still show an unexpected name, missing ConfigMap key, or selector mismatch. The best debugging loop goes from template source, to rendered YAML, to Kubernetes validation, then to live rollout checks.

## Dependencies And Release Boundaries
<!-- section-summary: Chart dependencies work well for shared chart building blocks, but production data stores and independent systems usually need their own release lifecycle. -->

Helm charts can declare dependencies in `Chart.yaml`. A dependency can bring in another chart from a repository, and Helm can place packaged dependencies under the chart's `charts/` directory after dependency commands run. This feature helps when the application chart needs a shared helper chart, a standard sidecar chart, or a local development dependency.

Here is a small dependency example for a shared internal helper chart. The dependency belongs in `Chart.yaml`, and the chart dependency commands can place the packaged dependency under `charts/` before rendering.

```yaml
dependencies:
  - name: common-http-api
    version: 1.4.2
    repository: https://charts.devpolaris.example/platform
```

This dependency makes sense if `common-http-api` provides shared labels, common HTTP defaults, or library-chart helpers that do not own a separate production lifecycle. It gives platform engineers one place to improve repeated chart patterns while service teams keep their application values small.

A PostgreSQL database dependency for production needs a different discussion. The orders API uses a database, but the production database has backups, restore testing, network policy, access control, storage upgrades, and its own incident response path. Rolling back the API release should not roll back the database release. That lifecycle difference usually means the database deserves its own chart release or another infrastructure management path.

Local development can make a different choice. A disposable preview environment might install an ephemeral PostgreSQL child chart because the whole environment can disappear after a branch closes. Production needs a stricter boundary because the data outlives one API release.

The rollback question gives reviewers a useful test. If `helm rollback orders 41` should only change the orders API workload, the chart should focus on that workload. If another component needs a separate approval, backup story, or rollback decision, that component should live outside the orders API chart.

## A Chart Review Walkthrough
<!-- section-summary: A chart review follows metadata, values, templates, rendered output, validation, and rollback evidence. -->

A chart review should follow the same path Helm follows. The reviewer reads metadata, reads values, checks the templates that changed, renders the chart, and inspects the final Kubernetes objects. This order keeps the conversation grounded in both source intent and cluster output.

For `devpolaris-orders-api`, a production review can use this checklist. It gives the reviewer a path from package metadata to the exact Kubernetes objects.

| Review step | What the reviewer checks |
|---|---|
| `Chart.yaml` | Chart version, chart type, and new dependencies |
| `values.yaml` | Defaults, value names, and safe behavior without environment overrides |
| `environments/prod.values.yaml` | Production replica count, image tag, hostname, resources, and enabled options |
| `templates/deployment.yaml` | Where values land in the Pod, probes, resources, env, and selectors |
| `templates/service.yaml` | Service port and selector labels |
| `templates/configmap.yaml` | Plain config keys and quoting |
| `rendered/prod.yaml` | Final Kubernetes objects that production will receive |

The rendered evidence should make the release easy to explain. A reviewer should see a concise summary and have access to the full rendered file.

```bash
$ helm template orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml \
  | grep -n "kind:\\|name:\\|replicas:\\|image:\\|readinessProbe:\\|host:"
2:kind: ConfigMap
4:  name: orders-devpolaris-orders-api
20:kind: Service
22:  name: orders-devpolaris-orders-api
38:kind: Deployment
40:  name: orders-devpolaris-orders-api
47:  replicas: 3
70:          image: "ghcr.io/devpolaris/orders-api:2026.05.07"
78:          readinessProbe:
111:  - host: "orders.devpolaris.example"
```

A strong pull request description then connects source changes to output changes. This keeps the discussion about the rendered release, not only the files that changed.

```
Chart review: devpolaris-orders-api

Package source:
- Chart version changes from 0.1.0 to 0.1.1
- Deployment template adds explicit resources from values
- Production values keep replicas at 3 and image tag at 2026.05.07

Rendered production output:
- Deployment image stays ghcr.io/devpolaris/orders-api:2026.05.07
- Resource requests appear on the API container
- Service selector stays app.kubernetes.io/name=devpolaris-orders-api
- Ingress host stays orders.devpolaris.example

Validation:
- helm lint passed
- helm template passed for staging and production
- kubectl diff shows only Deployment container resources
- server-side dry run passed against the production API server
```

This review style catches chart surprises before the release. If a template change meant to add resources also changes selectors, names, namespaces, or route hosts, the rendered output will show it. The team can split the pull request, adjust the template, or add a migration plan before production traffic depends on the change.

![Chart review loop showing metadata, values, templates, rendered YAML, lint, and rollback evidence](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/chart-review-loop.png)

*A practical chart review moves through source intent, rendered evidence, validation, and rollback context instead of trusting the package layer by itself.*

## What's Next

Helm gives the orders API team a structured package with templates, values, helpers, checks, dependencies, and review evidence. The module continues by comparing this approach with Kustomize overlays, then later returns to a larger design question: how teams keep templates useful without letting them spread into a confusing second application.

---

**References**

- [Helm Charts](https://helm.sh/docs/topics/charts/) - Official Helm chart documentation for chart structure, `Chart.yaml`, templates, values, chart types, and dependencies.
- [Helm Chart Template Guide](https://helm.sh/docs/chart_template_guide/) - Official guide to Helm's template language, values, functions, pipelines, named templates, and debugging.
- [helm template](https://helm.sh/docs/helm/helm_template/) - Official command reference for rendering chart templates locally and displaying the generated manifests.
- [helm lint](https://helm.sh/docs/helm/helm_lint/) - Official command reference for checking chart structure and template issues.
- [helm upgrade](https://helm.sh/docs/helm/helm_upgrade/) - Official command reference for release upgrades, values precedence, dry-run output, and generated manifests.
- [Helm Dependency Commands](https://helm.sh/docs/helm/helm_dependency/) - Official command family for managing chart dependencies.
- [Recommended Kubernetes Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/) - Official Kubernetes guidance for shared `app.kubernetes.io/*` labels across application resources.
- [kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/) - Official command reference documenting file-based apply and `--dry-run=server`.
- [kubectl diff](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/) - Official command reference for comparing live resources with would-be applied manifests.
