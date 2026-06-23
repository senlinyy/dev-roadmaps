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
2. [The Default values.yaml](#the-default-valuesyaml)
3. [Staging and Production Values Files](#staging-and-production-values-files)
4. [How Helm Builds the Final Values](#how-helm-builds-the-final-values)
5. [Values That Render Real Kubernetes Objects](#values-that-render-real-kubernetes-objects)
6. [Required Values and Schema Validation](#required-values-and-schema-validation)
7. [Keeping Secrets Out of Values](#keeping-secrets-out-of-values)
8. [Reviewing Values in CI](#reviewing-values-in-ci)
9. [Production Review Habits](#production-review-habits)
10. [What's Next](#whats-next)

## Values Are Chart Inputs
<!-- section-summary: Values are the YAML inputs Helm templates read, so one chart can render different Kubernetes manifests for each environment. -->

When a team packages `devpolaris-orders-api` with Helm, the chart holds the reusable shape of the application. The chart knows the app needs a **Deployment** for Pods, a **Service** for stable network access, a **ConfigMap** for plain runtime settings, and maybe an **Ingress** or **Gateway** for outside traffic.

**Helm values** are the inputs that change that shape for a target environment. A value can say production needs three replicas, staging needs one replica, the image tag for this release is `2026.06.16.1`, and the production hostname is `orders.devpolaris.example`. The template reads those inputs through `.Values`, then Helm renders normal Kubernetes YAML.

That split gives the team a useful boundary. The chart answers, "What objects does this service usually need?" The values files answer, "Which choices do we want for this environment and release?" When reviewers see that boundary clearly, they can discuss application decisions instead of decoding copied Kubernetes files.

Here is the small set of files we will follow through the article. The names stay plain so the deployment path is easy to follow during review.

```
charts/orders-api/
  Chart.yaml
  values.yaml
  values.schema.json
  templates/
    deployment.yaml
    service.yaml
    configmap.yaml
    ingress.yaml
environments/
  staging.values.yaml
  prod.values.yaml
```

The chart belongs to the application package. The environment files belong to the release process. A real team might keep them in the same repository or in a deployment repository, but the review habit stays the same: every environment-specific value should look intentional.

## The Default values.yaml
<!-- section-summary: The default values file gives the chart safe built-in inputs before staging or production overrides add environment decisions. -->

The default `values.yaml` file is the chart's starting point. Helm loads it before user-supplied files, so it should describe a safe and understandable default shape for the service. For `devpolaris-orders-api`, that means a render that works for local review or a development namespace without needing production secrets or production hostnames.

Defaults should explain the chart contract without pretending to know every environment. The chart can provide a repository, a sample tag, a normal container port, baseline probes, and small resource requests. Staging and production can override the parts that need different operating choices.

```yaml
replicaCount: 2

image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16-dev"
  pullPolicy: IfNotPresent

service:
  port: 8080

config:
  logLevel: info
  catalogUrl: http://catalog-api.devpolaris-dev.svc.cluster.local:8080

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    memory: 256Mi

ingress:
  enabled: false
  host: ""
```

This file gives readers a quick tour of the chart. It says the app listens on port `8080`, reads plain settings through a ConfigMap, and supports optional HTTP routing. It also shows that the chart expects an image tag every time it renders.

Good defaults keep the chart easy to try. Risky defaults create surprise later, especially when they disable probes, remove resource requests, or enable public routing. Production teams usually treat `values.yaml` as the lowest-risk baseline and put environment risk decisions in named override files where reviewers can see them.

## Staging and Production Values Files
<!-- section-summary: Environment values files hold the small set of choices that differ between staging, production, preview, and other release targets. -->

After the chart has clear defaults, the next question is where environment differences should live. A **values override file** is a YAML file passed with `-f` or `--values` during `helm template`, `helm install`, or `helm upgrade`. It layers target-specific choices on top of the chart defaults.

For the orders API, staging and production use the same chart because they run the same application shape. They differ in image tag, replica count, hostnames, and a few app settings. Those differences deserve their own files because they describe release intent.

```yaml
replicaCount: 1

image:
  tag: "2026.06.16-rc.2"

config:
  logLevel: debug
  catalogUrl: http://catalog-api.devpolaris-staging.svc.cluster.local:8080

ingress:
  enabled: true
  host: orders.staging.devpolaris.example
```

That staging file tells a normal story. Staging runs fewer replicas, uses a release-candidate image, logs more detail, and exposes a staging hostname. A reviewer can read those choices without opening the template engine in their head.

Production can stay just as direct. It makes the higher-risk choices visible in one place.

```yaml
replicaCount: 3

image:
  tag: "2026.06.16.1"

config:
  logLevel: info
  catalogUrl: http://catalog-api.devpolaris-prod.svc.cluster.local:8080

resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    memory: 512Mi

ingress:
  enabled: true
  host: orders.devpolaris.example
```

The production file makes capacity, routing, and runtime settings visible. It avoids copying the whole default file because repeated YAML hides the important changes. In day-to-day production work, a short values file gives reviewers a much better signal than a large file with mostly unchanged defaults.

Preview environments can use the same pattern. A pull request environment might set `replicaCount: 1`, a temporary image tag, and a generated hostname such as `orders-pr-184.devpolaris.example`. The important part is that the file describes the target rather than the person running the command.

## How Helm Builds the Final Values
<!-- section-summary: Helm merges chart defaults, values files, and command-line settings in a specific order, and later inputs win over earlier inputs. -->

Now the team has defaults plus environment files. The next thing to understand is **merge order**, because merge order decides which value wins when two inputs set the same key. Helm starts with the chart's `values.yaml`, applies any values files from left to right, and then applies command-line settings such as `--set`.

For a production render, the command might look like this. The release name is `orders`, and the values file supplies the production choices.

```bash
helm template orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml
```

Helm first reads `charts/orders-api/values.yaml`. Then it layers `environments/prod.values.yaml` on top. The final `.Values.replicaCount` is `3` because production overrides the default `2`, and the final `.Values.image.repository` still comes from the chart default because production only overrides the tag.

Multiple values files make the order more important. Teams sometimes use a shared company file, then an environment file, then a short hotfix file. Helm gives priority to the right-most file, so the last `-f` wins for the same key.

```bash
helm template orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/common.values.yaml \
  -f environments/prod.values.yaml
```

Command-line overrides sit at the top of this stack. They help during a controlled emergency or a quick local render, but they can disappear from code review if the team uses them for normal releases.

```bash
helm template orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml \
  --set image.tag=2026.06.16-hotfix.1
```

That command produces a real render with the hotfix image. The release decision now lives in shell history, CI logs, or a deployment record instead of a reviewed values file. For planned production releases, a committed values change gives the team cleaner audit evidence.

Here is the merge story in one small table. The table shows how each later input changes only the fields it sets.

| Source | `replicaCount` | `image.repository` | `image.tag` |
|---|---:|---|---|
| `values.yaml` | 2 | `ghcr.io/devpolaris/orders-api` | `2026.06.16-dev` |
| `prod.values.yaml` | 3 | unchanged | `2026.06.16.1` |
| `--set image.tag=hotfix.1` | unchanged | unchanged | `hotfix.1` |

The rendered manifest only has one image tag and one replica count. Reviewers should care about that final output because Kubernetes never sees the merge history. Kubernetes only receives the YAML Helm sends after template rendering.

![Helm values merge order showing chart defaults, staging file, production file, CLI override, final values, and later inputs winning](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/values-merge-order.png)

*The merge stack is useful during review because it shows where the final values came from, even though Kubernetes only receives the rendered result.*

## Values That Render Real Kubernetes Objects
<!-- section-summary: Values matter because they land in Deployment, Service, ConfigMap, and routing manifests that Kubernetes actually reconciles. -->

Values can look harmless while they sit in YAML. They affect production only after templates place them into Kubernetes objects. That is why a values review should connect each important input to the manifest field it changes.

The orders API Deployment uses values for replicas, image, environment, and resources. The template stays readable because each value has a specific purpose.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "orders-api.fullname" . }}
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
    app.kubernetes.io/instance: {{ .Release.Name }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-orders-api
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: devpolaris-orders-api
        app.kubernetes.io/instance: {{ .Release.Name }}
    spec:
      containers:
        - name: api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: {{ .Values.service.port }}
          envFrom:
            - configMapRef:
                name: {{ include "orders-api.fullname" . }}-config
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

The Service can use the same `service.port` value so the workload and the stable cluster endpoint stay aligned. A mismatch here can break traffic even when the Pods run.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "orders-api.fullname" . }}
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
    app.kubernetes.io/instance: {{ .Release.Name }}
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: devpolaris-orders-api
    app.kubernetes.io/instance: {{ .Release.Name }}
  ports:
    - name: http
      port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.port }}
```

The ConfigMap shows a different kind of value. It carries plain application configuration rather than Kubernetes scheduling or networking choices. `LOG_LEVEL` and `CATALOG_URL` make sense here because they are useful at runtime and safe to store in Git.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "orders-api.fullname" . }}-config
data:
  LOG_LEVEL: {{ .Values.config.logLevel | quote }}
  CATALOG_URL: {{ .Values.config.catalogUrl | quote }}
```

Routing can stay optional. Some teams still use Ingress, while newer platform teams may expose HTTP through Gateway API. The values should express the business decision, such as host and enabled state, while the chart template owns the object shape chosen by the platform.

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "orders-api.fullname" . }}
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

This is the main review loop. A value changes, a template renders it, and a Kubernetes object receives the final field. If that chain stays visible, values files help teams move fast without hiding production risk.

![Helm values becoming Kubernetes objects, with image tag, replicas, resources, and host landing in Deployment, Service, and Ingress output](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/values-become-objects.png)

*Values stay understandable when each important input maps to a real Kubernetes field reviewers can inspect in the rendered output.*

## Required Values and Schema Validation
<!-- section-summary: Required checks and values.schema.json turn the chart's expected inputs into a contract that fails early during render and release commands. -->

A **values contract** is the agreement between the chart and the person supplying values. The chart says which inputs it understands and what shape they should have. The release file supplies those inputs for staging, production, or preview.

Helm gives chart authors two practical tools for that contract. Template-level `required` checks create friendly failures for values that the template needs. A `values.schema.json` file validates the final `.Values` object before Helm finishes template, install, upgrade, or lint commands.

The image tag is a good `required` candidate because a blank tag can push a bad image reference into a Deployment. The template can fail with a message that tells the release author exactly what went missing.

```yaml
image: "{{ .Values.image.repository }}:{{ required "image.tag is required" .Values.image.tag }}"
```

The failure points to the missing decision. That message helps the release author fix the input instead of hunting through the rendered Deployment.

```bash
helm template orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml
```

```
Error: execution error at (orders-api/templates/deployment.yaml:26:47):
image.tag is required
```

Schema validation catches a wider class of mistakes. It can require `replicaCount` to be an integer, require `image.repository` and `image.tag`, restrict `config.logLevel`, and make sure `ingress.host` has a string value. That protects reviewers from mistakes that YAML makes easy, such as quoting a number and accidentally sending a string.

```json
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["replicaCount", "image", "service", "config"],
  "properties": {
    "replicaCount": {
      "type": "integer",
      "minimum": 1
    },
    "image": {
      "type": "object",
      "required": ["repository", "tag"],
      "properties": {
        "repository": { "type": "string", "minLength": 1 },
        "tag": { "type": "string", "minLength": 1 },
        "pullPolicy": { "type": "string" }
      }
    },
    "service": {
      "type": "object",
      "properties": {
        "port": {
          "type": "integer",
          "minimum": 1,
          "maximum": 65535
        }
      }
    },
    "config": {
      "type": "object",
      "properties": {
        "logLevel": {
          "type": "string",
          "enum": ["debug", "info", "warn", "error"]
        },
        "catalogUrl": { "type": "string", "minLength": 1 }
      }
    },
    "ingress": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "host": { "type": "string" }
      }
    }
  }
}
```

A broken production file can now fail before anyone applies manifests to the cluster. The schema turns a vague YAML mistake into a clear release check.

```yaml
replicaCount: "three"

image:
  tag: "2026.06.16.1"
```

```bash
helm lint ./charts/orders-api -f environments/prod.values.yaml
```

```
Error: values don't meet the specifications of the schema(s):
orders-api:
- replicaCount: Invalid type. Expected: integer, given: string
```

The schema works best together with rendered review. The schema catches input shape problems, while rendered review checks output meaning. Real teams use both because they answer different questions.

## Keeping Secrets Out of Values
<!-- section-summary: Plain values files should reference secret objects or secret-management outputs instead of storing credentials in Git. -->

Values files usually live in Git, appear in pull requests, and show up in CI logs. That makes them a poor home for database passwords, API tokens, signing keys, and private credentials. Kubernetes Secrets also need careful handling, but a plain Helm values file is especially easy to leak because many render commands print the resulting YAML.

For `devpolaris-orders-api`, values can safely carry `LOG_LEVEL` and `CATALOG_URL`. They should avoid carrying `PAYMENTS_API_TOKEN`, database passwords, or webhook signing secrets. The chart can reference a Secret by name while a separate secret-management flow creates the Secret object.

```yaml
secrets:
  existingSecretName: orders-api-runtime-secrets
```

The Deployment can consume that Secret without putting secret data inside the values file. The reference creates an explicit dependency on a Secret object that should already exist in the namespace.

```yaml
envFrom:
  - configMapRef:
      name: {{ include "orders-api.fullname" . }}-config
  - secretRef:
      name: {{ .Values.secrets.existingSecretName }}
```

This pattern gives reviewers a clear dependency. The release needs a Secret named `orders-api-runtime-secrets` in `devpolaris-prod`, and the chart needs permission to reference it. The secret value itself should come from the team's approved path, such as an external secret controller, a sealed secret workflow, or a platform-managed provisioning step.

CI also needs discipline here. `helm template --debug` and `helm install --dry-run` can print rendered Secret manifests, so teams should use options that hide Secrets when their Helm version supports them and should treat render logs as sensitive. The safer design keeps raw secret values out of Helm values before the command even runs.

## Reviewing Values in CI
<!-- section-summary: CI should render every environment file, validate schemas, and show reviewers the exact Kubernetes changes caused by a values edit. -->

By this point, the chart has defaults, environment values, schema validation, and a secret boundary. The next production question is review. A pull request that changes `prod.values.yaml` should show both the input change and the rendered Kubernetes output.

A simple CI job can run the chart checks without talking to a cluster. This gives reviewers a rendered artifact even when the pull request only changes values.

```bash
helm dependency build ./charts/orders-api
helm lint ./charts/orders-api -f environments/staging.values.yaml
helm lint ./charts/orders-api -f environments/prod.values.yaml
helm template orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml \
  > rendered/prod-orders-api.yaml
```

That render gives reviewers something concrete. They can inspect `Deployment.spec.replicas`, the container image, resource requests, ConfigMap data, Service port, and Ingress host. A values-only pull request should still produce a manifest diff because Helm values exist to change manifests.

For example, a production capacity change might look like this in the values file. The author is changing CPU requests because traffic has grown.

```diff
 resources:
   requests:
-    cpu: 250m
+    cpu: 400m
     memory: 256Mi
```

The rendered diff should show the same intent in the Deployment and avoid unrelated changes. That diff proves the values edit landed in the expected Kubernetes field.

```diff
 kind: Deployment
 metadata:
   name: orders-devpolaris-orders-api
 spec:
   template:
     spec:
       containers:
         - name: api
           resources:
             requests:
-              cpu: 250m
+              cpu: 400m
               memory: 256Mi
```

If the rendered diff also changes the image tag, hostname, or replica count, the pull request now contains more than a CPU request change. The reviewer can ask for a split change or a clearer release note. This habit keeps small operational decisions small.

CI can also run a server-side dry run against a test cluster when the team has access to one. That check asks the Kubernetes API server to validate the rendered objects against the cluster's registered APIs. It catches issues beyond client-side rendering, especially around CRDs, admission policies, and cluster-specific versions.

```bash
helm template orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml \
  | kubectl apply --dry-run=server -f -
```

That command proves the API server accepts the objects. The release pipeline still needs rollout and smoke-test checks after Helm applies the manifests. Those later checks prove the application can run and serve traffic.

## Production Review Habits
<!-- section-summary: A healthy values process makes every production difference visible, validated, rendered, and connected to release evidence. -->

Values files work well when they read like a small production form. A reviewer should see which image, how many replicas, which host, which ConfigMap values, which resource requests, and which Secret reference the release will use. They should also see the rendered Kubernetes result because the cluster receives YAML after Helm processes the values.

For `devpolaris-orders-api`, a production values review should answer these questions. The table keeps the conversation focused on release evidence.

| Review area | What the reviewer checks | Example evidence |
|---|---|---|
| Image | The tag matches the approved build | `ghcr.io/devpolaris/orders-api:2026.06.16.1` |
| Capacity | Replica count and resources match expected traffic | `replicaCount: 3`, `cpu: 400m` |
| Configuration | ConfigMap values point to production dependencies | `catalog-api.devpolaris-prod.svc.cluster.local` |
| Routing | Hostname belongs to the right environment | `orders.devpolaris.example` |
| Secrets | Values reference a Secret name rather than raw data | `orders-api-runtime-secrets` |
| Validation | Schema, lint, and render checks passed | CI logs and rendered diff |

This table also helps incident review. If a rollout breaks after a values change, the team can inspect the same areas in reverse: input values, rendered manifest, live Deployment, live ConfigMap, live Secret reference, and application logs. That path keeps diagnosis grounded in actual objects.

A strong values process stays boring in the best way. Developers change a few clear inputs, CI renders the chart, reviewers inspect the exact output, and the release system applies the same output to Kubernetes. There is no hidden programming layer inside values, and there is no production-only command that nobody reviewed.

![Helm values CI review showing schema check, render each environment, secret boundary, diff, and approval](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-values/values-ci-review.png)

*CI keeps values changes reviewable by validating the input contract, rendering every important environment, checking secret boundaries, and showing the diff before approval.*

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
