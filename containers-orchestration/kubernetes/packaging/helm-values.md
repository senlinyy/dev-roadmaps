---
title: "Helm Values"
description: "Use Helm values files to configure chart output while keeping environment differences explicit and reviewable."
overview: "Helm values are the inputs that make one chart render differently for staging, production, or another service. This article shows how to use them for `devpolaris-orders-api` without turning values into a hidden programming layer."
tags: ["helm", "values", "configuration", "yaml"]
order: 3
id: article-containers-orchestration-kubernetes-packaging-helm-values
---

## Table of Contents

1. [Values Are Chart Inputs](#values-are-chart-inputs)
2. [A Default values.yaml](#a-default-valuesyaml)
3. [Environment Values Files](#environment-values-files)
4. [How Helm Merges Values](#how-helm-merges-values)
5. [Designing Values That Reviewers Can Read](#designing-values-that-reviewers-can-read)
6. [Rendering Values Into Templates](#rendering-values-into-templates)
7. [Failure Mode: A Missing Value Becomes a Bad Manifest](#failure-mode-a-missing-value-becomes-a-bad-manifest)
8. [Keeping Secrets Out of Plain Values](#keeping-secrets-out-of-plain-values)
9. [Validating the Values Contract](#validating-the-values-contract)
10. [Values Review in a Real Pull Request](#values-review-in-a-real-pull-request)

## Values Are Chart Inputs

Helm values are YAML inputs that templates read through `.Values`. They exist because the same chart often needs to render slightly different manifests for different environments. Staging might run one replica. Production might run three. A developer namespace might use a preview image tag.

![Helm values input path showing values.yaml, environment file, set flag, merge order, and template](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/helm-values-inputs.png)

*Values are chart inputs, and merge order decides which input wins.*


For `devpolaris-orders-api`, the chart should know the stable workload shape: Deployment, Service, labels, ports, probes, and resource structure. Values should provide the choices that vary: image tag, replica count, ingress host, and plain application settings.

Values are not a separate deployment record. They are only useful when you render them and inspect the output. A production values file that nobody renders before release can hide the same mistakes as copied YAML.

## A Default values.yaml

A default `values.yaml` file provides the chart's built-in inputs before any environment overrides are applied. Defaults should be safe for local rendering and clear enough that a reader understands the chart's intended shape.

Example: the orders API chart can default to two replicas, a development image tag, and small resource requests, while production overrides those values in a separate file.

```yaml
replicaCount: 2

image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.05.07"
  pullPolicy: IfNotPresent

service:
  port: 8080

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    memory: 256Mi
```

This file should not be a dumping ground. If a value has no clear use in a template, remove it. If a value controls a risky behavior such as disabling probes, name it clearly and make the safe choice the default.

## Environment Values Files

Environment values files are override files for a specific target such as staging, production, or a preview namespace. They keep environment decisions separate from the chart's shared defaults.

Example: `staging.values.yaml` can set one replica and an `rc` image tag, while `prod.values.yaml` sets three replicas and the production hostname. The file name should make the target obvious.

```text
charts/orders-api/
  values.yaml
environments/
  staging.values.yaml
  prod.values.yaml
```

A staging file can be small:

```yaml
replicaCount: 1

image:
  tag: "2026.05.07-rc.2"

ingress:
  host: orders.staging.devpolaris.example
```

Production can use the same chart with stricter settings:

```yaml
replicaCount: 3

image:
  tag: "2026.05.07"

ingress:
  host: orders.devpolaris.example

resources:
  requests:
    cpu: 250m
    memory: 256Mi
```

The important review question is whether these differences are intentional. A production replica count of three is a capacity decision. A different hostname is an environment boundary. A different image tag should match the release plan.

## How Helm Merges Values

Helm value merging is the order Helm uses to combine defaults, values files, and command-line overrides into one final `.Values` object. Helm starts with chart defaults and layers later values on top.

Example: `values.yaml` can set `replicaCount: 2`, `prod.values.yaml` can override it to `3`, and `--set image.tag=hotfix.1` can override the image tag for that one command.

```bash
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  --set image.tag=2026.05.07-hotfix.1
```

That command renders production settings but replaces the image tag at the command line. This is useful for a quick test, but it is risky for normal releases because the command line can disappear from review history. Prefer committed values files for planned changes.

Here is a simple merge example:

| Source | `replicaCount` | `image.tag` |
|--------|----------------|-------------|
| `values.yaml` | `2` | `2026.05.07` |
| `prod.values.yaml` | `3` | `2026.05.07` |
| `--set image.tag=hotfix.1` | `3` | `hotfix.1` |

The final rendered manifest only has one value for each field. Render it before applying so the merge result is visible.

## Designing Values That Reviewers Can Read

A readable values file acts like a short release form for the chart. It should show the deployment decisions a human is making, not recreate a second Kubernetes manifest with different names. Use value names that match the decision being reviewed.

![Helm values contract map showing image tag, replicas, resources, ingress, secrets reference, and feature flag](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/values-contract-map.png)

*Good values expose real deployment decisions without turning every YAML field into an input.*


```yaml
api:
  logLevel: info
  catalogUrl: http://catalog-api.devpolaris-prod.svc.cluster.local:8080

rollout:
  maxUnavailable: 1
  maxSurge: 1
```

Avoid deeply nested values unless the nesting helps readers. Also avoid values that require the reviewer to understand template tricks.

```yaml
renderMode: advanced
deploymentExtraSpec:
  strategy:
    rollingUpdate:
      maxUnavailable: 1
```

That kind of generic escape hatch can be useful for a shared platform chart, but it also weakens the chart's contract. If every team passes raw Kubernetes fragments through values, the chart stops expressing a clear operating model.

## Rendering Values Into Templates

Rendering values into templates is the step where Helm replaces placeholders with concrete YAML fields. Templates should show where each important value lands.

Example: `replicaCount: 3` should become `spec.replicas: 3`, and `image.tag: 2026.05.07` should become the container image tag in the Deployment.

```yaml
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports:
            - containerPort: {{ .Values.service.port }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

After rendering production, inspect the exact fields:

```bash
$ helm template orders ./charts/orders-api -f environments/prod.values.yaml \
  | grep -n "replicas:\\|image:\\|cpu:\\|memory:"
7:  replicas: 3
34:          image: "ghcr.io/devpolaris/orders-api:2026.05.07"
41:              cpu: 250m
42:              memory: 256Mi
44:              memory: 256Mi
```

The grep command is not a full validation tool. It is a quick human check that the highest-risk values landed where you expected. For real review, use the full rendered YAML and a cluster diff.

## Failure Mode: A Missing Value Becomes a Bad Manifest

A missing value is a chart input that the template expects but no values file provides. Suppose the template expects `.Values.image.tag`, but a new environment file only supplies `image.repository`. The rendered image can become invalid.

```bash
$ helm template orders ./charts/orders-api -f environments/preview.values.yaml
Error: template: orders-api/templates/deployment.yaml:22:53:
executing "orders-api/templates/deployment.yaml" at <.Values.image.tag>:
nil pointer evaluating interface {}.tag
```

That failure is useful because Helm stopped before producing a bad manifest. You can make the error friendlier by requiring critical values.

```yaml
image: "{{ .Values.image.repository }}:{{ required "image.tag is required" .Values.image.tag }}"
```

Now the diagnostic tells the operator exactly what to add:

```bash
$ helm template orders ./charts/orders-api -f environments/preview.values.yaml
Error: execution error at (orders-api/templates/deployment.yaml:22:45):
image.tag is required
```

Use `required` for values that must be present for a safe render. Do not overuse it for every optional setting, or the chart becomes annoying to use.

## Keeping Secrets Out of Plain Values

Plain values files are usually stored in Git and printed in CI logs during rendering. That makes them the wrong place for database passwords, API tokens, private keys, or signing secrets.

For `devpolaris-orders-api`, a plain value such as `LOG_LEVEL` is fine. A value such as `PAYMENTS_API_TOKEN` is not. The chart can reference a Kubernetes Secret by name, but the secret value should come from your team's secret management flow.

```yaml
secrets:
  existingSecretName: orders-api-runtime-secrets
```

The rendered Deployment can then reference that Secret without embedding the secret value:

```yaml
envFrom:
  - secretRef:
      name: {{ .Values.secrets.existingSecretName }}
```

The tradeoff is one more dependency to verify. During diagnosis, check both the Deployment reference and the Secret object in the namespace.

## Validating the Values Contract

A values contract is the agreement between the chart author and the chart user. The chart author says which values exist and what shape they have. The chart user supplies those values for each environment. If the contract is vague, the chart becomes hard to use safely.

For important values, use clear defaults, `required` checks, and a schema when the chart is shared across teams. A schema lets Helm validate value types before rendering. That catches mistakes such as a string where a number is expected.

```json
{
  "$schema": "https://json-schema.org/schema#",
  "type": "object",
  "properties": {
    "replicaCount": {
      "type": "integer",
      "minimum": 1
    },
    "image": {
      "type": "object",
      "required": ["repository", "tag"],
      "properties": {
        "repository": { "type": "string" },
        "tag": { "type": "string" }
      }
    }
  },
  "required": ["replicaCount", "image"]
}
```

Now a broken values file fails before it produces a manifest:

```bash
$ helm template orders ./charts/orders-api -f environments/prod.values.yaml
Error: values don't meet the specifications of the schema(s):
orders-api:
- replicaCount: Invalid type. Expected: integer, given: string
```

The schema is not a replacement for rendered review. It is a guardrail for obvious shape mistakes. You still inspect the final Deployment to verify the image, replicas, labels, probes, and resource requests.

## Values Review in a Real Pull Request

Imagine a pull request changes only `environments/prod.values.yaml`. The author says it increases CPU requests because traffic has grown. The reviewer should see both the value change and the rendered Deployment change.

```diff
 resources:
   requests:
-    cpu: 250m
+    cpu: 400m
     memory: 256Mi
```

That value change is understandable, but it needs one more piece of evidence. Render production and check that only the intended resource request changed.

```text
Rendered diff summary

Deployment/orders-devpolaris-orders-api
  resources.requests.cpu: 250m -> 400m
  resources.requests.memory: unchanged
  resources.limits.memory: unchanged
  image: unchanged
  replicas: unchanged
```

If the rendered diff also changes the image tag or hostname, the values file may have included unrelated edits. Split those changes into separate pull requests when possible. Small values changes are easier to reason about and easier to roll back.


![Helm values summary covering defaults, override, merge, required values, secret references, and render](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/helm-values-summary.png)

*Use this checklist before a values file becomes an unreviewable settings dump.*

---

**References**

- [Helm Values Files](https://helm.sh/docs/chart_template_guide/values_files/) - Official guide to default values, override files, and value precedence.
- [Helm Template Functions and Pipelines](https://helm.sh/docs/chart_template_guide/functions_and_pipelines/) - Official guide to functions such as `required`, `toYaml`, and template pipelines.
- [Helm Upgrade](https://helm.sh/docs/helm/helm_upgrade/) - Official command reference showing values file and `--set` override behavior during upgrades.
- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Official Kubernetes guidance for secret data and why it needs different handling from plain configuration.
