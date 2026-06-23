---
title: "Kubernetes RBAC and Secrets"
description: "Control Kubernetes API access and deliver application secrets without giving workloads unnecessary power."
overview: "Kubernetes RBAC decides what people and workloads can do through the API server, while Secrets deliver sensitive values to pods. This article follows a checkout API team as they scope service account permissions, test access with kubectl, protect tokens, and handle database credentials safely."
tags: ["rbac", "secrets", "kubernetes", "service-accounts", "etcd"]
order: 1
id: article-devsecops-kubernetes-security-rbac-and-secrets
aliases:
  - kubernetes-rbac
  - secrets-in-kubernetes
  - article-devsecops-kubernetes-security-kubernetes-rbac
  - article-devsecops-kubernetes-security-secrets-in-kubernetes
  - devsecops/kubernetes-security/kubernetes-rbac.md
  - devsecops/kubernetes-security/secrets-in-kubernetes.md
  - devsecops/kubernetes-security/01-kubernetes-rbac-and-secrets.md
  - devsecops/kubernetes-security/01-kubernetes-rbac-and-secrets
  - kubernetes-security/01-kubernetes-rbac-and-secrets
---

## Table of Contents

1. [The Checkout API Scenario](#the-checkout-api-scenario)
2. [Every Important Action Goes Through the API Server](#every-important-action-goes-through-the-api-server)
3. [Service Accounts Give Pods a Kubernetes Identity](#service-accounts-give-pods-a-kubernetes-identity)
4. [RBAC Rules Say Which API Calls Are Allowed](#rbac-rules-say-which-api-calls-are-allowed)
5. [Roles and ClusterRoles Define Permission Scope](#roles-and-clusterroles-define-permission-scope)
6. [RoleBindings and ClusterRoleBindings Attach Permissions](#rolebindings-and-clusterrolebindings-attach-permissions)
7. [What a Compromised Pod Can Do With an Overpowered Token](#what-a-compromised-pod-can-do-with-an-overpowered-token)
8. [Check Effective Access With kubectl](#check-effective-access-with-kubectl)
9. [Secrets Hold Sensitive Application Data](#secrets-hold-sensitive-application-data)
10. [Mount Secrets Carefully Inside Pods](#mount-secrets-carefully-inside-pods)
11. [Encrypt Secrets at Rest](#encrypt-secrets-at-rest)
12. [Use External Secret Managers for Production Workflows](#use-external-secret-managers-for-production-workflows)
13. [Least-Privilege Review Checklist](#least-privilege-review-checklist)
14. [Putting It All Together](#putting-it-all-together)
15. [What's Next](#whats-next)

## The Checkout API Scenario
<!-- section-summary: We will follow one small production service so RBAC and Secret choices stay tied to real operational decisions. -->

Imagine a small SaaS team running an online checkout system in Kubernetes. The team has a `checkout-prod` namespace with a `checkout-api` Deployment, a PostgreSQL database, a payment provider token, and a deployment pipeline that updates the API during releases. The service is important because every customer purchase passes through it, so the team wants enough automation to deploy safely without giving every pod and pipeline a master key to the cluster.

Two kinds of access matter right away. The first kind is **Kubernetes API access**. The deployment pipeline needs to patch the `checkout-api` Deployment, read rollout status, and inspect pod logs when a release fails. The running `checkout-api` pods usually need very little Kubernetes API access. Most web applications serve HTTP traffic and talk to databases; they do not need to list every Secret or create workloads.

The second kind is **application secret access**. The checkout service needs a database password and a payment API token. Those values need to reach the application at runtime, but they should stay out of Git history, container images, logs, and broad Kubernetes permissions.

This article connects those two areas because they meet in a real incident. If an attacker gets code execution inside one pod, they can often read files and environment variables inside that pod. If the pod has a powerful service account token, the attacker may also call the Kubernetes API. If that token can read Secrets across the namespace or cluster, a single vulnerable container can turn into a much larger compromise.

## Every Important Action Goes Through the API Server
<!-- section-summary: Kubernetes protects cluster state by checking each API request before it reaches stored objects or running workloads. -->

Kubernetes has one central front door for cluster changes: the **API server**. When a developer runs `kubectl get pods`, a CI job patches a Deployment, a controller creates a ReplicaSet, or a pod asks for its own service account token, the request goes through the API server.

That request usually passes through three checks. **Authentication** identifies the caller. The caller might be a human user from an identity provider, a CI credential, or a service account used by a pod. **Authorization** decides whether that caller can perform the requested action. **Admission control** can inspect or change the submitted object before Kubernetes stores it.

RBAC sits in the authorization step. RBAC means **Role-Based Access Control**. In Kubernetes, it answers a practical question: can this subject perform this verb on this resource in this scope? For the checkout team, that question sounds like this: can the `checkout-deployer` service account patch Deployments in the `checkout-prod` namespace?

The API server stores Kubernetes objects in etcd, the cluster's backing data store. Secrets, Deployments, RoleBindings, service accounts, and many other objects all travel through the same API path. That is why RBAC and Secrets belong together in the first Kubernetes security lesson. If access to the API server is too broad, sensitive data and workload control both become exposed.

![Kubernetes API request path showing a checkout pod using a ServiceAccount, reaching the API server, passing through an RBAC decision, and reaching or being denied Secret access](/content-assets/articles/article-devsecops-kubernetes-security-rbac-and-secrets/rbac-api-request-path.png)

*This view ties the pod identity, the API server, the RBAC decision, and Secret access into one request path, so the security boundary is visible before we write any YAML.*

## Service Accounts Give Pods a Kubernetes Identity
<!-- section-summary: A service account is the identity a workload uses when it talks to the Kubernetes API. -->

A **ServiceAccount** is a Kubernetes identity for an application, controller, job, or other non-human workload. Human users usually come from outside Kubernetes, such as a company identity provider. Pods use service accounts because the API server needs a name for the workload making a request.

Every namespace has a service account named `default`. If a pod spec does not choose a service account, Kubernetes assigns that default service account. That convenience helps new workloads start quickly, but it can hide an important security decision. A production pod should usually name the service account it expects to use, even if that service account has no special permissions.

For the checkout API, create a dedicated service account:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: checkout-api
  namespace: checkout-prod
automountServiceAccountToken: false
```

The `automountServiceAccountToken: false` setting tells Kubernetes not to automatically mount an API token into pods that use this service account. That is a good default for a web API that only needs database and payment credentials. If the application never calls the Kubernetes API, it should not receive a Kubernetes API token as a free extra credential.

The deployment pipeline is different. It needs to talk to the API server during releases, so it gets a separate service account:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: checkout-deployer
  namespace: checkout-prod
automountServiceAccountToken: true
```

This split matters. The checkout runtime identity and the deployment identity have different jobs. The runtime service account should run the app. The deployer service account should update Kubernetes objects. Giving both identities the same permissions makes reviews confusing and increases the blast radius of a stolen token.

You can check which service account a running pod uses:

```bash
kubectl get pod -n checkout-prod -l app=checkout-api \
  -o jsonpath='{range .items[*]}{.metadata.name}{" -> "}{.spec.serviceAccountName}{"\n"}{end}'
```

You can also inspect whether Kubernetes mounted the service account token into a pod:

```bash
kubectl exec -n checkout-prod deploy/checkout-api -- \
  sh -c 'ls -l /var/run/secrets/kubernetes.io/serviceaccount 2>/dev/null || echo "no service account token mounted"'
```

If the application does not need Kubernetes API access, the safer result is `no service account token mounted`. If a token exists, treat it like a live credential. Anyone with shell access inside the container may be able to copy it and use it against the API server until the token expires or access is removed.

## RBAC Rules Say Which API Calls Are Allowed
<!-- section-summary: RBAC rules combine subjects, verbs, resources, and scope into explicit Kubernetes API permissions. -->

RBAC uses a few simple pieces. A **subject** is the identity receiving access. Kubernetes RBAC subjects can be users, groups, or service accounts. A **verb** is the action, such as `get`, `list`, `watch`, `create`, `update`, `patch`, or `delete`. A **resource** is the API object, such as `pods`, `deployments`, `secrets`, or the `pods/log` subresource. A **scope** says whether the permission applies inside one namespace or across the cluster.

The checkout deployer needs a small set of permissions. It needs to read and patch the `checkout-api` Deployment. It needs to watch pods during rollout. It needs to read logs for troubleshooting failed releases. It does not need to read Secrets. It does not need to create ClusterRoles. It does not need to change RoleBindings.

That last sentence is where real security reviews often start. A request like "the deployer needs Kubernetes access" is too broad. A better request names the exact workflow: "the deployer needs to patch one Deployment in `checkout-prod`, read rollout state, and fetch logs for pods in that namespace." That version can become RBAC YAML.

RBAC has an important default shape: access must be explicitly granted. If no rule allows a request, Kubernetes denies it. RBAC can grant permissions, and other authorization layers or admission policies may still block risky requests later in the request path.

## Roles and ClusterRoles Define Permission Scope
<!-- section-summary: Roles define namespace permissions, while ClusterRoles define reusable or cluster-wide permission sets. -->

A **Role** is a namespaced permission object. It can grant access to resources inside one namespace. For the checkout deployer, a Role is the right first choice because the release job only works in `checkout-prod`.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: checkout-deployer
  namespace: checkout-prod
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    resourceNames: ["checkout-api"]
    verbs: ["get", "patch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

The first rule uses `apiGroups: ["apps"]` because Deployments live in the `apps` API group. It uses `resourceNames: ["checkout-api"]` so the deployer can patch that named Deployment rather than every Deployment in the namespace. The second rule lets the deployer observe pods during rollout. The third rule allows log reads through the `pods/log` subresource.

A **ClusterRole** is a cluster-scoped permission object. It can describe permissions for cluster-scoped resources such as `nodes`, `namespaces`, and `persistentvolumes`. It can also define a reusable permission set that a RoleBinding grants inside one namespace. Kubernetes ships default ClusterRoles such as `view`, `edit`, and `admin`, and many cluster add-ons create ClusterRoles for controllers that genuinely need cluster-wide access.

ClusterRoles deserve extra review because their scope can grow through binding choices. A ClusterRole that allows `get`, `list`, and `watch` on Secrets may expose sensitive data if a ClusterRoleBinding attaches it broadly. A ClusterRole that can create pods may let a compromised identity launch new workloads. A ClusterRole that can update RBAC objects may let an identity grant itself more power.

For application teams, start with a namespaced Role. Reach for a ClusterRole when the workload truly needs cluster-scoped resources, or when the platform team intentionally maintains a reusable permission set. The checkout deployer works inside one namespace, so the Role keeps the access boundary clear.

## RoleBindings and ClusterRoleBindings Attach Permissions
<!-- section-summary: Permission rules do nothing until a binding attaches them to a user, group, or service account. -->

A Role or ClusterRole only defines permissions. A **RoleBinding** or **ClusterRoleBinding** grants those permissions to subjects.

A **RoleBinding** grants permissions inside one namespace. It can point to a Role in the same namespace, or it can point to a ClusterRole and limit that ClusterRole's permissions to the RoleBinding namespace. For the checkout deployer, bind the namespaced Role to the dedicated service account:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: checkout-deployer
  namespace: checkout-prod
subjects:
  - kind: ServiceAccount
    name: checkout-deployer
    namespace: checkout-prod
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: checkout-deployer
```

This grants the `checkout-deployer` Role to one service account in one namespace. It does not give the runtime `checkout-api` service account deployment permissions. It does not grant access in `kube-system`, `payments-prod`, or another team namespace.

A **ClusterRoleBinding** grants the referenced ClusterRole across the whole cluster. That is right for some platform components, such as a cluster monitoring agent that needs to watch nodes or a controller that manages resources in many namespaces. It is dangerous for ordinary application service accounts because one compromised namespace can turn into cluster-wide access.

Review bindings with the subject in mind. A binding to `system:serviceaccounts` can affect all service accounts. A binding to `system:serviceaccounts:checkout-prod` can affect every service account in one namespace. A binding to `system:authenticated` can affect every authenticated user and service account. Those broad subjects need strong justification.

![RBAC scope comparison showing Role and RoleBinding granting pod and Secret access inside one namespace, while ClusterRole and ClusterRoleBinding can reach cluster-level resources such as Nodes](/content-assets/articles/article-devsecops-kubernetes-security-rbac-and-secrets/rbac-scope-bindings.png)

*The left side shows the safer default for application teams: permissions stay inside one namespace. The right side shows why cluster-scope bindings deserve a slower review.*

## What a Compromised Pod Can Do With an Overpowered Token
<!-- section-summary: A stolen service account token gives the attacker whatever API permissions RBAC granted to that service account. -->

Now connect the pieces to an incident. The checkout API has a dependency vulnerability that gives an attacker command execution inside one application container. The attacker runs a shell command and finds a mounted service account token:

```bash
TOKEN_PATH=/var/run/secrets/kubernetes.io/serviceaccount/token
CA_PATH=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
NS_PATH=/var/run/secrets/kubernetes.io/serviceaccount/namespace

test -f "$TOKEN_PATH" && echo "token is mounted"
cat "$NS_PATH"
```

Inside a pod, Kubernetes also exposes the API server host through environment variables in many clusters:

```bash
env | grep KUBERNETES_SERVICE
```

With the token, the attacker can try API calls from inside the pod:

```bash
APISERVER="https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT}"
NAMESPACE="$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)"
TOKEN="$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)"

curl --cacert /var/run/secrets/kubernetes.io/serviceaccount/ca.crt \
  -H "Authorization: Bearer ${TOKEN}" \
  "${APISERVER}/api/v1/namespaces/${NAMESPACE}/secrets"
```

If RBAC grants that service account `list secrets`, the attacker can read every Secret in the namespace from that one API call. If RBAC grants cluster-wide Secret access through a ClusterRoleBinding, the attacker can read Secrets across namespaces. If RBAC grants `create pods`, the attacker may start a new pod with a different image. If RBAC grants `update rolebindings` or `escalate` style access through RBAC resources, the attacker may change permissions and grow their access.

The vulnerable library started the incident, but the service account decides the blast radius. A runtime service account with no token and no useful API permissions gives the attacker much less Kubernetes control. A deployer token mounted into the web API pod gives the attacker a release bot identity. A cluster-admin token turns a container bug into a cluster incident.

## Check Effective Access With kubectl
<!-- section-summary: Effective permission checks prove what a service account can actually do after all bindings are applied. -->

RBAC YAML can look reasonable while a second binding grants extra access somewhere else. Use `kubectl auth can-i` to ask the API server about the effective authorization result.

Check the checkout deployer permissions:

```bash
kubectl auth can-i patch deployments.apps/checkout-api \
  --as=system:serviceaccount:checkout-prod:checkout-deployer \
  -n checkout-prod

kubectl auth can-i get pods/log \
  --as=system:serviceaccount:checkout-prod:checkout-deployer \
  -n checkout-prod

kubectl auth can-i list secrets \
  --as=system:serviceaccount:checkout-prod:checkout-deployer \
  -n checkout-prod

kubectl auth can-i update rolebindings.rbac.authorization.k8s.io \
  --as=system:serviceaccount:checkout-prod:checkout-deployer \
  -n checkout-prod
```

For the Role shown earlier, the first two checks should return `yes`, and the last two should return `no`. That gives the deployer the release actions it needs while blocking Secret reads and RBAC changes.

Check the runtime checkout API identity too:

```bash
kubectl auth can-i list secrets \
  --as=system:serviceaccount:checkout-prod:checkout-api \
  -n checkout-prod

kubectl auth can-i create pods \
  --as=system:serviceaccount:checkout-prod:checkout-api \
  -n checkout-prod

kubectl auth can-i get pods \
  --as=system:serviceaccount:checkout-prod:checkout-api \
  -n kube-system
```

For a normal web API, these should usually return `no`. That outcome is healthy. The application can still read its mounted database credential from the filesystem, but it cannot use the Kubernetes API to browse other objects.

To find existing RBAC grants for a service account, inspect RoleBindings in the namespace and ClusterRoleBindings across the cluster:

```bash
kubectl get rolebinding -n checkout-prod -o wide
kubectl describe rolebinding -n checkout-prod checkout-deployer

kubectl get clusterrolebinding -o wide | grep checkout-prod || true
```

Some teams also use this review during incident response. If a pod was compromised, list the pod's service account, run `kubectl auth can-i --list` as that service account, then check whether the account could read Secrets, create pods, exec into pods, or modify RBAC. Those answers guide the rest of the investigation.

## Secrets Hold Sensitive Application Data
<!-- section-summary: Kubernetes Secrets store sensitive values as API objects, so RBAC and storage protection both matter. -->

A Kubernetes **Secret** stores sensitive data such as passwords, tokens, TLS keys, SSH keys, and database connection strings. Secrets are API objects, so the same API server and RBAC path controls access to them.

Here is a simple Secret for the checkout database:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: checkout-db
  namespace: checkout-prod
type: Opaque
stringData:
  username: checkout_api
  password: replace-with-a-real-generated-password
```

The `stringData` field lets you write clear text in the manifest you send to the API server. Kubernetes stores the value in the Secret's `data` field as Base64-encoded content. Base64 is reversible text formatting. It helps binary data fit into YAML and JSON, while cryptographic protection requires encryption with keys.

You can see the stored shape with `kubectl`:

```bash
kubectl get secret checkout-db -n checkout-prod -o jsonpath='{.data.password}{"\n"}'
```

You can decode a value if you have API access to read the Secret:

```bash
kubectl get secret checkout-db -n checkout-prod \
  -o jsonpath='{.data.password}' | base64 --decode
echo
```

That command is useful for understanding the risk. Anyone who can `get` a Secret can recover the secret value. Anyone who can `list` Secrets can often recover many values at once because the list response includes the objects. Treat `get`, `list`, and `watch` on Secrets as powerful permissions.

Production teams also avoid committing raw Secret manifests with real values. Git history lasts a long time, pull requests copy content into review systems, and local clones spread to many machines. The safer pattern is to keep secret values in a controlled secret manager, then deliver them to Kubernetes through automation.

## Mount Secrets Carefully Inside Pods
<!-- section-summary: Mounted Secret files usually expose less accidental data than environment variables and can receive kubelet updates. -->

After the checkout database password exists as a Kubernetes Secret, the application needs to read it. Kubernetes supports two common delivery patterns: environment variables and mounted files.

Environment variables are simple:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-api
  namespace: checkout-prod
spec:
  template:
    spec:
      serviceAccountName: checkout-api
      automountServiceAccountToken: false
      containers:
        - name: checkout-api
          image: ghcr.io/example/checkout-api:1.8.0
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: checkout-db
                  key: password
```

This works, and many applications support it. The tradeoff is exposure. Environment variables often appear in crash dumps, debug output, support bundles, process inspection, and accidental logging. They also stay fixed for the life of the process. If the Secret changes, the running process still has the old environment value until the pod restarts.

Mounted files are often a better default for sensitive values:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-api
  namespace: checkout-prod
spec:
  selector:
    matchLabels:
      app: checkout-api
  template:
    metadata:
      labels:
        app: checkout-api
    spec:
      serviceAccountName: checkout-api
      automountServiceAccountToken: false
      containers:
        - name: checkout-api
          image: ghcr.io/example/checkout-api:1.8.0
          volumeMounts:
            - name: checkout-db-secret
              mountPath: /var/run/secrets/checkout-db
              readOnly: true
      volumes:
        - name: checkout-db-secret
          secret:
            secretName: checkout-db
            items:
              - key: username
                path: username
              - key: password
                path: password
```

The application reads `/var/run/secrets/checkout-db/username` and `/var/run/secrets/checkout-db/password`. The volume is read-only from the container's point of view. Kubernetes can update mounted Secret content after the Secret changes, although the application must reopen or reread the file to use the new value. Some apps need a restart after rotation, and some apps support live reload.

You can verify the pod sees only the mounted files:

```bash
kubectl exec -n checkout-prod deploy/checkout-api -- \
  sh -c 'find /var/run/secrets -maxdepth 3 -type f -print'
```

Do not use broad Secret mounts. Mount the specific Secret keys the application needs, under an application-specific path, as read-only files. Avoid mounting the Kubernetes service account token beside application credentials unless the workload actually calls the Kubernetes API.

## Encrypt Secrets at Rest
<!-- section-summary: RBAC controls API access, while encryption at rest protects Secret data in the backing store. -->

RBAC controls who can read a Secret through the API server. Encryption at rest controls how Secret data is protected in the Kubernetes backing store. Kubernetes can encrypt Secret data before writing it to etcd by using an API server encryption configuration.

This matters because etcd snapshots and disks may move through backup systems, restore workflows, and administrator machines. If Secret data sits there in clear form, anyone with access to those files may recover application credentials. Encryption at rest adds a separate cryptographic protection layer for stored Secret data.

A simplified encryption configuration can look like this:

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - kms:
          apiVersion: v2
          name: platform-kms
          endpoint: unix:///var/run/kms-provider/socket.sock
      - identity: {}
```

The provider order matters. The API server uses the first provider to write new data. The `identity` provider at the end can still read older unencrypted data during migration. Managed Kubernetes platforms often expose this through a cloud KMS integration rather than a hand-written API server file, but the idea stays the same: Secret values should be encrypted before they land in the backing store.

After enabling encryption, existing Secrets may need to be rewritten so Kubernetes stores them with the new provider. A common administrative pattern is to read and replace the Secret object without changing its data:

```bash
kubectl get secrets -A

kubectl get secret checkout-db -n checkout-prod -o yaml | kubectl replace -f -
```

Run this kind of migration through your platform team's normal change process. Test restore workflows, record which KMS key protects the data, and keep access to that key limited. Encryption at rest helps storage risk, while RBAC still controls API risk.

## Use External Secret Managers for Production Workflows
<!-- section-summary: External secret managers keep source values outside the cluster and let Kubernetes receive only the runtime copy it needs. -->

Many production teams keep source secret values in an external secret manager such as a cloud secret service or HashiCorp Vault. Kubernetes then receives a short operational copy for the workload, often through a controller.

The pattern has three parts. The **external secret manager** stores the real value and handles rotation, audit, and access policy. A **Kubernetes controller** reads the approved external value and writes or refreshes a Kubernetes Secret. The **pod** consumes the Kubernetes Secret through a mounted file or environment variable.

External Secrets Operator is one common implementation of this pattern. It uses resources such as `SecretStore` or `ClusterSecretStore` to describe the provider connection, and `ExternalSecret` to describe which external value should sync into a Kubernetes Secret.

Here is a shortened example:

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: checkout-db
  namespace: checkout-prod
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: platform-secrets
    kind: SecretStore
  target:
    name: checkout-db
  data:
    - secretKey: password
      remoteRef:
        key: prod/checkout/db
        property: password
```

This example tells the controller to sync the external `prod/checkout/db` password into a Kubernetes Secret named `checkout-db`. The application still mounts the Kubernetes Secret. The source value stays in the external manager, where the security team can apply provider IAM, audit access, and rotate credentials.

This pattern still needs RBAC review. The external secrets controller needs permission to write Secrets in target namespaces. Application service accounts usually do not need permission to read Secret objects through the API. They only need the Secret mounted into their own pod. Keep those permissions separate.

## Least-Privilege Review Checklist
<!-- section-summary: A practical RBAC and Secret review checks identity, tokens, bindings, Secret access, and operational proof. -->

Least privilege means each identity gets the smallest useful set of permissions for its job. In Kubernetes, review the service account, the bindings, the verbs, the resources, and the way Secrets reach the pod.

Start with identity inventory:

```bash
kubectl get serviceaccount -n checkout-prod

kubectl get deploy checkout-api -n checkout-prod \
  -o jsonpath='{.spec.template.spec.serviceAccountName}{"\n"}'

kubectl get deploy checkout-api -n checkout-prod \
  -o jsonpath='{.spec.template.spec.automountServiceAccountToken}{"\n"}'
```

Then review RBAC grants:

```bash
kubectl get role,rolebinding -n checkout-prod
kubectl get clusterrolebinding -o wide | grep checkout || true
```

Look for risky verbs and resources:

```bash
kubectl auth can-i list secrets \
  --as=system:serviceaccount:checkout-prod:checkout-api \
  -n checkout-prod

kubectl auth can-i create pods \
  --as=system:serviceaccount:checkout-prod:checkout-api \
  -n checkout-prod

kubectl auth can-i update rolebindings.rbac.authorization.k8s.io \
  --as=system:serviceaccount:checkout-prod:checkout-api \
  -n checkout-prod

kubectl auth can-i '*' '*' \
  --as=system:serviceaccount:checkout-prod:checkout-api \
  -n checkout-prod
```

The last command checks for very broad access in the namespace. A normal application runtime identity should return `no`.

Next, review Secret usage:

```bash
kubectl get secret -n checkout-prod

kubectl get deploy checkout-api -n checkout-prod -o yaml | \
  grep -E 'secretName|secretKeyRef|automountServiceAccountToken|serviceAccountName'
```

For each Secret, ask who can read it through the API, which pods mount it, whether the value comes from a controlled source, and how rotation works. Check that real secret values stay out of Git. Confirm the cluster or managed service has Secret encryption at rest enabled. Review etcd snapshot access with the same seriousness as database backup access.

Finally, record the intended access in a short review note. For the checkout API, the note might say: runtime service account has no API token and no RBAC grants; deployer service account can patch only the `checkout-api` Deployment, read pods, and read pod logs in `checkout-prod`; no checkout service account can read Secrets through the API; database password reaches the app through a read-only mounted Secret file; source secret lives in the external secret manager.

## Putting It All Together
<!-- section-summary: Safe Kubernetes access keeps runtime identity, deployment identity, Secret delivery, and storage protection separate. -->

The checkout team now has a safer access shape.

The `checkout-api` runtime service account exists so pods have an explicit identity, but it does not automatically mount a Kubernetes API token. The application receives its database password through a read-only Secret volume, scoped to the exact keys it needs. The service account has no RBAC grants to list Secrets, create pods, or change bindings.

The `checkout-deployer` service account handles releases. A namespaced Role lets it patch the `checkout-api` Deployment, watch pods, and read logs in `checkout-prod`. A RoleBinding attaches that Role to the deployer identity. No ClusterRoleBinding grants this application identity cluster-wide power.

The team tests those claims with `kubectl auth can-i`, not by trusting YAML at a glance. They check both the intended `yes` permissions and the important `no` permissions. They also check which service account a pod uses and whether a token is mounted.

Secrets receive separate protection. RBAC limits API reads. Mounted files reduce accidental process-level exposure compared with environment variables. Encryption at rest protects stored Secret data in etcd and backups. An external secret manager pattern keeps the source value in a system built for audit, rotation, and provider-level access control.

![Least-privilege review loop showing separate identity, can-i tests, a small Role, Secret mounting, and audit evidence around a checkout service](/content-assets/articles/article-devsecops-kubernetes-security-rbac-and-secrets/rbac-secrets-review-loop.png)

*The summary loop shows the operational habit behind the article: give each workload its own identity, prove access with `can-i`, keep Roles small, mount only needed Secrets, and leave audit evidence for the next review.*

This is the baseline for Kubernetes security work. A vulnerable pod may still happen. A failed rollout may still happen. The goal is to make sure one application bug does not grant cluster-wide control, and one deployment identity does not become a Secret-reading superuser.

## What's Next

RBAC and Secrets control what a workload can ask Kubernetes to do and which sensitive values it can receive. The next layer is the pod runtime itself.

In the next article, **Pod Security and Runtime Hardening**, we will look at security contexts, running as non-root, dropping Linux capabilities, read-only root filesystems, seccomp, AppArmor, and image choices. Those controls reduce what code can do inside the container and on the node after the pod starts.

---

## References

- [Kubernetes RBAC authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) - Official guide for Roles, ClusterRoles, RoleBindings, ClusterRoleBindings, subjects, verbs, and default roles.
- [Kubernetes authorization overview](https://kubernetes.io/docs/reference/access-authn-authz/authorization/) - Official explanation of how Kubernetes authorizes API requests.
- [Kubernetes service accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) - Official documentation for workload identities, service account tokens, and pod assignment.
- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Official documentation for Secret objects, Secret types, mounted volumes, and environment variable usage.
- [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/) - Kubernetes guidance for least-privilege Secret access, encryption, and safer consumption.
- [Encrypting confidential data at rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) - Official task guide for Kubernetes API server encryption configuration.
- [RBAC good practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/) - Kubernetes guidance for least privilege, token handling, and risky permissions.
- [External Secrets Operator documentation](https://external-secrets.io/latest/) - Official documentation for syncing values from external secret managers into Kubernetes Secrets.
- [NSA and CISA Kubernetes hardening guidance](https://www.nsa.gov/Press-Room/News-Highlights/Article/Article/2716980/nsa-cisa-release-kubernetes-hardening-guidance/) - Primary government guidance for Kubernetes hardening themes such as least privilege, secrets, and workload isolation.
