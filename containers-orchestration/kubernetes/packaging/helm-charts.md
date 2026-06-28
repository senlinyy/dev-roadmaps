---
title: "Helm Charts"
description: "Read and build Helm charts that render predictable Kubernetes manifests for an application."
overview: "A Helm chart is a packaged set of Kubernetes templates plus metadata. This article packages `devpolaris-orders-api` as a chart while keeping the rendered Deployment and Service easy to inspect."
tags: ["helm", "charts", "templates", "kubernetes"]
order: 2
id: article-containers-orchestration-kubernetes-packaging-helm-charts
---

## Table of Contents

1. [A Chart Is An Application Package](#a-chart-is-an-application-package)
2. [Start With The Smallest Chart](#start-with-the-smallest-chart)
3. [Chart.yaml Describes The Package](#chartyaml-describes-the-package)
4. [values.yaml Gives The Chart Inputs](#valuesyaml-gives-the-chart-inputs)
5. [Templates Render Kubernetes Objects](#templates-render-kubernetes-objects)
6. [Helpers Keep Names And Labels Consistent](#helpers-keep-names-and-labels-consistent)
7. [Rendering, Linting, And Debugging](#rendering-linting-and-debugging)
8. [Dependencies And Subcharts](#dependencies-and-subcharts)
9. [Production Chart Review](#production-chart-review)
10. [What's Next](#whats-next)

## A Chart Is An Application Package
<!-- section-summary: A Helm chart packages templates, values, metadata, and optional dependencies so Helm can render Kubernetes objects for one release. -->

Start with one package folder and one promise: when the package is rendered, reviewers can still see the final Deployment, Service, and ConfigMap. The package can remove repeated YAML, but it should still show the Kubernetes objects the cluster will receive.

A **Helm chart** is an application package for Kubernetes. The chart contains metadata, default inputs, and template files. Helm combines those pieces and renders ordinary Kubernetes YAML. Kubernetes receives Deployments, Services, ConfigMaps, Ingresses, and other API objects.

For `devpolaris-orders-api`, the chart should explain one repeatable application shape.

```
chart source
  Chart.yaml
  values.yaml
  templates/deployment.yaml
  templates/service.yaml
  templates/configmap.yaml

rendered review target
  Deployment/devpolaris-orders-api
  Service/devpolaris-orders-api
  ConfigMap/orders-api-config
```

Staging and production can choose different image tags, replicas, resources, config values, and hostnames while using that shared shape. The chart source gives the team one package, and the rendered output gives reviewers the real Kubernetes objects.

Helm also gives operators a release lifecycle. After install or upgrade, Helm records the release name, namespace, values, rendered manifests, and revision history. This article focuses on the chart source. Later articles cover values and release operations in more detail.

## Start With The Smallest Chart
<!-- section-summary: A beginner-friendly chart starts with a tiny folder, one values file, and one template before adding production detail. -->

Start small. A chart can render many objects, but a beginner should first see the package pieces without a wall of YAML. The first pass can list the Deployment, Service, and ConfigMap templates, then open one template at a time.

```
charts/orders-api/
  Chart.yaml
  values.yaml
  templates/
    deployment.yaml
    service.yaml
    configmap.yaml
```

`Chart.yaml` describes the chart. `values.yaml` provides default inputs. The files under `templates/` describe the Kubernetes objects Helm will render. That is enough to see the Helm loop before adding production detail.

The first default values file can be short.

```yaml
replicaCount: 1
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16-dev"
config:
  logLevel: info
```

The Deployment template can consume the image and replica values in two obvious places.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: orders-api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

Render the chart and inspect the output.

```bash
$ helm template orders ./charts/orders-api
```

The command prints the rendered Kubernetes objects. The first field check is plain: `replicaCount` lands in `spec.replicas`, and the image values land in the container image.

```yaml
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

The same render also includes the Service and ConfigMap once their templates are added.

```
kind: Service
metadata:
  name: devpolaris-orders-api
---
kind: ConfigMap
metadata:
  name: orders-api-config
```

This tiny chart is incomplete for production, but it teaches the core skill. A value changes the rendered output, and the rendered output is what reviewers should inspect.

![Small Helm chart directory showing Chart.yaml, values.yaml, templates, helpers, Deployment, and Service output](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/small-helm-chart.png)

*A beginner-friendly chart keeps the source layout close to the Kubernetes objects the team already understands and reviews.*

## Chart.yaml Describes The Package
<!-- section-summary: Chart.yaml names the chart, version, application version, chart type, and optional dependencies. -->

`Chart.yaml` is the chart metadata file. It tells Helm the chart name, chart version, application version, package type, and optional dependency list. Think of it as the label on the package, not the Kubernetes workload itself.

For the orders API, a small `Chart.yaml` can look like this.

```yaml
apiVersion: v2
name: orders-api
description: Helm chart for devpolaris-orders-api
type: application
version: 0.1.0
appVersion: "2026.06.16.1"
```

`version` is the chart package version. Teams bump it when the chart source changes, such as a template update or a new default value. `appVersion` is the application version the chart describes. Many teams set it to the container version for a release, then still keep the actual image tag explicit in values.

That separation helps reviews. A chart version change can say, "the package shape changed." An image tag change can say, "the application build changed." The rendered Deployment shows the result either way.

## values.yaml Gives The Chart Inputs
<!-- section-summary: values.yaml holds default inputs that templates read through .Values. -->

`values.yaml` is the default input file for a chart. A **value** is an input the template reads through `.Values`. Good values describe choices a release owner expects to change, such as image tag, replica count, resource requests, configuration, and route host.

The orders API should not start with a giant values file. Add inputs as the template needs them.

```yaml
replicaCount: 1

image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16-dev"

service:
  port: 80
  targetPort: 8080
```

Now the template can add a Service that consumes the service values. A **Service** gives Pods a stable cluster address and forwards traffic to a target port on matching Pods. In this example, clients call port `80`, and the container listens on `8080`.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: devpolaris-orders-api
spec:
  selector:
    app.kubernetes.io/name: devpolaris-orders-api
  ports:
    - port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.targetPort }}
```

Rendered output lets the reviewer check the contract.

```yaml
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

Values should stay boring and visible. If a value cannot be tied to a specific rendered field, the chart may be growing an option nobody understands or tests.

## Templates Render Kubernetes Objects
<!-- section-summary: A template is a Kubernetes manifest with placeholders, and every placeholder should lead to a reviewable output field. -->

A **template** is a source manifest with placeholders and logic that Helm evaluates. The template can use `.Values`, built-in objects such as `.Release.Name`, and functions from Helm's template language. The final output should still read like Kubernetes YAML.

The orders API Deployment can now reveal more production detail. First add labels and selectors. Labels are key-value pairs on Kubernetes objects. Selectors tell a controller or Service which labels to match.

```yaml
metadata:
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-orders-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: devpolaris-orders-api
```

The labels need to match exactly. The Deployment selector chooses which Pods belong to the Deployment, and the Service selector chooses which Pods receive traffic. A typo in one place can create healthy Pods that receive no traffic.

Next add the container port and readiness probe. A **readiness probe** is a Kubernetes check that tells the Service whether a Pod can receive traffic. For the orders API, `/health/ready` should return success only after the app can answer requests.

```yaml
containers:
  - name: orders-api
    image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
    ports:
      - containerPort: {{ .Values.service.targetPort }}
    readinessProbe:
      httpGet:
        path: /health/ready
        port: {{ .Values.service.targetPort }}
```

Then add resources. A **resource request** tells the scheduler how much CPU and memory the Pod expects. A **resource limit** sets an upper bound for memory or CPU where the team chooses one. Production charts should make these fields visible.

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    memory: 256Mi
```

Rendered YAML is the checkpoint after each step.

```bash
$ helm template orders ./charts/orders-api \
  | grep -E "replicas:|image:|containerPort:|readinessProbe:|cpu:|memory:"
  replicas: 1
          image: ghcr.io/devpolaris/orders-api:2026.06.16-dev
          containerPort: 8080
          readinessProbe:
              cpu: 100m
              memory: 128Mi
              memory: 256Mi
```

![Template to objects flow showing Helm templates and values rendering Deployment, Service, and ConfigMap objects with selector and label checks](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/template-to-objects.png)

*The template source explains how the chart works, while the rendered objects prove which Kubernetes fields will actually change.*

## Helpers Keep Names And Labels Consistent
<!-- section-summary: Named helpers are small reusable snippets for repeated names and labels, especially where exact spelling protects traffic. -->

A **named helper** is a reusable template snippet. Helm charts usually place helpers in `templates/_helpers.tpl`, then templates call them with `include`. Helpers work well for names, common labels, and selector labels that appear in several objects.

The orders API chart can define helper labels once.

```yaml
{{- define "orders-api.selectorLabels" -}}
app.kubernetes.io/name: devpolaris-orders-api
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
```

The Deployment can include those labels under the Pod template.

```yaml
template:
  metadata:
    labels:
      {{- include "orders-api.selectorLabels" . | nindent 6 }}
```

The Service can use the same helper for its selector.

```yaml
spec:
  selector:
    {{- include "orders-api.selectorLabels" . | nindent 4 }}
```

`nindent` inserts a newline and indents the included helper output. YAML uses spaces to define structure, so the indentation decides whether labels land under the right parent key. A helper that renders in the wrong place can create YAML that fails to parse or passes with the wrong shape.

Helpers should stay focused. Names and labels are good helper content. Probes, environment variables, resources, and routing behavior usually deserve visible template sections so reviewers can see how the workload runs.

## Rendering, Linting, And Debugging
<!-- section-summary: Helm review usually runs lint, template render, and debug output before any install or upgrade command. -->

`helm lint` checks a chart for common problems. It catches missing chart metadata, invalid chart structure, and many template rendering issues. A passing lint result still leaves runtime checks for the rollout, but it gives a fast first check.

```bash
$ helm lint ./charts/orders-api
==> Linting ./charts/orders-api
[INFO] Chart.yaml: icon is recommended

1 chart(s) linted, 0 chart(s) failed
```

`helm template` renders the chart locally and prints the generated manifests. Use it any time a values file or template changes.

```bash
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  > rendered/orders-api-prod.yaml
```

A targeted output check can make reviews faster.

```bash
$ grep -n "kind: Deployment\\|replicas:\\|image:\\|kind: Service" rendered/orders-api-prod.yaml
1:kind: Deployment
10:  replicas: 3
33:          image: ghcr.io/devpolaris/orders-api:2026.06.16.1
58:kind: Service
```

When a template fails, `--debug` adds context around the error and rendered fragments.

```bash
$ helm template orders ./charts/orders-api --debug
Error: template: orders-api/templates/deployment.yaml:17:23:
executing "orders-api/templates/deployment.yaml" at <.Values.image.tag>:
nil pointer evaluating interface {}.tag
```

That message points at a missing value path. The fix might be a safer default, a required value message, or a schema rule. The next article goes deeper into values and validation.

## Dependencies And Subcharts
<!-- section-summary: Dependencies let a chart reference other charts, but production teams should use them only where lifecycle ownership is clear. -->

A **chart dependency** is another chart listed under `dependencies` in `Chart.yaml`. Helm can download those dependencies and render them with the parent chart. This is useful for software that ships as a group of related Kubernetes objects.

Here is a small dependency entry.

```yaml
dependencies:
  - name: common-http-api
    version: 1.4.0
    repository: oci://ghcr.io/devpolaris/charts
```

Dependencies need an ownership decision. A shared helper chart for common labels or policy snippets can fit a platform workflow. A production database dependency inside the API chart usually creates a risky lifecycle coupling, since the database outlives one application release.

Local development can make a different choice. A disposable preview environment might install an ephemeral PostgreSQL child chart so the whole environment can disappear after the branch closes. Production needs a stricter boundary around persistent data, backups, upgrades, and access control.

Run `helm dependency update` when dependencies change.

```bash
$ helm dependency update ./charts/orders-api
Saving 1 charts
Downloading common-http-api from repo oci://ghcr.io/devpolaris/charts
Deleting outdated charts
```

The review should include `Chart.lock` and any downloaded or vendored dependency policy the team uses. The rendered YAML still decides what Kubernetes will receive.

## Production Chart Review
<!-- section-summary: A chart review connects source changes, rendered output, validation, and rollback evidence before the release starts. -->

A **chart review** checks the package source and the rendered Kubernetes output. Source review answers, "Did the chart structure change in a clear way?" Rendered review answers, "What will the cluster receive?"

For the orders API, a strong pull request note can stay concrete.

```yaml
Change:
  chart: orders-api
  chartVersion: 0.1.1
  applicationImage: ghcr.io/devpolaris/orders-api:2026.06.16.1
RenderedEvidence:
  - Deployment replicas stay 3 in production
  - Service selector matches Pod labels
  - Ingress host stays orders.devpolaris.example
Validation:
  - helm lint passed
  - helm template passed for staging and production
  - kubectl diff shows only image and resources
Rollback:
  - previous chart artifact remains available
  - previous rendered manifest is attached
```

Reviewers should spend extra time on names, namespaces, selector labels, Service ports, resource requests, probes, ConfigMap references, Ingress hosts, TLS secret names, and dependency changes. Those fields decide whether traffic reaches healthy Pods and whether the cluster can schedule them.

This review style catches chart surprises before the release. If a template change meant to add resource requests also changes selectors or route hosts, the rendered diff will show it. The team can split the pull request, adjust the template, or add a migration plan before production traffic depends on the change.

![Chart review loop showing metadata, values, templates, rendered YAML, lint, and rollback evidence](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-charts/chart-review-loop.png)

*A practical chart review moves through source intent, rendered evidence, validation, and rollback context instead of trusting the package layer by itself.*

## What's Next

Helm gives the orders API team a structured package with templates, values, helpers, checks, dependencies, and review evidence. The next article stays inside Helm and focuses on values: the inputs that choose image tags, replicas, resources, configuration, and routing for each environment.

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
