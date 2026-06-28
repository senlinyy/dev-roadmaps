---
title: "Helm Values"
description: "Use Helm values files to configure chart output while keeping environment differences explicit and reviewable."
overview: "Helm values are the inputs that make one chart render differently for staging, production, or another service. This article shows how to use them for `devpolaris-orders-api` without turning values into a hidden programming layer."
tags: ["helm", "values", "configuration", "yaml"]
order: 3
id: article-containers-orchestration-kubernetes-packaging-helm-values
---

## Table of Contents

1. [Values Are Template Inputs](#values-are-template-inputs)
2. [Start With A Tiny Values Skeleton](#start-with-a-tiny-values-skeleton)
3. [Deployment Values: Image And Replicas](#deployment-values-image-and-replicas)
4. [Service Values: Stable Network Access](#service-values-stable-network-access)
5. [Config Values: Plain Runtime Settings](#config-values-plain-runtime-settings)
6. [Ingress Values: The Outside Route](#ingress-values-the-outside-route)
7. [How Helm Builds The Final Values](#how-helm-builds-the-final-values)
8. [Staging And Production Values Files](#staging-and-production-values-files)
9. [Required Values And Schema Validation](#required-values-and-schema-validation)
10. [Keeping Secrets Out Of Values](#keeping-secrets-out-of-values)
11. [Reviewing Values In CI](#reviewing-values-in-ci)
12. [Production Review Habits](#production-review-habits)
13. [What's Next](#whats-next)

## Values Are Template Inputs
<!-- section-summary: Helm values are the inputs templates read through .Values, and every important value should land in a rendered Kubernetes field. -->

Start with one line in a values file: `replicaCount: 3`. That line earns its place when the rendered Deployment shows `spec.replicas: 3`. The same habit works for image tags, Service ports, ConfigMap settings, and hostnames: one value should visibly land in one rendered field.

**Helm values** are YAML inputs that chart templates read through `.Values`. A value can choose the image tag, replica count, Service port, resource request, runtime setting, or route hostname for a release. Helm merges the inputs, renders templates, and sends Kubernetes the final manifests.

For `devpolaris-orders-api`, the chart owns the reusable shape: Deployment, Service, ConfigMap, and optional Ingress. Values answer environment and release questions. Staging can run one replica with a staging hostname. Production can run three replicas with a production hostname and higher resource requests.

A useful value has a visible destination. If `replicaCount: 3` appears in a values file, reviewers should find `spec.replicas: 3` in the rendered Deployment. If `ingress.host` appears in a values file, reviewers should find the same hostname in the rendered Ingress. This article keeps that connection visible from the first snippet.

## Start With A Tiny Values Skeleton
<!-- section-summary: The first values file should expose only the inputs the first template actually consumes. -->

Start with the smallest values skeleton that can render a Deployment. The chart can grow later, but the first step should connect inputs to output without a giant configuration blob.

```yaml
replicaCount: 1
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16-dev"
```

The matching Deployment template consumes only those values.

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

Render it.

```bash
$ helm template orders ./charts/orders-api
```

The rendered output shows the values in Kubernetes fields.

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

This is the habit to keep as the chart grows. Add a value, show the template that consumes it, then inspect the rendered object.

## Deployment Values: Image And Replicas
<!-- section-summary: Deployment values control workload size, image version, resources, and probes that affect how Pods run. -->

A **Deployment** manages a set of Pods from a Pod template. In a Helm chart, Deployment values usually control the number of replicas, container image, resource requests, and health checks. These values affect the running workload directly.

Add resource requests to the values skeleton. A **resource request** tells the scheduler how much CPU and memory the Pod expects. In production, requests help the cluster place Pods predictably.

```yaml
replicaCount: 1
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16-dev"
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    memory: 256Mi
```

The Deployment template consumes `resources` under the container.

```yaml
containers:
  - name: orders-api
    image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
    resources:
      {{- toYaml .Values.resources | nindent 6 }}
```

Rendered output should be easy to inspect.

```yaml
containers:
  - name: orders-api
    image: ghcr.io/devpolaris/orders-api:2026.06.16-dev
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        memory: 256Mi
```

The `toYaml` function converts the nested values map back into YAML. `nindent 6` places that YAML under the container's `resources` key. Without the right indentation, Helm may render invalid YAML or put fields in the wrong place.

## Service Values: Stable Network Access
<!-- section-summary: Service values describe the port contract between cluster clients and the API Pods. -->

A **Service** gives matching Pods a stable network address. Pods can be recreated with new IP addresses, but the Service name stays stable. For the orders API, clients call Service port `80`, and the container receives traffic on port `8080`.

Add only the Service inputs.

```yaml
service:
  port: 80
  targetPort: 8080
```

The Service template consumes those values in the `ports` list.

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

The Deployment should also consume `targetPort` for the container port, so the Service and container stay aligned.

```yaml
ports:
  - containerPort: {{ .Values.service.targetPort }}
```

Rendered output gives reviewers a simple check.

```yaml
kind: Service
spec:
  ports:
    - port: 80
      targetPort: 8080
```

A Service value should not hide selector behavior. Selectors should stay visible and consistent with Pod labels. If a values file changes selector labels casually, a release can create healthy Pods that receive no traffic.

## Config Values: Plain Runtime Settings
<!-- section-summary: Config values belong in a ConfigMap when they are safe to store in Git and useful to the app at runtime. -->

A **ConfigMap** stores non-secret configuration data. It fits values such as log level, feature flags that are safe to expose, and internal service URLs. It should not hold passwords, API tokens, private keys, or signing secrets.

Add a small config section to the values file.

```yaml
config:
  logLevel: info
  catalogUrl: http://catalog-api.devpolaris-dev.svc.cluster.local:8080
```

The ConfigMap template consumes the config values.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-api-config
data:
  LOG_LEVEL: {{ .Values.config.logLevel | quote }}
  CATALOG_URL: {{ .Values.config.catalogUrl | quote }}
```

The Deployment consumes that ConfigMap through `envFrom`.

```yaml
envFrom:
  - configMapRef:
      name: orders-api-config
```

Rendered output should show both sides: the ConfigMap data and the Deployment reference.

```yaml
kind: ConfigMap
data:
  LOG_LEVEL: "info"
  CATALOG_URL: "http://catalog-api.devpolaris-dev.svc.cluster.local:8080"
---
kind: Deployment
spec:
  template:
    spec:
      containers:
        - envFrom:
            - configMapRef:
                name: orders-api-config
```

This gives reviewers two concrete questions. Are the settings safe to store in Git? Does the Deployment actually consume the ConfigMap the chart renders?

## Ingress Values: The Outside Route
<!-- section-summary: Ingress values should expose the hostname and TLS choices that route outside traffic into the Service. -->

An **Ingress** is a Kubernetes object that describes HTTP routing from outside the cluster to a Service. In production, the host and TLS settings carry real user traffic, so values should make those choices explicit.

Add a small Ingress section.

```yaml
ingress:
  enabled: true
  className: nginx
  host: orders.staging.devpolaris.example
  tlsSecretName: orders-api-staging-tls
```

The template should render an Ingress only when the route is enabled.

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: devpolaris-orders-api
spec:
  ingressClassName: {{ .Values.ingress.className | quote }}
  tls:
    - hosts:
        - {{ .Values.ingress.host | quote }}
      secretName: {{ .Values.ingress.tlsSecretName | quote }}
{{- end }}
```

Then connect the hostname to the backend Service.

```yaml
rules:
  - host: {{ .Values.ingress.host | quote }}
    http:
      paths:
        - path: /
          pathType: Prefix
          backend:
            service:
              name: devpolaris-orders-api
              port:
                number: {{ .Values.service.port }}
```

Rendered output should show the host, TLS Secret name, backend Service, and backend port.

```yaml
kind: Ingress
spec:
  ingressClassName: "nginx"
  tls:
    - hosts:
        - "orders.staging.devpolaris.example"
      secretName: "orders-api-staging-tls"
  rules:
    - host: "orders.staging.devpolaris.example"
```

Route values deserve careful review. A wrong hostname can send users to the wrong environment, and a wrong backend Service can route traffic away from the API Pods.

![Helm values becoming Kubernetes objects, with image tag, replicas, resources, and host landing in Deployment, Service, and Ingress output](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/values-become-objects.png)

*Values stay understandable when each important input maps to a real Kubernetes field reviewers can inspect in the rendered output.*

## How Helm Builds The Final Values
<!-- section-summary: Helm merges chart defaults, values files, and command-line overrides into one final values object before rendering templates. -->

**Merge order** is the rule Helm uses when more than one input sets the same value. Helm starts with the chart's `values.yaml`, then applies values files in the order passed with `-f`, then applies command-line overrides such as `--set`. Later inputs win for the same key.

Here is a default.

```yaml
replicaCount: 1
image:
  tag: "2026.06.16-dev"
```

Here is a production override.

```yaml
replicaCount: 3
image:
  tag: "2026.06.16.1"
```

Render with the production file.

```bash
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml
```

The rendered Deployment shows the final result, not the merge history.

```yaml
spec:
  replicas: 3
containers:
  - image: ghcr.io/devpolaris/orders-api:2026.06.16.1
```

Use `--debug` when you need to see more about the values Helm used.

```bash
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  --debug
COMPUTED VALUES:
replicaCount: 3
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: 2026.06.16.1
```

The computed values help explain where the render came from. Kubernetes still receives only the rendered manifests.

![Helm values merge order showing chart defaults, staging file, production file, CLI override, final values, and later inputs winning](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/values-merge-order.png)

*The merge stack shows where final values came from, while Kubernetes only receives the rendered result.*

## Staging And Production Values Files
<!-- section-summary: Environment values files should show the choices unique to that environment rather than copying every default. -->

An **environment values file** holds the choices for one target environment. Staging and production run the same orders API shape, but they choose different capacity, hostnames, runtime URLs, and sometimes image tags.

Staging can stay small.

```yaml
replicaCount: 1
image:
  tag: "2026.06.16-rc.1"
config:
  catalogUrl: http://catalog-api.devpolaris-staging.svc.cluster.local:8080
ingress:
  host: orders.staging.devpolaris.example
  tlsSecretName: orders-api-staging-tls
```

Production can show the higher-risk choices.

```yaml
replicaCount: 3
image:
  tag: "2026.06.16.1"
config:
  catalogUrl: http://catalog-api.devpolaris-prod.svc.cluster.local:8080
ingress:
  host: orders.devpolaris.example
  tlsSecretName: orders-api-prod-tls
resources:
  requests:
    cpu: 400m
    memory: 512Mi
```

These files should not copy the whole default file. Repeated defaults hide the actual decision. A reviewer should quickly see what production changes: capacity, image, dependency URL, host, TLS Secret name, and resources.

When multiple values files are used together, keep the command explicit.

```bash
$ helm template orders ./charts/orders-api \
  -f values/common.yaml \
  -f environments/prod.values.yaml
```

The order matters. `prod.values.yaml` appears later, so it wins over `values/common.yaml` for the same keys.

## Required Values And Schema Validation
<!-- section-summary: Required values and schema files catch missing or malformed inputs before Helm renders a surprising manifest. -->

A **required value** is an input the chart refuses to render without. Helm templates can use the `required` function to stop rendering with a clear message. The image tag is a good example, since an empty tag can create a broken or ambiguous image reference.

```yaml
image: "{{ .Values.image.repository }}:{{ required "image.tag is required" .Values.image.tag }}"
```

The failure should tell the release author what to fix.

```bash
$ helm template orders ./charts/orders-api --set image.tag=
Error: execution error at (orders-api/templates/deployment.yaml:18:45):
image.tag is required
```

A **values schema** is a `values.schema.json` file that describes allowed value types, required fields, and simple constraints. Helm validates values against that schema during commands such as install, upgrade, lint, and template.

```json
{
  "type": "object",
  "required": ["image"],
  "properties": {
    "replicaCount": { "type": "integer", "minimum": 1 },
    "image": {
      "type": "object",
      "required": ["repository", "tag"]
    }
  }
}
```

Schema validation catches input shape problems. Rendered review catches output meaning. Real teams use both: schema for the contract, rendered YAML for the production consequence.

## Keeping Secrets Out Of Values
<!-- section-summary: Values files should reference secret objects by name instead of storing secret data directly. -->

A **Secret** stores sensitive data for Pods. Kubernetes Secrets still need careful access control and encryption decisions, but they are a better boundary than plain values files for passwords, API tokens, private keys, and signing secrets.

Do not put raw secret data in a normal values file.

```yaml
databasePassword: "do-not-commit-real-passwords"
```

Use values to reference an existing Secret name instead.

```yaml
secretRefs:
  runtime: orders-api-runtime-secrets
```

Then let the Deployment consume the Secret by name.

```yaml
envFrom:
  - configMapRef:
      name: orders-api-config
  - secretRef:
      name: {{ .Values.secretRefs.runtime | quote }}
```

The rendered Deployment should show only the Secret reference.

```yaml
envFrom:
  - configMapRef:
      name: orders-api-config
  - secretRef:
      name: "orders-api-runtime-secrets"
```

Some teams use External Secrets Operator, Sealed Secrets, SOPS, or cloud secret managers. The tool choice can vary. The chart should keep the boundary clear: values may name the Secret object, while the secret data comes from a controlled secret workflow.

## Reviewing Values In CI
<!-- section-summary: CI should validate values, render each important environment, and attach the manifest diff for review. -->

A values change deserves rendered evidence. A pull request that only changes `prod.values.yaml` can still change Deployments, Services, ConfigMaps, Ingresses, and Secret references.

Run chart checks first.

```bash
$ helm lint ./charts/orders-api \
  -f environments/prod.values.yaml
==> Linting ./charts/orders-api
1 chart(s) linted, 0 chart(s) failed
```

Render staging and production.

```bash
$ helm template orders ./charts/orders-api \
  -f environments/staging.values.yaml \
  > rendered/staging.yaml
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  > rendered/prod.yaml
```

Then produce a focused diff or summary. This example checks high-risk fields.

```bash
$ grep -n "replicas:\\|image:\\|host:\\|secretRef:" rendered/prod.yaml
10:  replicas: 3
34:          image: ghcr.io/devpolaris/orders-api:2026.06.16.1
61:            - secretRef:
96:    - host: "orders.devpolaris.example"
```

If the team can reach a cluster API from CI, add server-side dry run or `kubectl diff` for the environment. The rendered manifest remains the common evidence either way.

![Helm values CI review showing schema check, render each environment, secret boundary, diff, and approval](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/values-ci-review.png)

*CI keeps values changes reviewable by validating the input contract, rendering every important environment, checking secret boundaries, and showing the diff before approval.*

## Production Review Habits
<!-- section-summary: Production values review follows each changed input to the Kubernetes field it changes. -->

A **production values review** follows each changed input into the rendered output. The reviewer should never approve a values change from the input file alone. Values exist to change manifests, so the rendered manifests need to appear in the review.

Use a checklist that names both the input and the output.

| Area | Values input | Rendered output to inspect |
|---|---|---|
| Image | `image.tag` | Deployment container image |
| Capacity | `replicaCount`, `resources` | Deployment replicas and container resources |
| Configuration | `config.*` | ConfigMap data and Deployment `envFrom` |
| Routing | `ingress.host`, `ingress.tlsSecretName` | Ingress host, TLS Secret, backend Service |
| Secrets | `secretRefs.runtime` | Deployment Secret reference only |
| Validation | schema and lint result | CI logs plus rendered manifest diff |

Here is a realistic review note for a production capacity change.

```yaml
Change:
  file: environments/prod.values.yaml
  replicaCount: 2 -> 3
  resources.requests.cpu: 300m -> 400m
RenderedChecks:
  - Deployment.spec.replicas is 3
  - container image stayed ghcr.io/devpolaris/orders-api:2026.06.16.1
  - Service selector stayed app.kubernetes.io/name=devpolaris-orders-api
  - Ingress host stayed orders.devpolaris.example
```

This kind of note helps incident review too. If a rollout fails after a values change, the team can inspect the same path in reverse: input value, rendered manifest, live Kubernetes object, Pod event, and application log.

Values work best when they read like a small production form. A reviewer should see which image, how many replicas, which host, which ConfigMap settings, which resource requests, and which Secret reference the release will use. They should also see the rendered Kubernetes result.

## What's Next

Values are only the input side of Helm. Once the team installs or upgrades the chart, Helm creates a release record in the cluster, stores revision history, and gives operators commands for status checks and rollback.

The next article follows `devpolaris-orders-api` through install, upgrade, release history, rollout verification, and rollback. That is where the values file turns into a production release.

---

**References**

- [Helm Values Files](https://helm.sh/docs/chart_template_guide/values_files/) - Official guide to chart values, user-supplied values files, `--set`, and value precedence.
- [Helm Charts: Schema Files](https://helm.sh/docs/topics/charts/#schema-files) - Official chart documentation for `values.schema.json` and when Helm validates values.
- [Helm Template](https://helm.sh/docs/helm/helm_template/) - Current command reference for rendering chart templates locally.
- [Helm Install](https://helm.sh/docs/helm/helm_install/) - Current command reference for install-time values files, `--set`, dry runs, and hidden Secret output.
- [Helm Upgrade](https://helm.sh/docs/helm/helm_upgrade/) - Current command reference for upgrade-time values merging and release updates.
- [Kubernetes ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) - Official Kubernetes guide to plain configuration data consumed by Pods.
- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Official Kubernetes guide to secret data and why it needs separate handling.
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Official Kubernetes guide to stable network access for Pods.
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - Official Kubernetes guide to HTTP routing through Ingress resources.
