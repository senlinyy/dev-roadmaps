---
title: "Helm Charts"
description: "Read and build Helm charts that render predictable Kubernetes manifests for an application."
overview: "A Helm chart is a reusable program whose metadata, values, templates, helpers, dependencies, and release context generate concrete Kubernetes resources."
tags: ["helm", "charts", "templates", "kubernetes"]
order: 2
id: article-containers-orchestration-kubernetes-packaging-helm-charts
---

## Table of Contents

1. [What does Helm package for one application?](#what-does-helm-package-for-one-application)
2. [How does the chart directory divide its responsibilities?](#how-does-the-chart-directory-divide-its-responsibilities)
3. [How do chart version and application version describe different things?](#how-do-chart-version-and-application-version-describe-different-things)
4. [How do release inputs become fields in Kubernetes objects?](#how-do-release-inputs-become-fields-in-kubernetes-objects)
5. [How can helpers keep related objects consistent?](#how-can-helpers-keep-related-objects-consistent)
6. [When do dependencies or CRDs change the chart boundary?](#when-do-dependencies-or-crds-change-the-chart-boundary)
7. [How can a team inspect the full result before install or upgrade?](#how-can-a-team-inspect-the-full-result-before-install-or-upgrade)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

Kubernetes does not understand Helm charts. It understands concrete API objects. Helm runs before the API server, combining a reusable chart, configuration, and release context into the manifests Kubernetes receives.

The central model is that a chart is a parameterized program that generates Kubernetes manifests. Helm's work belongs to the delivery layer; Kubernetes begins reconciling only after it receives the concrete objects.

Seven questions explain that transformation:

1. **What does Helm package for one application?**
2. **How does the chart directory divide its responsibilities?**
3. **How do chart version and application version describe different things?**
4. **How do release inputs become fields in Kubernetes objects?**
5. **How can helpers keep related objects consistent?**
6. **When do dependencies or CRDs change the chart boundary?**
7. **How can a team inspect the full result before install or upgrade?**

## What does Helm package for one application?
<!-- section-summary: A chart packages metadata, default inputs, rendering logic, reusable helpers, and optional dependencies or CRDs—not the application binary itself. -->

Start with an application that needs only a Deployment and a Service. Applying two ordinary manifests is simple:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-api
  template:
    metadata:
      labels:
        app: my-api
    spec:
      containers:
        - name: api
          image: mycompany/api:1.8.2
          ports:
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: my-api
spec:
  selector:
    app: my-api
  ports:
    - port: 80
      targetPort: 8080
```

The packaging problem appears when the same application must run in development, staging, and production. Development may need one replica and a moving image tag, staging two replicas and a pinned tag, and production ten replicas and the same pinned tag. Copying both manifests three times works, but every shared change must now be repeated.

The scale becomes clearer when the application also needs an Ingress, ConfigMap, ServiceAccount, HPA, PodDisruptionBudget, NetworkPolicy, and Secret—and when the organization deploys it to twenty environments. Most of those documents express the same application structure. Only a smaller set of values differs.

A useful model is:

```text
Chart        = reusable recipe
Values       = arguments
Release      = one named installation
Manifest     = rendered Kubernetes YAML
K8s objects  = resources created from that YAML
```

For `payments`, the reusable structure may include a Deployment, Service, ConfigMap, ServiceAccount, Ingress, and HPA. Values describe the replica count, image, resources, hostname, and feature choices that vary.

### Helm separates stable structure from deliberate variation

Without packaging, `payments` might have six manifests copied into development, staging, and production directories. Most fields—labels, selectors, ports, probes, and object structure—remain identical, while replicas, image tag, resources, hostnames, and flags vary.

Helm represents that difference directly:

```text
reusable object structure in templates
                  +
environment and release inputs in values
                  ↓
          complete Kubernetes YAML
```

The point is not to make every environment identical. It is to keep shared structure in one place and make intentional differences visible as inputs.

A chart archive such as `payments-chart-1.4.0.tgz` can generate a Deployment that runs `ghcr.io/acme/payments:2.7.1`. The archive contains deployment instructions; the application image remains in a container registry.

The chart boundary should represent one deployable unit with a coherent owner and lifecycle. It can be a Deployment and Service, or a larger set of application resources, but it should not collect unrelated systems merely because Helm can render them.

The parameterized field is the smallest version of the idea:

```gotemplate
replicas: {{ .Values.replicaCount }}
```

with an input such as:

```yaml
replicaCount: 10
```

Helm preserves one resource definition and substitutes the chosen environment value. Templates can then apply the same principle to image tags, resources, hostnames, optional objects, and other deliberate variations.

### The chart packages deployment logic, not the application binary

The chart can select `ghcr.io/acme/payments:2.7.1`, but the image remains in the registry. This distinction lets a chart package describe how to deploy an application without pretending to contain the executable application itself.

An OCI image packages code, runtime, and libraries: **what should run**. A chart packages Deployment, Service, Ingress, ConfigMap, HPA, and related configuration: **how Kubernetes should run it**. The Deployment template connects them by placing the selected image reference into the container specification.

Helm also does not remove the need to understand Kubernetes YAML. Most chart templates remain ordinary `apiVersion`, `kind`, `metadata`, and `spec` structures with expressions inserted at selected fields. The most useful question when reading any chart is still: “What concrete Kubernetes objects will this produce?”

## How does the chart directory divide its responsibilities?
<!-- section-summary: Each reserved chart path answers a different packaging question, separating metadata, defaults, validation, object templates, shared logic, dependencies, and API extensions. -->

```text
payments/
├── Chart.yaml
├── Chart.lock
├── values.yaml
├── values.schema.json
├── templates/
│   ├── _helpers.tpl
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── serviceaccount.yaml
│   ├── ingress.yaml
│   └── NOTES.txt
├── charts/
└── crds/
```

| Part | Responsibility |
|---|---|
| `Chart.yaml` | Chart identity, version, type, description, and dependencies |
| `values.yaml` | Default configuration inputs |
| `values.schema.json` | Allowed value shape and types |
| `templates/` | Rules that generate Kubernetes objects |
| `_helpers.tpl` | Reusable naming, labels, and domain rules |
| `NOTES.txt` | Post-install information for the user |
| `charts/` | Resolved dependency charts |
| `Chart.lock` | Exact resolved dependency state |
| `crds/` | CustomResourceDefinitions installed before ordinary chart resources |

Templates whose names begin with an underscore do not directly emit manifests. They normally define reusable templates for other files.

### Read the directory as a set of questions

`Chart.yaml` identifies the reusable package. `values.yaml` defines its default public inputs. `values.schema.json` rejects invalid input shapes before they become broken manifests. Files under `templates/` generate objects, while `_helpers.tpl` provides shared rules such as names and selectors. Dependencies expand the release through `charts/`, and CRDs can expand the API itself through `crds/`.

Keeping those responsibilities distinct makes an error easier to localize. A malformed value contract, a broken template, an unresolved dependency, and a lifecycle-sensitive CRD are different package problems even though one install command encounters all of them.

### Template context supplies more than user values

The leading dot in `{{ .Values.image.repository }}` means “the current template context.” Helm supplies several built-in objects through that context:

| Object | What it contributes |
|---|---|
| `.Values` | The final merged configuration inputs |
| `.Release` | Release name, namespace, revision, and service information |
| `.Chart` | Metadata read from `Chart.yaml` |
| `.Capabilities` | Kubernetes API capabilities available to rendering |
| `.Files` | Non-template files packaged in the chart |
| `.Template` | Information about the template currently being rendered |

For example, `.Release.Name` is the installation identity supplied to `helm install`, `.Release.Namespace` is the target namespace, and `.Chart.Name` comes from `Chart.yaml`. A name expression can combine them:

```gotemplate
metadata:
  name: {{ .Release.Name }}-{{ .Chart.Name }}
```

Installing chart `payments-api` as release `production` can therefore produce `production-payments-api`.

### Templates can express choices and repetition

Go templates do more than substitute scalar values. A chart can conditionally generate an object:

```gotemplate
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
...
{{- end }}
```

It can also iterate over a collection with `range`, assign variables, call functions, and include named templates. That power should remain controlled. Deeply nested conditions, ranges, includes, and ternaries turn the deployment package into a difficult program embedded in YAML. Strong charts expose a comprehensible interface and keep the generation rules direct enough that a reviewer can predict the output.

## How do chart version and application version describe different things?
<!-- section-summary: apiVersion selects the chart format, version identifies the chart package, and appVersion describes the represented application without automatically controlling its image. -->

```yaml
apiVersion: v2
name: payments
version: 1.4.0
appVersion: "2.7.1"
description: Payments API
type: application
```

These versions are separate:

- `apiVersion: v2` selects the Helm chart file format;
- `version: 1.4.0` is the SemVer version of the chart package;
- `appVersion: "2.7.1"` is application metadata.

A template-only annotation fix can publish chart `1.4.1` while leaving application `2.7.1` unchanged. A new application that needs chart changes can become chart `1.5.0` and app `2.8.0`.

`appVersion` does not automatically select an image. A chart author can create that policy:

```gotemplate
image: "{{ .Values.image.repository }}:{{ default .Chart.AppVersion .Values.image.tag }}"
```

The fallback exists because the template connects the two fields, not because Helm assumes that connection.

### Version the package and software independently

A label or annotation fix in the Deployment template changes the deployment definition without changing the application binary. Publishing chart `1.4.1` with application `2.7.1` records that distinction. Conversely, application `2.8.0` may require new values or object structure and therefore travel with chart `1.5.0`.

This separation tells an operator which artifact changed: the reusable deployment program, the represented software, or both.

## How do release inputs become fields in Kubernetes objects?
<!-- section-summary: Helm merges values and built-in release information, evaluates templates, and emits ordinary YAML with every expression resolved. -->

### A chart is reusable source; a release is one installed instance

Keep these two terms separate:

```text
Chart   = reusable package
Release = one named installation of that package
```

One PostgreSQL chart can be installed as releases `customer-db` and `analytics-db`. The first can use three replicas and 500 GiB of storage; the second can use one replica and 2 TiB. They share package source but have different names, values, generated resources, and histories.

That is why the command shape includes a release name:

```bash
helm install payments ./my-api
```

`payments` identifies the installation; `./my-api` identifies the chart. Helm can later apply an upgrade or rollback to `payments` without confusing it with another installation of the same chart.

Defaults:

```yaml
replicaCount: 2
image:
  repository: ghcr.io/acme/payments
  tag: "2.7.1"
service:
  type: ClusterIP
  port: 8080
```

Template:

```gotemplate
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "payments.fullname" . }}
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: payments
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          ports:
            - containerPort: {{ .Values.service.port }}
```

This install supplies a release name and overrides one value:

```bash
helm install prod ./payments --set replicaCount=5
```

Templates can read `.Values`, `.Release`, `.Chart`, `.Capabilities`, and `.Template`. Rendering might produce Deployment `prod-payments` with five replicas, image `ghcr.io/acme/payments:2.7.1`, and container port 8080.

### Rendering combines several namespaces of input

The transformation can be written as:

```text
manifests = Render(
  templates,
  merged values,
  release identity,
  chart metadata,
  cluster capabilities
)
```

`.Values` supplies configuration, `.Release` supplies information such as the installation name and revision, `.Chart` exposes package metadata, and `.Capabilities` describes supported Kubernetes capabilities. The template author decides how those inputs become fields.

Values are layered from chart defaults through parent-chart overrides, user-supplied files, and command-line overrides. In `helm install payments ./payments -f prod.yaml --set replicaCount=10`, the command-line value becomes the effective replica count.

The same chart can also produce independent releases such as `payments-eu` and `payments-us`. Each has its own name, namespace, values, generated object names, and revision history. An upgrade increments `.Release.Revision`.

The chart is reusable source; a release is one named invocation of it. This is why two installations can share templates while producing separate Kubernetes identities and histories.

### Follow one small chart from source to objects

Suppose `payments` contains `Chart.yaml`, `values.yaml`, `_helpers.tpl`, `deployment.yaml`, and `service.yaml`. Defaults specify two replicas, Service port 80, and container port 8080. Installing release `prod` with `--set replicas=5` gives the renderer:

```text
Chart.Name = payments
Chart.AppVersion = 2.7.1
Release.Name = prod
Values.replicas = 5
Values.service.port = 80
Values.containerPort = 8080
```

The result can contain Deployment and Service `prod-payments`. Both receive the same helper-generated labels; the Deployment creates five Pods listening on 8080, and the Service selects those Pods while exposing port 80. That concrete relationship—not the template braces—is what Kubernetes sees.

Scale that example into a realistic release. The same chart can contain Deployment, Service, Ingress, HPA, and helpers. Defaults may choose two replicas, a moving image tag, disabled ingress, and disabled autoscaling:

```yaml
replicaCount: 2
image:
  repository: ghcr.io/company/payments
  tag: latest
service:
  port: 8080
ingress:
  enabled: false
  host: payments.example.com
autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 10
```

Production supplies only its deliberate differences:

```yaml
replicaCount: 4
image:
  tag: "9b82134"
ingress:
  enabled: true
  host: payments.company.com
autoscaling:
  enabled: true
  minReplicas: 4
  maxReplicas: 20
```

```bash
helm upgrade --install payments ./payments \
  --namespace payments \
  --create-namespace \
  -f production.yaml
```

Helm can submit Deployment, `ClusterIP` Service, Ingress, and HPA objects. Kubernetes controllers then create the ReplicaSet and Pods that appear in `kubectl get all`. The distinction between Helm-generated objects and controller-generated runtime objects remains visible even in this larger example.

The result contains no `.Values` or template braces. It is ordinary Kubernetes YAML. A Helm template failure, invalid generated YAML, API schema rejection, and a CrashLooping application belong to four different layers.

### Follow `helm install` through both systems

When Helm installs a release, it reads `Chart.yaml`, defaults, supplied value files, command-line overrides, and every relevant template. It merges the values, evaluates the templates, and submits the resulting objects to the Kubernetes API server.

```text
Chart.yaml + values + templates
              |
              v
         Helm rendering
              |
              v
     Deployment, Service, ConfigMap
              |
              v
        Kubernetes API server
```

At that boundary, Kubernetes takes over. The API server persists desired state. A Deployment controller creates a ReplicaSet, the ReplicaSet controller creates Pods, the scheduler selects Nodes, and each kubelet asks the container runtime to start the selected image.

Helm does not remain in the runtime loop. If one of three Pods dies later, the ReplicaSet controller observes that actual replicas fell below desired replicas and creates a replacement. Helm created the desired-state resources; Kubernetes controllers continuously reconcile them.

### Helm records release revisions inside the cluster

Helm is both a renderer and a release manager. The first installation creates release revision 1. Each later upgrade creates another revision:

```bash
helm upgrade payments ./my-api --set image.tag=2.9.0
helm upgrade payments ./my-api --set image.tag=3.0.0
helm history payments
```

Conceptually, the history is:

```text
payments revision 1 -> image 2.8.1
payments revision 2 -> image 2.9.0
payments revision 3 -> image 3.0.0
```

If revision 3 is unsuitable, `helm rollback payments 2` makes revision 2's recorded release configuration the recovery input. Helm 3 normally stores release information as Kubernetes Secrets with names such as `sh.helm.release.v1.payments.v1`. It needs no permanent Helm server in the cluster. Helm 2 used a server-side component named Tiller; Helm 3 removed it.

### `upgrade --install` gives automation one convergent command

Plain `helm install` fails when a release with that name already exists. Delivery pipelines commonly use:

```bash
helm upgrade --install payments ./chart \
  --namespace production \
  --set image.tag="$GIT_SHA"
```

If `payments` does not exist, Helm installs it. If it does exist, Helm upgrades it. The chart does not need to know the build-specific image tag; the pipeline supplies that value at release time.

The complete delivery chain is then:

```text
Git commit
-> OCI image build
-> chart + production values + image tag
-> Helm rendering
-> Kubernetes Deployment
-> ReplicaSet
-> scheduled Pods
-> kubelet and container runtime
-> application process
```

This locates Helm precisely above the Kubernetes API-object layer. It does not participate in CRI, CNI, Linux namespaces, cgroups, or application process supervision.

## How can helpers keep related objects consistent?
<!-- section-summary: Named helpers encode cross-object invariants such as names and selector labels so separate templates cannot drift apart. -->

A Service must select the labels created by the Deployment's Pod template. Repeating those labels by hand invites a one-character mismatch.

```gotemplate
{{- define "payments.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

Use the helper in the Deployment selector, Pod labels, and Service selector:

```gotemplate
selector:
  matchLabels:
    {{- include "payments.selectorLabels" . | nindent 4 }}
```

Now one rule maintains the relationship. Helpers commonly centralize full names, ServiceAccount names, selector labels, chart labels, and common labels. They encode domain invariants, not just text deduplication.

### Helpers protect relationships between separate objects

A chart can render successfully while a Service selects zero Pods because one template says `payment` and another says `payments`. Centralizing selector labels in a helper makes the Deployment selector, Pod labels, and Service selector derive from the same rule.

That is a cross-object invariant: the generated documents must agree with one another. Naming, ServiceAccount selection, and shared ownership labels have the same property.

## When do dependencies or CRDs change the chart boundary?
<!-- section-summary: Dependencies add another chart's rendered resources to the release, while CRDs extend the Kubernetes API and follow a special, lifecycle-sensitive installation path. -->

A chart can declare a PostgreSQL dependency:

```yaml
dependencies:
  - name: postgresql
    version: 16.x.x
    repository: https://example.com/charts
```

Dependency charts resolve into `charts/`, while `Chart.lock` records the resolved state so `helm dependency build` can reconstruct it. Their rendered objects join the parent release, so the release boundary is larger than the parent `templates/` directory.

Use `helm dependency update ./payments` when resolving the dependency declarations and refreshing the downloaded dependencies and lock state. Use `helm dependency build ./payments` when reconstructing the dependency directory from the chart's recorded lock state. The first maintains the resolved dependency set; the second makes a build reproduce that recorded set.

### Dependencies expand the release output

If `payments` depends on a PostgreSQL chart, the full release can include the parent Deployment and Service plus the subchart's StatefulSet, Service, Secret, and storage resources. Looking only at the parent templates understates what the release owns and what an upgrade may change.

CRDs are different. A file in `crds/` can teach Kubernetes a new kind, after which ordinary templates can create Custom Resources of that type. Helm installs those CRDs before other chart resources, does not template them, skips existing CRDs, and does not manage them through the normal upgrade and delete lifecycle because unsafe CRD changes can cause data loss.

Large systems may separate an operator's CRDs, controller, and application Custom Resources into distinct charts. Dependencies and CRDs are architectural boundary choices, not merely directory features.

The separation can give each lifecycle a clearer owner: one chart establishes API types, another operates the controller, and an application chart creates Custom Resources. Combining them can be correct, but the boundary must account for CRD upgrade and deletion risks rather than treating the directory as an ordinary template folder.

### Packaged charts can move through repositories and OCI registries

`helm package ./my-api` turns a chart directory into an archive such as `my-api-1.4.0.tgz`. A chart repository makes packaged charts discoverable through commands such as `helm repo add` and installable by repository name. Helm can also store charts in OCI registries, placing deployment packages beside the container-image ecosystem used by the applications they reference.

This creates two separately versioned artifacts:

```text
OCI image:  my-api:2.8.1
Helm chart: my-api-chart:1.4.0
```

The image contains the executable environment. The chart contains the Kubernetes deployment program. An organization can promote and audit each artifact independently while explicitly recording which chart configuration selects which image.

### Helm, Kustomize, and Operators own different kinds of work

Helm begins from templates and values, then generates YAML. Kustomize begins from valid Kubernetes YAML and composes transformations through bases and overlays. Reusable third-party packages commonly use Helm; internally owned environment overlays may favor Kustomize; many organizations use both.

An Operator is different again. Helm acts when a user or delivery system runs install, upgrade, rollback, or uninstall. An Operator is a continuously running controller with domain-specific reconciliation logic. A PostgreSQL chart might create a StatefulSet, Service, ConfigMap, and Secret. A PostgreSQL Operator can continuously reason about topology, replication, failover, backup state, health, and upgrade strategy.

That distinction also clarifies ownership. A Deployment has a Kubernetes controller ownership chain through ReplicaSet to Pod, represented through mechanisms such as `ownerReferences` and understood by garbage collection. Helm labels and annotates resources and records them as part of a release, but a Helm release does not own a Deployment in the same controller sense. Package/release management and Kubernetes controller ownership are separate abstraction layers.

## How can a team inspect the full result before install or upgrade?
<!-- section-summary: Lint, resolve dependencies, render exact inputs, use server-aware dry run, and compare the recorded release manifest with live Kubernetes behavior. -->

Do not mentally execute templates. Render them:

```bash
helm lint ./payments
helm dependency build ./payments

helm template payments-prod ./payments \
  --namespace production \
  -f values-prod.yaml
```

`helm template` renders locally and does not perform API-server validation. A server-side install dry run exercises the selected cluster more closely:

```bash
helm install payments-prod ./payments \
  --namespace production \
  -f values-prod.yaml \
  --dry-run=server \
  --debug
```

Dry-run output can expose rendered Secret data, so handle it accordingly.

After installation, inspect what Helm recorded:

```bash
helm get manifest payments-prod --namespace production
helm get values payments-prod --namespace production --all
```

`helm get manifest` includes resources rendered by dependencies. Then use `kubectl get`, `describe`, Events, and logs to determine what Kubernetes and the application did with the submitted resources.

### Each inspection step proves a different layer

Use the sequence deliberately:

1. `helm lint` checks common chart structure and template problems.
2. `helm dependency build` resolves the locked dependency set.
3. `helm template` shows the exact local YAML for selected inputs.
4. server-side dry run asks the selected API server to process the proposal without persistence.
5. `helm get manifest` and `helm get values --all` show what Helm recorded for the installed release.
6. `kubectl` status, Events, and logs show how Kubernetes controllers and application processes behaved.

A `nil pointer evaluating .Values.foo` belongs to template evaluation. Malformed generated YAML belongs to rendering. An API validation error belongs to the Kubernetes object contract. `CrashLoopBackOff` happens later, after Kubernetes accepted the object and attempted to run the application. The layer determines the investigation.

### Use the everyday command sequence to expose the complete model

A compact practical workflow exercises nearly every Helm concept:

```bash
helm create my-api
helm template my-api ./my-api
helm install my-api ./my-api
helm list
helm status my-api
helm get manifest my-api
helm upgrade my-api ./my-api --set replicaCount=5
helm history my-api
helm rollback my-api 1
helm uninstall my-api
```

`helm create` provides the chart structure. `helm template` proves rendering without changing the cluster. `install` creates the named release. `list` and `status` inspect release identity and state. `get manifest` shows the exact Kubernetes YAML Helm recorded. `upgrade` produces another revision, `history` exposes those revisions, `rollback` selects an earlier one, and `uninstall` removes the release-managed resources.

### Keep the six Helm nouns separate

| Concept | Meaning |
|---|---|
| Chart | Reusable Kubernetes application package |
| Template | Parameterized Kubernetes YAML |
| Values | Inputs supplied to templates |
| Rendered manifest | Final ordinary Kubernetes YAML |
| Release | One named installation of a chart |
| Revision | One historical state of that release |

The whole system fits into three layers:

```text
APPLICATION PACKAGING
chart + production values
          |
          | Helm rendering
          v
KUBERNETES API OBJECTS
Deployment + Service + ConfigMap + HPA
          |
          | Kubernetes reconciliation
          v
KUBERNETES RUNTIME
ReplicaSet -> Pods -> kubelet -> container runtime -> application
```

Helm owns the transformation from reusable application configuration to concrete resources. Kubernetes owns the transformation from desired resources to the running system. Keeping that handoff explicit prevents Helm from being mistaken for another scheduler, runtime, networking component, or continuously reconciling controller.

## Check Your Answers
<!-- section-summary: Rebuild a chart from its package boundary, directory roles, versions, rendering inputs, helpers, dependencies, CRDs, and inspection workflow. -->

:::expand[What does Helm package for one application?]{kind="recap"}
A chart packages metadata, defaults, validation, templates, helpers, and optional dependencies or CRDs that generate one coherent set of Kubernetes resources.
:::

:::expand[How does the chart directory divide its responsibilities?]{kind="recap"}
`Chart.yaml` identifies the package, `values.yaml` supplies defaults, `templates/` generates objects, helpers share rules, schemas validate inputs, and reserved directories hold dependencies and CRDs.
:::

:::expand[How do chart version and application version describe different things?]{kind="recap"}
Chart `version` identifies the deployment package. `appVersion` describes the represented application and controls an image only when a template explicitly connects them.
:::

:::expand[How do release inputs become fields in Kubernetes objects?]{kind="recap"}
Helm merges values with release and chart context, evaluates templates, and emits concrete fields in ordinary Kubernetes manifests.
:::

:::expand[How can helpers keep related objects consistent?]{kind="recap"}
Helpers give related templates one source for names, labels, selectors, and other cross-object invariants.
:::

:::expand[When do dependencies or CRDs change the chart boundary?]{kind="recap"}
Dependencies add their objects to the release. CRDs extend the Kubernetes API and follow Helm's special install-only lifecycle behavior.
:::

:::expand[How can a team inspect the full result before install or upgrade?]{kind="recap"}
Lint, build dependencies, render exact values, use server-side dry run, inspect Helm's recorded manifest and values, then inspect live Kubernetes state.
:::

## References

- [Helm charts](https://helm.sh/docs/topics/charts/)
- [Chart template guide](https://helm.sh/docs/chart_template_guide/)
- [Built-in objects](https://helm.sh/docs/chart_template_guide/builtin_objects/)
- [Chart tests and debugging](https://helm.sh/docs/chart_template_guide/debugging/)
- [Custom Resource Definitions](https://helm.sh/docs/chart_best_practices/custom_resource_definitions/)
