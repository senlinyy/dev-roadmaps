---
title: "Helm Values"
description: "Use Helm values files to configure chart output while keeping environment differences explicit and reviewable."
overview: "Helm values are release inputs that land in rendered Kubernetes YAML. Values are easiest to learn through the template syntax that consumes them: braces, dot context, values paths, built-in objects, whitespace control, functions, merge order, validation, secrets, and CI review."
tags: ["helm", "values", "configuration", "yaml"]
order: 3
id: article-containers-orchestration-kubernetes-packaging-helm-values
---

## Table of Contents

1. [What Helm Values Do](#what-helm-values-do)
2. [The Template Syntax You Will See](#the-template-syntax-you-will-see)
3. [Double Braces Run Template Code](#double-braces-run-template-code)
4. [The Dot Context](#the-dot-context)
5. [The Values Tree](#the-values-tree)
6. [Whitespace Control](#whitespace-control)
7. [Pipes and Functions](#pipes-and-functions)
8. [Conditionals](#conditionals)
9. [Trace Values Into Kubernetes Objects](#trace-values-into-kubernetes-objects)
10. [Values Merge Order](#values-merge-order)
11. [Values Schema Validation](#values-schema-validation)
12. [Secret Values and Secret References](#secret-values-and-secret-references)
13. [Review Values in CI](#review-values-in-ci)
14. [Putting It All Together](#putting-it-all-together)
15. [What's Next](#whats-next)
16. [References](#references)

## What Helm Values Do
<!-- section-summary: Helm values are release inputs, and templates decide where those inputs appear in Kubernetes YAML. -->

A **Helm value** is an input that a chart template reads while Helm renders Kubernetes YAML. The value by itself is only data. The template gives that data a destination. For example, `replicaCount: 3` matters because a Deployment template can place it under `spec.replicas`, and Kubernetes can then maintain three Pods.

The running example is `devpolaris-orders-api`. Development runs a small release. Production runs more replicas, a stable image tag, a Service port, a ConfigMap setting, and an internal hostname. The chart owns the shared Kubernetes shape, while values files carry the choices that differ by environment.

Here is the production values file for the example release:

```yaml
replicaCount: 3

image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16.1"

service:
  port: 80
  targetPort: 8080
  enableMetrics: true

config:
  logLevel: info
  catalogUrl: http://catalog-api.devpolaris-prod.svc.cluster.local:8080

ingress:
  enabled: true
  host: orders.example.internal
```

Important points in this file:

- `replicaCount` is a release decision about scale. It should land in a Deployment field.
- `image.repository` and `image.tag` identify the application build. They should land in the container image.
- `service.port` is the port callers use through the Service.
- `service.targetPort` is the port the application container listens on.
- `config` contains ordinary settings that are safe to store in Git.
- `ingress.enabled` controls whether Helm renders an Ingress object.
- `ingress.host` is the hostname reviewers should see in the final route.

The rest of the article explains the template syntax that turns this values file into Kubernetes YAML.

## The Template Syntax You Will See
<!-- section-summary: Helm templates are normal Kubernetes YAML plus Go-template expressions that Helm evaluates during rendering. -->

Helm uses the Go template language, plus Helm objects and helper functions, to inject values into YAML. Everything outside a template expression stays as normal YAML text. Everything inside `{{ ... }}` is template code that Helm evaluates.

For a beginner, the safest way to read a Helm template is to keep two layers in mind. The first layer is still Kubernetes YAML: `apiVersion`, `kind`, `metadata`, `spec`, ports, labels, and other object fields. The second layer is Helm syntax that fills in release-specific pieces during rendering. In the orders API chart, that syntax places the release name and Service port into fields that Kubernetes already understands.

A tiny template can look like this:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ .Release.Name }}-orders-api
spec:
  ports:
    - port: {{ .Values.service.port }}
```

Important points in this template:

- `apiVersion`, `kind`, `metadata`, and `spec` are normal Kubernetes YAML.
- `{{ .Release.Name }}` asks Helm for the release name, then inserts it into the YAML.
- `{{ .Values.service.port }}` asks Helm for a value from the values file.
- The rendered file should be ordinary YAML with no `{{ ... }}` expressions left.

That syntax is small, but it introduces the main pieces beginners need: double braces, dot context, values paths, and built-in Helm objects.

## Double Braces Run Template Code
<!-- section-summary: Double braces mark the parts of a template that Helm should evaluate and replace. -->

The double curly braces, `{{ }}`, tell Helm to run template code. Text outside the braces stays static. Code inside the braces gets evaluated and replaced with the result.

This is the smallest unit of Helm template syntax. When the chart renders, Helm reads the expression inside the braces, calculates a value, and writes that value into the YAML stream. Kubernetes receives only the rendered result. For the orders API, double braces are how the same template can use `orders-dev` in one release and `orders` in production while keeping the Kubernetes object shape the same.

Here is the simplest version:

```yaml
metadata:
  name: {{ .Values.appName }}
```

Important points in this example:

- `metadata:` and `name:` are static YAML text. Helm leaves them alone.
- `{{ .Values.appName }}` is dynamic template code. Helm replaces it.
- If `values.yaml` contains `appName: orders-api`, the rendered YAML contains `name: orders-api`.
- The final YAML is what Kubernetes receives. Kubernetes never sees the template expression.

A template has two layers: the Kubernetes shape outside the braces and the dynamic values inside the braces. That separation keeps the template from looking like a different language hiding inside YAML.

## The Dot Context
<!-- section-summary: The dot is the current context, and at the top level it gives access to Helm objects such as Values, Release, and Chart. -->

The period, `.`, is one of the most important symbols in a Helm template. At the top of a template, `.` means the current top-level Helm context. From that context, you can reach different buckets of information.

That context is the bundle Helm carries while rendering. It includes the values files, release information, chart metadata, and cluster capability data. The dot is the starting point for asking Helm for one of those pieces. In the orders API chart, a template can ask the same context for the production Service port through `.Values` and the release name through `.Release`.

Common top-level objects include:

| Template path | What it means | Example use |
| --- | --- | --- |
| `.Values` | Data from values files and overrides | `{{ .Values.replicaCount }}` |
| `.Release` | Information about this Helm release | `{{ .Release.Name }}` |
| `.Chart` | Metadata from `Chart.yaml` | `{{ .Chart.Version }}` |
| `.Capabilities` | Kubernetes API versions and cluster capability data | Checking whether an API is available |

Here is a metadata block that uses `.Release` and `.Chart`:

```yaml
metadata:
  name: {{ .Release.Name }}-orders-api
  labels:
    app.kubernetes.io/managed-by: {{ .Release.Service }}
    helm.sh/chart: "{{ .Chart.Name }}-{{ .Chart.Version }}"
```

Important points in this example:

- `.Release.Name` is the name used during `helm install` or `helm upgrade`.
- `.Release.Service` is usually `Helm`, which helps show the object is managed by Helm.
- `.Chart.Name` and `.Chart.Version` come from `Chart.yaml`.
- The label values should be quoted if they may contain characters that YAML could read in a surprising way.

The dot can change inside loops and helper templates. For a beginner values article, the safe first rule is this: at the top level, start from `.` and then choose the bucket you need.

## The Values Tree
<!-- section-summary: Values paths follow the YAML tree, so each dot after Values walks one level deeper into the values file. -->

`.Values` opens the values data. The dots after `.Values` walk down the YAML tree.

This path syntax follows the shape of the values file. If the values file has nested maps, each dot moves one level deeper. That is why values structure deserves design attention before a chart grows. A shallow, named path such as `.Values.image.tag` is easy for a reviewer to trace into a container image. A deeply nested path forces reviewers to jump through too many levels before they know which release choice changed.

Imagine this values file:

```yaml
database:
  mysql:
    username: admin
```

Important points in this values shape:

- `database` groups values related to the database.
- `mysql` names the specific database type in this example.
- `username` is the final value the template will read.

The template path follows the same nesting:

```yaml
env:
  - name: DB_USER
    value: {{ .Values.database.mysql.username | quote }}
```

Important points in this example:

- `.Values` opens the values file data.
- `.database` moves into the `database:` map.
- `.mysql` moves into the nested `mysql:` map.
- `.username` selects the final value, `admin`.
- `| quote` wraps the rendered string in quotes, which is safer for YAML values.

This is the reason values files should stay organized. Deep paths such as `.Values.global.platform.defaults.networking.primary.service.http.port` are hard for beginners and reviewers. A chart should use nested values for groups that make the release choice simple to understand.

## Whitespace Control
<!-- section-summary: Whitespace control removes extra spaces and blank lines that template logic can leave in YAML. -->

YAML cares about indentation and structure. Helm template logic can leave blank lines or extra spaces after conditions and loops. Helm uses hyphens inside the template braces to trim whitespace.

Whitespace control exists because templates are removed during rendering, but the surrounding YAML still needs clean indentation. A blank line rarely breaks YAML by itself, while a misplaced indentation level can change the structure or fail parsing. The orders API chart uses whitespace trimming around optional blocks such as metrics ports or Ingress sections so the rendered Service and route stay readable after Helm evaluates the condition.

The common forms are:

| Syntax | Plain meaning |
| --- | --- |
| `{{- ... }}` | Trim whitespace on the left side of the template expression |
| `{{ ... -}}` | Trim whitespace on the right side of the template expression |
| `{{- ... -}}` | Trim whitespace on both sides |

Here is a conditional Service port without whitespace trimming:

```yaml
ports:
  - name: http
    port: {{ .Values.service.port }}
  {{ if .Values.service.enableMetrics }}
  - name: metrics
    port: 9090
  {{ end }}
```

Important points in this example:

- `if` starts a conditional block.
- `end` closes the conditional block.
- If `enableMetrics` is false, Helm removes the metrics port.
- The template markers can leave extra blank lines because they occupy their own lines.

Here is the same idea with left-side whitespace trimming:

```yaml
ports:
  - name: http
    port: {{ .Values.service.port }}
  {{- if .Values.service.enableMetrics }}
  - name: metrics
    port: 9090
  {{- end }}
```

Important points in the trimmed version:

- `{{- if ... }}` trims whitespace before the `if` expression.
- `{{- end }}` trims whitespace before the closing expression.
- The rendered YAML stays tighter after Helm removes the conditional markers.
- Whitespace trimming helps readability, but indentation still has to match valid YAML.

Whitespace bugs are common in Helm charts. If a rendered manifest fails YAML parsing, inspect the rendered output together with the template source.

## Pipes and Functions
<!-- section-summary: Pipes send a value through a function so templates can quote, default, indent, or format rendered output. -->

A **function** transforms a value inside the template. A **pipe**, `|`, sends the value on the left into the function on the right. Helm's documentation calls this a common pattern for template functions.

Functions help the template produce YAML that is both valid and clear. The most common beginner examples are quoting strings, supplying a fallback, and formatting nested maps with the right indentation. These functions should support review rather than hide release choices. In the orders API chart, a function can quote `LOG_LEVEL`, but the value still needs to land in a ConfigMap field the reviewer can find.

Here is a ConfigMap value with `quote`:

```yaml
data:
  LOG_LEVEL: {{ .Values.config.logLevel | quote }}
```

Important points in this example:

- `.Values.config.logLevel` reads `info` from the values file.
- `| quote` sends that value into the `quote` function.
- The rendered YAML contains `LOG_LEVEL: "info"`.
- Quoting strings avoids YAML surprises around values such as `on`, `off`, `yes`, `no`, or version-looking numbers.

`default` supplies a backup value:

```yaml
image: "nginx:{{ .Values.image.tag | default "latest" }}"
```

Important points in this example:

- Helm reads `.Values.image.tag`.
- If the value is empty, `default "latest"` supplies `latest`.
- This is useful for computed fallbacks, but stable chart defaults usually belong in `values.yaml`.
- Production charts should avoid hiding important release decisions behind too many defaults.

`toYaml` and `nindent` help render nested maps cleanly:

```yaml
resources:
{{- toYaml .Values.resources | nindent 2 }}
```

Important points in this example:

- `.Values.resources` might contain a nested CPU and memory map.
- `toYaml` converts that map into YAML.
- `nindent 2` adds a newline and indents the rendered block by two spaces.
- This pattern is useful for nested Kubernetes fields such as `resources`, `nodeSelector`, `affinity`, and `tolerations`.

The danger is review clarity. A short `toYaml` block can be helpful. A large `toYaml` escape hatch can hide too much runtime behavior from the template reviewer.

## Conditionals
<!-- section-summary: Conditionals let a chart render optional Kubernetes objects or fields from explicit values. -->

A conditional lets a chart include a block only if a value asks for it. This is common for optional Ingress, metrics ports, or extra annotations.

Conditionals should represent a real optional resource or field. For the orders API, development might run without an Ingress, while production needs a route host. The value `ingress.enabled` gives that choice a name, and the template turns the choice into either a rendered Ingress object or no Ingress object. Reviewers should always check the rendered output because the absence of a resource is still a release decision.

Here is an Ingress guarded by `ingress.enabled`:

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ .Release.Name }}-orders-api
spec:
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ .Release.Name }}-orders-api
                port:
                  number: {{ .Values.service.port }}
{{- end }}
```

Important points in this example:

- `if .Values.ingress.enabled` controls whether Helm renders the whole Ingress.
- `.Values.ingress.host | quote` places the environment hostname into the route.
- `.Release.Name` keeps the resource name tied to the Helm release.
- `.Values.service.port` connects the Ingress backend to the Service port.
- `{{- end }}` closes the conditional and trims the whitespace before it.

Conditionals should represent real optional behavior. If production always needs an Ingress, the value should not make it easy to accidentally remove the route without review.

## Trace Values Into Kubernetes Objects
<!-- section-summary: Each important value should have a visible destination in the rendered Deployment, Service, ConfigMap, or route. -->

After the syntax is clear, the review habit is simple: trace the input, the template destination, and the rendered Kubernetes field.

This trace is where values stop feeling like random settings. A value has production meaning only after it reaches a Kubernetes object or a clear application contract. For the orders API, the reviewer should be able to point from `replicaCount` to Deployment replicas, from `image.tag` to the container image, from `config.logLevel` to ConfigMap data, and from `ingress.host` to the route that receives traffic.

![Helm values flowing into Kubernetes objects, with replica count, image tag, service port, config, and host landing in rendered output](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/values-flow-objects.png)

*Values stay reviewable because every important input lands in a visible Deployment, Service, ConfigMap, or route field.*

Here is the trace for the Orders API:

| Value | Template destination | Rendered Kubernetes result |
| --- | --- | --- |
| `replicaCount: 3` | `Deployment.spec.replicas` | The Deployment asks for three Pods |
| `image.repository` + `image.tag` | Container `image` | Kubernetes runs `ghcr.io/devpolaris/orders-api:2026.06.16.1` |
| `service.targetPort: 8080` | Container `ports[].containerPort` | The Pod exposes port `8080` |
| `service.port: 80` | Service `ports[].port` | Callers use Service port `80` |
| `config.logLevel: info` | ConfigMap `data.LOG_LEVEL` | The app receives `LOG_LEVEL=info` |
| `ingress.host` | Ingress `rules[].host` | The environment hostname routes to the Service |

Useful review questions:

- Can the reviewer find the template field that consumes each value?
- Can the reviewer inspect the rendered YAML that Kubernetes will receive?
- Does the value describe a real release choice?
- Does the chart keep dangerous fields, such as selectors, under tight control?
- Does the application actually consume the rendered ConfigMap or Secret reference?

The goal is to expose the release choices that should vary across environments and keep the rest of the Kubernetes shape stable.

## Values Merge Order
<!-- section-summary: Helm merges defaults, values files, and command-line overrides in a predictable order, so release commands need review. -->

Helm can receive values from several places. Chart defaults usually live in `values.yaml`. Environment files can override those defaults. Command-line flags such as `--set` can override file values.

Merge order matters during review because the last input can change what every earlier file appeared to say. A chart default may set a development image tag, a production file may replace it with an approved tag, and CI may add a short command-line override for a release candidate. The final rendered manifest is the reliable place to confirm which value won.

This render command uses two values files:

```bash
helm template orders ./charts/orders-api \
  -f values.yaml \
  -f environments/prod.values.yaml
```

Important points in this command:

- `helm template` renders manifests without changing the cluster.
- `orders` is the release name for this render.
- `./charts/orders-api` points at the chart directory.
- `-f values.yaml` loads the chart's shared defaults.
- `-f environments/prod.values.yaml` loads production overrides after the defaults.
- The later file wins for matching keys.

![Helm values merge order showing chart defaults, staging file, production file, CLI override, final values, and later inputs winning](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/values-merge-order.png)

*Review the final merged values through rendered manifests, especially for release commands that supply several files.*

Command-line overrides are useful in automation, but they are easy to miss during review:

```bash
helm upgrade orders ./charts/orders-api \
  -f values.yaml \
  -f environments/prod.values.yaml \
  --set image.tag=2026.06.16.2
```

Important points in this command:

- `helm upgrade` updates an existing release.
- The two `-f` flags load defaults and production values.
- `--set image.tag=...` overrides the final image tag after the files.
- CI should print the full command and attach rendered YAML so reviewers see the real final input.

For production, prefer reviewed values files for most changes. Use `--set` for controlled automation paths that also publish the final rendered manifest.

## Values Schema Validation
<!-- section-summary: A values schema catches missing or wrong-shaped inputs before Helm renders or installs a chart. -->

A **values schema** is a JSON Schema file named `values.schema.json` in the chart. Helm uses it to validate values during commands such as `helm lint`, `helm template`, `helm install`, and `helm upgrade`.

Schema validation gives a chart a basic contract for its inputs. It can catch a missing image tag, a string where a number should be, or a boolean written as free-form text. That is especially helpful for production values because a typo in a values file can otherwise travel all the way into rendered YAML. The schema checks the shape before the orders API release reaches the cluster.

Here is a small schema for the Orders API values:

```json
{
  "type": "object",
  "properties": {
    "replicaCount": {
      "type": "integer",
      "minimum": 1
    },
    "image": {
      "type": "object",
      "properties": {
        "repository": { "type": "string", "minLength": 1 },
        "tag": { "type": "string", "minLength": 1 }
      },
      "required": ["repository", "tag"]
    },
    "ingress": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "host": { "type": "string" }
      }
    }
  },
  "required": ["replicaCount", "image"]
}
```

Important points in this schema:

- `replicaCount` must be an integer and at least `1`.
- `image.repository` and `image.tag` must be non-empty strings.
- `ingress.enabled` must be a boolean, so `"yes"` or `"enabled"` fails validation.
- `required` catches missing values before the chart reaches a cluster.
- Schema validation checks shape and required fields. It can still accept an image tag that passes the schema but points to the wrong build.

Run lint with the production values:

```bash
helm lint ./charts/orders-api -f environments/prod.values.yaml
```

Important points in this command:

- `helm lint` checks chart structure and values schema.
- `-f environments/prod.values.yaml` validates the production input together with the chart defaults.
- A successful lint result should still be followed by rendered YAML review.

## Secret Values and Secret References
<!-- section-summary: Values files often live in Git, so secret material should use a separate secret-management path. -->

Many teams store chart source and values files in Git. That is useful for review, but it means passwords, tokens, private keys, and signing secrets should stay out of ordinary values files.

The practical pattern is to let the chart name the secret contract while another system manages the secret material. The orders API still needs to know which Kubernetes Secret to read, and reviewers still need to verify that the Deployment references the expected object. The password itself should come from a controlled secret workflow, such as a cloud secret manager, sealed secret process, or platform-managed injection path.

Use values to name the Secret contract while secret material stays in the controlled secret workflow:

```yaml
secrets:
  databaseSecretName: orders-api-database
```

Important points in this values example:

- The value names a Kubernetes Secret object.
- The value contains only the Secret object name, never the database password.
- The Secret can be created by a separate secret-management workflow.
- The chart can still wire the application to the Secret name.

The Deployment template can consume that Secret name:

```yaml
envFrom:
  - secretRef:
      name: {{ .Values.secrets.databaseSecretName }}
```

Important points in this template:

- `secretRef` tells Kubernetes to expose all keys from the named Secret as environment variables.
- `.Values.secrets.databaseSecretName` controls the object name.
- The actual secret values stay outside the chart values file.
- For tighter review, explicit `secretKeyRef` entries can show exactly which keys the container reads.

Real teams often use External Secrets Operator, Sealed Secrets, SOPS, a cloud secret manager, or a platform-managed secret pipeline. The chart should document the expected Secret name and keys, while secret material follows the controlled path chosen by the organization.

## Review Values in CI
<!-- section-summary: CI should validate values, render each changed environment, and attach final manifests for review. -->

A values review should include the rendered objects for every environment changed by the pull request. CI can make that routine.

This section turns the earlier syntax rules into a repeatable gate. CI should validate the chart, render the affected environments, and publish the final YAML so reviewers can inspect the Deployment, Service, ConfigMap, Secret references, and route. For the orders API, a values-only pull request still deserves rendered evidence because a small input change can alter the object Kubernetes receives.

```bash
helm lint ./charts/orders-api -f environments/prod.values.yaml
helm template orders ./charts/orders-api \
  -f values.yaml \
  -f environments/prod.values.yaml \
  > rendered/orders-api-prod.yaml
kubectl apply --dry-run=server -f rendered/orders-api-prod.yaml
```

Important points in this CI example:

- The first command validates chart structure and values schema.
- The second command saves the final rendered Kubernetes YAML as an artifact.
- The third command asks the Kubernetes API server to validate the rendered objects.
- `--dry-run=server` performs server-side validation without storing the objects.
- The artifact should be attached to the pull request so reviewers can inspect the final Deployment, Service, ConfigMap, and Ingress.

![Helm values CI review showing schema check, render each environment, secret boundary, diff, and approval](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/values-ci-review.png)

*CI should show reviewers the final rendered objects together with the values file diff.*

## Putting It All Together
<!-- section-summary: A complete values review connects syntax, inputs, templates, rendered output, validation, and the release decision. -->

Here is a compact Service example that uses the main Helm values ideas together:

This final example combines built-in objects, values paths, functions, defaults, and a conditional block. The Kubernetes Service shape stays visible while each Helm expression has a clear destination in the rendered YAML. Optional metrics behavior is controlled by a named value.

For the orders API, this is the kind of template a reviewer can trace without opening five files. The release name labels the object, the chart metadata records package provenance, the Service port comes from values, and the metrics port appears only when the release asks for it.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ .Release.Name | quote }}
  labels:
    helm.sh/chart: "{{ .Chart.Name }}-{{ .Chart.Version }}"
spec:
  ports:
    - name: http
      port: {{ .Values.service.port | default 80 }}
      targetPort: http
  {{- if .Values.service.enableMetrics }}
    - name: metrics
      port: 9090
  {{- end }}
```

Important points in this final example:

- `{{ .Release.Name | quote }}` reads the release name and quotes it for YAML safety.
- `.Chart.Name` and `.Chart.Version` come from `Chart.yaml`, so labels can show chart provenance.
- `.Values.service.port | default 80` reads the Service port and falls back to `80` if the value is empty.
- `if .Values.service.enableMetrics` renders the metrics port only for releases that opt in.
- `{{-` trims whitespace so disabled metrics still produce tidy YAML.
- The final rendered Service should be plain Kubernetes YAML with no template syntax.

A production reviewer should be able to follow this path:

- Which value changed?
- Which template expression reads it?
- Which rendered Kubernetes field changed?
- Which validation command checked the result?
- Which rollback value restores the previous release?

That is the real skill behind Helm values. Values are release inputs connected to visible Kubernetes output.

## What's Next

You can now read values as release inputs and trace them through Helm template syntax. The next article follows Helm after rendering, where a chart, values, and rendered manifests create a cluster-side release record with history and rollback commands.

## References

- [Helm Values Files](https://helm.sh/docs/chart_template_guide/values_files/) - Official Helm guide to chart values, user-supplied values files, `--set`, and value precedence.
- [Helm Template Functions and Pipelines](https://helm.sh/docs/chart_template_guide/functions_and_pipelines/) - Official Helm guide to functions, pipelines, `quote`, and `default`.
- [Helm Flow Control](https://helm.sh/docs/chart_template_guide/control_structures/) - Official Helm guide to `if`, `with`, `range`, whitespace control, and scope.
- [Helm Built-in Objects](https://helm.sh/docs/chart_template_guide/builtin_objects/) - Official Helm guide to `.Values`, `.Release`, `.Chart`, `.Capabilities`, and other built-in objects.
- [Helm Charts: Schema Files](https://helm.sh/docs/topics/charts/#schema-files) - Official chart documentation for `values.schema.json` and schema validation.
- [helm template](https://helm.sh/docs/helm/helm_template/) - Official command reference for rendering chart templates locally.
- [helm lint](https://helm.sh/docs/helm/helm_lint/) - Official command reference for checking chart structure and values schema issues.
- [Helm Install](https://helm.sh/docs/helm/helm_install/) - Official command reference for install-time values files, `--set`, dry runs, and generated manifests.
- [Helm Upgrade](https://helm.sh/docs/helm/helm_upgrade/) - Official command reference for upgrade-time values merging and release updates.
- [Kubernetes ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) - Official Kubernetes guide to plain configuration data consumed by Pods.
- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Official Kubernetes guide to secret data and separate handling.
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Official Kubernetes guide to stable network access for Pods.
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - Official Kubernetes guide to HTTP routing through Ingress resources.
