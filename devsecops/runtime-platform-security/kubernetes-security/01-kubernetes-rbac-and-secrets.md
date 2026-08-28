---
title: "Kubernetes RBAC and Secrets"
description: "Give Kubernetes workloads narrow API identities and deliver sensitive values without granting unnecessary cluster or external-system authority."
overview: "Follow one payments API through the Kubernetes API request path, Service Accounts, RBAC verbs and scopes, Roles and bindings, effective-access checks, Secret storage and delivery, external secret managers, workload identity, audit evidence, and the compromised-Pod test."
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

1. [Why Does Kubernetes Security Begin at the API Server?](#why-does-kubernetes-security-begin-at-the-api-server)
2. [How Does RBAC Describe Allowed API Actions?](#how-does-rbac-describe-allowed-api-actions)
3. [How Do Roles and Bindings Set Permission Scope?](#how-do-roles-and-bindings-set-permission-scope)
4. [How Should a Pod Receive and Verify Its API Identity?](#how-should-a-pod-receive-and-verify-its-api-identity)
5. [What Does a Kubernetes Secret Protect and What Does It Not?](#what-does-a-kubernetes-secret-protect-and-what-does-it-not)
6. [How Should Secret Values Reach a Workload?](#how-should-secret-values-reach-a-workload)
7. [How Do RBAC, Secrets, and Other Capabilities Chain Together?](#how-do-rbac-secrets-and-other-capabilities-chain-together)
8. [What Does a Complete Least-privilege Review Look Like?](#what-does-a-complete-least-privilege-review-look-like)
9. [Check Your Answers](#check-your-answers)

Kubernetes is an API-controlled system. Users and automation usually do not log into a node and start containers directly. They submit objects such as Pods, Deployments, Services, Roles, and Secrets to the API server. Controllers observe those objects and work to make the cluster match the requested state.

The security boundary therefore begins before a container runs:

```text
caller
  -> authenticate identity
  -> authorize requested API action
  -> admit or reject requested object
  -> store accepted state
  -> controllers act on that state
  -> audit records describe the request
```

Authentication asks who the caller is. Authorization asks whether that identity may perform this verb on this resource in this scope. Admission examines the requested object after authorization and can apply broader policy. These stages solve different problems.

Every important API request needs an identity. A developer might authenticate through an external identity system. A deployment workflow can use a short-lived federated identity. A controller uses a Service Account. A Pod can also use a Service Account when it needs to call the Kubernetes API.

Keep these questions in view as you work through the lesson:

1. **Why Does Kubernetes Security Begin at the API Server?**
2. **How Does RBAC Describe Allowed API Actions?**
3. **How Do Roles and Bindings Set Permission Scope?**
4. **How Should a Pod Receive and Verify Its API Identity?**
5. **What Does a Kubernetes Secret Protect and What Does It Not?**
6. **How Should Secret Values Reach a Workload?**
7. **How Do RBAC, Secrets, and Other Capabilities Chain Together?**
8. **What Does a Complete Least-privilege Review Look Like?**

## Why Does Kubernetes Security Begin at the API Server?
<!-- section-summary: Kubernetes is an API-controlled desired-state system, so every human, controller, and Pod request crosses identity, authorization, admission, storage, and audit boundaries. -->

An identity is not permission. Knowing that the caller is `system:serviceaccount:payments:payments-api` only identifies the subject. RBAC bindings determine which actions that subject may perform.

Pods have runtime identities because applications and controllers sometimes need cluster data or actions. A custom controller might list a custom resource and update its status. A service might discover configuration through the API. But many ordinary applications only receive network requests and talk to external services. They do not need Kubernetes API access simply because they run in Kubernetes.

When a Pod uses a Service Account, the platform can provide a token representing that account. The token is presented to the API server and authenticated as the Service Account identity. RBAC is then evaluated for the requested operation.

```text
Pod process
  -> mounted Service Account token
  -> API server authenticates Service Account
  -> RBAC evaluates verb, resource, namespace, and name
  -> request allowed or denied
```

This creates a direct post-compromise concern. If attacker-controlled code can read the token, it can make the API calls allowed to that Service Account. The application vulnerability becomes an identity compromise. A narrow account contains the damage; a broad account turns one Pod into a cluster-control path.

The first least-privilege question is therefore not “which Role should this Pod have?” It is “does this process need Kubernetes API credentials at all?” If the answer is no, disable automatic token mounting. Absence of the credential is stronger than a broad credential that the application promises not to use.

The same request path applies when a controller acts rather than a person. A Deployment controller reads the requested replicas and creates or deletes ReplicaSets and Pods. A custom operator may watch its resources and create ordinary Kubernetes objects. Each controller is an API client with an identity and permission set, even though its actions look like automatic cluster behavior.

This matters for attribution. A user may create a Deployment, but the controller creates the resulting Pod. Audit evidence should preserve the relationship between the original desired-state change and later controller requests. An unexpected Pod can originate from an authorized controller processing a malicious or mistaken object, not only from a caller with direct Pod-create permission.

Authentication mechanisms also differ in how long authority remains available. A human session issued by an identity provider can be short-lived and tied to group membership. A CI system can exchange an external workload identity for a bounded token. A projected Service Account token can have an audience and expiration. A copied long-lived token remains useful until revoked or rotated. Prefer mechanisms that make stale standing credentials unnecessary.

The API server is not the only place an identity matters. The kubelet, container runtime, cloud provider, external secret manager, and application services can all receive identities. Keep the names and trust mappings clear. “The payments Service Account” should not ambiguously mean a Kubernetes subject, a cloud role, and a database user without a documented binding between them.

Finally, distinguish API reachability from API authority. A Pod may be able to open a connection to the API server yet receive authorization denial. Network policy may block the connection even for an authorized token. Strong design narrows both, but RBAC remains the definitive Kubernetes action decision once the request reaches the server.

## How Does RBAC Describe Allowed API Actions?
<!-- section-summary: Kubernetes RBAC is an allow-oriented policy over subjects, verbs, API resources, names, and scopes; precise rules grant only the actions a workload can justify. -->

Role-based access control, or RBAC, describes allowed Kubernetes API actions. A useful simplified rule has these dimensions:

```text
subject
  may perform verb
  on API resource
  in scope
  optionally limited to resource names
```

Common verbs include `get`, `list`, `watch`, `create`, `update`, `patch`, and `delete`. They are not interchangeable.

- `get` reads one named object.
- `list` reads a collection and often reveals every matching object in scope.
- `watch` receives a continuing stream of object changes.
- `create` introduces new desired state.
- `update` and `patch` change existing state.
- `delete` removes state and can trigger workload or data consequences.

Resource types include Pods, Deployments, ConfigMaps, Secrets, Jobs, Roles, RoleBindings, and many others. Subresources such as `pods/log`, `pods/exec`, and workload `status` can have separate security meaning.

Kubernetes RBAC is fundamentally allow-based. If no applicable rule grants the operation, it is denied. Adding a new RoleBinding can only add permissions to the subject; it does not subtract permission granted elsewhere. This makes effective access the union of all applicable bindings.

A small namespaced rule could allow reading one ConfigMap:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: read-payment-settings
  namespace: payments
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["payment-settings"]
    verbs: ["get"]
```

`resourceNames` can narrow a `get`, `update`, `patch`, or delete-style use case when the application accesses a known object. It cannot always constrain `list` or `watch` in the same way because collection operations are not a request for one object. If the workload only needs one named value, avoid granting collection visibility merely for convenience.

Wildcards deserve special attention:

```yaml
apiGroups: ["*"]
resources: ["*"]
verbs: ["*"]
```

They grant current and potentially future API types or operations. Installing a new custom resource can make a wildcard far more powerful than the controller originally required. Prefer explicit resource and verb lists, and review them after controller behavior changes.

Start reviews with verbs that change things: create, update, patch, delete, bind, escalate, impersonate, and access to execution-style subresources. Read permissions can still be powerful. Reading Secrets discloses credentials. Listing Pods reveals topology. Reading logs may expose data. Watching objects provides continuing surveillance.

RBAC evaluates Kubernetes API authorization. It does not decide whether an authenticated end user may refund a payment inside the application. Application authorization remains the service's responsibility. A Service Account Role cannot replace business permission checks, and application roles cannot control the Kubernetes API.

API groups prevent similarly named resources from being treated as the same object type. Core resources such as Pods and Secrets use the empty API group, while Deployments belong to the `apps` group and RBAC objects belong to `rbac.authorization.k8s.io`. A rule that names the wrong group may deny required work; a wildcard group may silently include more than intended.

Subresources deserve explicit review. Permission to read `pods/log` discloses application output. Permission to create `pods/exec` opens a command channel inside a running container. Approval, status, scale, eviction, and token subresources can represent narrower operations than full object update, but each still carries concrete authority. Grant the subresource rather than the whole resource when that matches the need.

`list` and `watch` often require broader thinking than `get`. A controller may genuinely need to reconcile every object matching its purpose, while an ordinary application typically knows the one object it needs. A watch also provides future state continuously for as long as the connection and credential remain valid. Collection access can expose names, labels, configuration, topology, and sometimes sensitive contents at scale.

Mutation verbs differ operationally. `create` introduces a new object but may still exploit an existing Service Account or Secret. `update` replaces the submitted object representation and usually requires reading resource version. `patch` can change a small field but may be enough to replace a container image or mount. `delete` can cause controllers to recreate an object or can remove data-bearing resources. Review consequence, not just verb spelling.

RBAC rules should remain understandable to the workload owner. Group resources that serve one justified function and split unrelated powers into separate roles. A controller that reads configuration and updates one status subresource is easier to reason about when those permissions are named separately from an emergency maintenance capability.

Because permissions only accumulate, removal is a design action. If the workload no longer uses an API call, delete the rule and run negative tests. Leaving old access “in case it is needed later” converts historical behavior into standing compromise power.

## How Do Roles and Bindings Set Permission Scope?
<!-- section-summary: Roles and ClusterRoles define permission sets, while RoleBindings and ClusterRoleBindings attach them to identities; attachment scope determines whether a reusable rule stays namespaced or becomes cluster-wide. -->

A Role defines permissions inside one namespace. It does not identify who receives them. A RoleBinding attaches a Role—or, in a useful pattern, a ClusterRole—to subjects in the RoleBinding's namespace.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payments-api-settings
  namespace: payments
subjects:
  - kind: ServiceAccount
    name: payments-api
    namespace: payments
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: read-payment-settings
```

The separation supports reuse and review:

```text
Role       -> which actions are allowed in this namespace?
RoleBinding-> which identities receive that permission here?
```

A ClusterRole defines rules at cluster scope and can include cluster-scoped resources such as Nodes. It can also define reusable rules for namespaced resources. The name “ClusterRole” does not automatically mean every subject receiving it gains cluster-wide access.

If a RoleBinding in namespace `payments` refers to a ClusterRole that reads ConfigMaps, the grant applies to ConfigMaps in `payments`. This is a useful way to define one standard read-only permission set and bind it separately in chosen namespaces.

A ClusterRoleBinding is different. It attaches a ClusterRole across the cluster. Binding a broad ClusterRole to a workload through a ClusterRoleBinding can let one compromised Pod act in every namespace or against cluster-scoped resources.

Think of RBAC as a graph:

```text
Service Account
  <- RoleBinding or ClusterRoleBinding
  <- Role or ClusterRole rules
  -> effective API actions
```

The graph can have many paths. A subject can belong to groups, receive several bindings, and use impersonation or service-account token creation if granted. Reviewing only the Role next to one Deployment can miss a separate ClusterRoleBinding that adds broad permission.

Permission to create Pods can be indirectly powerful. If an identity can create a Pod in a namespace, it may be able to select a more privileged Service Account, mount accessible Secrets, attach volumes, or request unsafe runtime settings unless admission and other controls block them. “Can create Pods” can become “can act with the authority available to Pods in this namespace.”

Permissions to modify Roles, RoleBindings, ClusterRoles, or ClusterRoleBindings are especially sensitive. They can let a caller grant itself or another identity more access. Kubernetes includes escalation and binding checks, but broad administrative rights or indirect paths can still be dangerous. Treat authorization-policy mutation as a privileged control-plane operation.

Namespaces provide useful scope. They support namespaced Roles, bindings, Secrets, workloads, quotas, and policy. They are not absolute security universes. Cluster-scoped resources, node sharing, networking, admission exceptions, and broadly bound identities can cross namespace boundaries.

A review should include the Role's scope, every binding to it, every role bound to the subject, group membership, namespace, resource names, and sensitive indirect capabilities. The answer sought is effective authority, not whether one YAML file looks small.

RoleBinding subjects can name users, groups, or Service Accounts. Service Account subjects include a namespace because accounts with the same name in different namespaces are distinct identities. Review tools and templates should not omit or default that namespace in a way that binds the wrong account.

A RoleBinding cannot grant access to cluster-scoped resources merely because it references a ClusterRole containing them; its binding scope is namespaced. A ClusterRoleBinding is required for a cluster-wide attachment. This makes RoleBinding to a reusable ClusterRole a valuable pattern, but only when the ClusterRole's namespaced rules are themselves narrow.

Cluster-level read access can still be sensitive. Listing Nodes reveals infrastructure. Reading namespace objects exposes organization structure. Watching cluster-scoped custom resources may reveal credentials or provider details depending on their schema. “Read only” at cluster scope is not automatically low risk.

RBAC mutation needs special graph review. An identity that can update an existing Role may add permissions up to what the authorization system allows it to grant. An identity able to bind a powerful ClusterRole can transfer that power to another subject. Impersonation can make requests as another user or group. Token creation can mint credentials for a Service Account. These are authority-changing operations, not ordinary configuration maintenance.

Workload creation is similarly indirect. A caller might not be able to read a Secret through the API but may create a Pod whose volume references that Secret and whose command sends the value elsewhere. Admission rules, Pod Security, namespace ownership, and network isolation help constrain this path, but the RBAC review should recognize the capability rather than assuming direct Secret denial is sufficient.

Graph reviews should include controllers acting on user-created objects. If a developer can create a custom resource and an overpowered operator turns it into cloud infrastructure or Kubernetes workloads, the custom-resource `create` permission carries the operator's mediated effects. The operator should validate inputs and constrain the actions it performs on behalf of less privileged subjects.

Prefer separate namespaces and bindings for workloads with materially different authority. A broad controller may need cluster scope, while an application does not. Co-locating them does not require sharing accounts, Roles, or deployer permissions. Boundary design should stop convenience from flattening their power.

## How Should a Pod Receive and Verify Its API Identity?
<!-- section-summary: Give each workload a dedicated Service Account only when API access is required, avoid automatic credentials otherwise, and test the exact effective actions from the workload's identity. -->

A Service Account gives Kubernetes a stable identity name for a workload. It does not grant permission until a binding connects it to rules. This makes dedicated accounts cheap and useful for attribution.

Define one explicitly:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payments-api
  namespace: payments
automountServiceAccountToken: false
```

Then reference it from the Pod template:

```yaml
spec:
  serviceAccountName: payments-api
  automountServiceAccountToken: false
```

If the service does not call the Kubernetes API, keep automatic mounting disabled and grant no RBAC. The Service Account can still identify the workload to other platform integrations without placing an API token in the container.

If API access is necessary, enable a projected short-lived token for the intended audience and expiration behavior rather than relying on a permanently stored credential. Make the Role smaller than “read everything in the namespace.” Bind only the dedicated account.

Default Service Accounts deserve attention. A Pod that does not name an account normally uses the namespace's `default` Service Account. If teams attach permissions to that shared identity, every unnamed Pod can inherit them. Keep the default account unprivileged and require sensitive workloads to choose explicit identities.

Shared Service Accounts weaken attribution and containment. If five services use the same account, audit logs cannot easily distinguish them by Kubernetes identity, and the broadest combined permission set becomes available to each compromise. One account per workload makes role and rotation decisions more precise.

Verify actual permission with authorization queries. For example:

```bash
kubectl auth can-i get configmaps/payment-settings \
  --as=system:serviceaccount:payments:payments-api \
  --namespace=payments

kubectl auth can-i list secrets \
  --as=system:serviceaccount:payments:payments-api \
  --namespace=payments
```

Expected positive tests prove required behavior. Negative tests prove the boundary. Check that the account cannot list Secrets, create Pods, exec into Pods, change RBAC, read other namespaces, or act on cluster-scoped resources unless the design explicitly requires it.

Effective-access testing matters because permissions are additive and distributed. A chart can create one RoleBinding, a platform installation can create another, and a group binding can add a third. Static inspection of the application's manifest may not reveal the union present in the cluster.

Review token presence from inside the running container. A manifest can say `automountServiceAccountToken: false` at one level while another template or mutating policy changes behavior. Confirm the filesystem does not contain the token when it is unnecessary and that API requests fail without credentials.

Audit logs complete the identity picture. They can record the authenticated user, groups, verb, resource, namespace, object name, source, response, and time. Retain high-value authorization events where the workload cannot erase them. Compare observed API calls with the Role; an allowed verb that is never used may be removable.

Positive authorization tests should be tied to a real behavior. If the service claims it needs `get` on one ConfigMap, exercise the configuration reload path under the Service Account. Then test nearby denials: another ConfigMap name, Secret read, namespace listing, and Pod creation. This proves the rule is both sufficient and bounded.

Run tests for each environment because bindings drift. Development may contain an extra debugging ClusterRoleBinding, while production may use a different namespace or Service Account name. A passing test in one cluster is not evidence for another unless deployment produces and verifies the same authorization graph.

Review token audience. A token intended for the Kubernetes API should not automatically authenticate to an unrelated external service, and an external workload-identity token should name its expected audience. Audience binding prevents one credential captured for one verifier from being replayed somewhere else that trusts the same issuer too broadly.

Token lifetime changes response. Short-lived tokens reduce the time a copied token remains independently useful, but an attacker resident in the Pod can request or read refreshed tokens until the workload is isolated. Incident response must terminate or replace the compromised workload, revoke or change relevant bindings, and inspect API activity rather than waiting only for expiration.

If API access is added later, treat it as a security-relevant feature change. Enable the token intentionally, add the smallest Role and binding, update network policy if needed, add authorization tests and audit expectations, and review the external effects of every granted verb. Do not simply remove `automountServiceAccountToken: false` to make a library work.

Likewise, removing API use should remove token delivery, binding, Role, and network edge. Orphaned Roles may appear harmless, but a later mistaken binding can reactivate them. Keep identity definitions and permissions aligned with actual workload behavior.

## What Does a Kubernetes Secret Protect and What Does It Not?
<!-- section-summary: A Secret separates sensitive values from ordinary configuration and API objects, but base64 is only encoding and protection still depends on API authorization, storage encryption, transport, audit, and runtime access. -->

A Kubernetes Secret is an API object for values that should be handled differently from ordinary workload configuration. It keeps a password or token out of a Deployment manifest and gives the platform a defined delivery mechanism.

That separation is useful, but the object is not automatically confidential in every part of its lifecycle. Values in YAML are commonly base64-encoded:

```yaml
data:
  password: c2VjcmV0
```

Base64 changes representation so binary data can travel through text formats. Anyone who reads it can decode it. It is not encryption.

Secret protection has several stages:

```text
source and authoring
  -> API request in transit
  -> API authorization and admission
  -> storage in etcd and backups
  -> delivery to a node and Pod
  -> use by the application
  -> logs, dumps, and downstream systems
```

Encryption at rest protects Secret values in the storage layer, such as etcd, when configured with an appropriate provider and key lifecycle. It reduces exposure from raw storage or some backup paths. It does not protect against an identity authorized to call `get secrets`, because the API server returns the plaintext value to an authorized client.

Therefore `get secrets` is much more powerful than its verb sounds. A namespace can contain database credentials, signing material, cloud tokens, and service keys. `list` or `watch` can expose many values and future changes. Restrict Secret API reads closely and audit them.

A Pod usually does not need `get secrets` merely because it consumes a Secret. The kubelet can arrange a declared Secret volume or environment projection for the Pod. The application reads the provided value without receiving permission to browse Secret objects through the API.

Storage encryption also needs protected keys, rotation, restore testing, and backup coverage. An unencrypted snapshot can bypass the live etcd control. A key available to every cluster administrator may still be too broad for the threat model. Encrypting storage is one layer, not a replacement for RBAC and runtime containment.

Keep Secret manifests and rendered values out of source control, CI logs, command history, ticket attachments, and container images. Secret scanning belongs early in pull requests and build output, because a value committed to Git or baked into a layer remains exposed even if Kubernetes later stores a clean copy.

Secret creation paths should avoid placing plaintext on command lines that process listings or shell history can retain. CI should pass values through protected inputs and avoid printing rendered manifests. Operators should inspect metadata and access decisions without routinely retrieving values. The goal is to make ordinary administration possible without turning every tool invocation into a disclosure.

RBAC around Secret metadata and content can be difficult because the same API read normally returns the object, including data. A user who only needs to know that a Secret exists may require a separate inventory or controller view rather than broad `get`. Design operational interfaces that do not force every observer to become a secret reader.

Encryption configuration needs verification. Create a controlled value, confirm newly written objects use the intended provider in storage, rotate or rewrite older objects when required, and test restore with access to the necessary keys. A configuration file that names encryption but was not applied to every API server or historical object is incomplete protection.

Key management creates another authority graph. Whoever can retrieve the encryption keys and etcd snapshot may recover Secrets even without live API permission. Separate backup storage, key use, cluster administration, and application deployment roles where the threat model requires it. Audit decrypt operations and protect key deletion because losing keys can also make restoration impossible.

Secret objects can contain certificates, Docker registry credentials, bearer tokens, and arbitrary application values. The type field may help tools interpret the object, but it does not enforce downstream least privilege. Review each value according to the authority it conveys and its rotation lifecycle.

Metadata can be sensitive too. Secret names, labels, namespaces, owners, and update times can reveal service architecture even when data is encrypted. Limit collection access and avoid putting actual secret values or unnecessary confidential context into names or annotations.

## How Should Secret Values Reach a Workload?
<!-- section-summary: Deliver only the exact value a workload needs through a bounded mount or identity, avoid broad environment and API exposure, and use external managers or dynamic credentials for lifecycle problems beyond Kubernetes storage. -->

Kubernetes can expose a Secret as mounted files or environment variables. Both put sensitive data into the process's runtime boundary, but they behave differently.

Mounted Secret files often provide clearer separation. The application can read a specific path, file permissions can be controlled, and the value does not automatically appear in every child process environment. Platform updates can refresh mounted data, although the application must know how and when to reload it.

Environment variables are convenient, but they can spread. Child processes inherit them. Diagnostic output, crash handlers, support bundles, and process inspection may expose them. Many applications also read environment only at startup, so rotation requires a restart.

Mounted files are not magically safe. Any process with access to the mount and file permissions can read the value. A compromised application can normally use every credential it legitimately possesses. A copied file can persist elsewhere. Runtime policy, process isolation, log hygiene, and downstream least privilege remain necessary.

A Secret is an authority bridge. It may grant access to a database, cloud API, payment provider, certificate identity, or another service. Review not only whether the Pod may read the bytes, but what actions those bytes authorize after use.

The least-privilege principle applies inside the secret. A database credential limited to the application's schema and operations is safer than a shared administrator password. A cloud token limited to one queue is safer than an account-wide key. Scope should match workload, environment, and purpose.

Separate production from lower environments. Reusing the same credential across development, staging, and production lets compromise in a weaker environment cross the boundary. Use distinct secret objects, external paths, identities, and encryption contexts.

External secret managers solve a broader lifecycle problem: centralized ownership, versioning, rotation, audit, fine-grained access, and sometimes dynamic credential issuance. Kubernetes can fetch or synchronize values through a controller, CSI integration, or workload identity.

Synchronizing an external value into a Kubernetes Secret does not remove Kubernetes Secret risk. Once copied, it is still present in the Kubernetes API and storage path and can be read by authorized identities. Understand whether the integration materializes a Secret object, mounts directly from the external system, or gives the application an identity to fetch at runtime.

Dynamic credentials reduce standing privilege. Instead of one password valid for months, the workload obtains a short-lived database or cloud credential using its identity. Theft still matters, but the useful window is smaller and rotation is built into normal operation.

Prefer workload identity where the external system supports it. The platform proves which workload is calling and exchanges that identity for narrow short-lived access. This removes a long-lived secret value from the cluster, but trust configuration must tightly bind cluster, namespace, Service Account, audience, and external role.

Rotation must consider both identity and consumers. Replacing a value in the manager is not complete until mounted files refresh, applications reload or restart safely, old sessions expire, and the old credential is revoked. Preserve which workload version used which credential generation during incidents where feasible.

Mount only selected keys when a multi-value Secret exists. A workload needing one client certificate should not automatically receive unrelated credentials stored in the same object. Better still, separate values by owner, consumer, purpose, and rotation schedule so one mount and one compromise do not expose an arbitrary bundle.

File permissions and process identity must align. A Secret volume mounted read-only can still be readable by every process sharing the same UID or group. Sidecars in the same Pod should not receive the mount unless they participate in the trust boundary. Per-container mount definitions make that separation visible.

Environment-variable delivery can be acceptable for a simple application, but the decision should account for debugging and child processes. Avoid commands that print all environment variables. Scrub crash reports and support bundles. Restart reliably when rotated values are read only at process startup. Do not confuse convenience with lower exposure.

External managers separate ownership from deployment. A security or platform team can manage credential lifecycle while an application deployer references a permitted secret path or identity. Protect the mapping: permission to edit the reference should not let the deployer request any arbitrary high-value secret. The integration must authorize both workload identity and requested secret.

Dynamic database credentials illustrate reduced standing privilege. The workload authenticates with its platform identity, receives a role limited to expected operations and a short lease, and renews while healthy. On compromise, responders revoke the lease or identity mapping and replace the Pod. The external manager's audit connects issuance to the Kubernetes identity.

Workload-identity federation also needs claim validation. Bind the external role to the expected cluster issuer, namespace, Service Account, audience, and perhaps deployment context. A rule that trusts every Service Account in a cluster or every cluster using a shared issuer can recreate broad static-key risk in a new form.

Do not use an external manager as a reason to grant the Pod broad Kubernetes Secret access. The two paths are independent. If the application fetches externally, it may need no Kubernetes Secret object and no related RBAC. If a synchronizing controller writes Secrets, give that controller only the destination scopes and keep applications on mount-only consumption.

## How Do RBAC, Secrets, and Other Capabilities Chain Together?
<!-- section-summary: Attackers combine API verbs, Pod creation, Secret reads, runtime credentials, network reachability, and workload privilege, so reviews must trace paths through the whole capability graph. -->

RBAC and Secrets interact directly. A Service Account that can read a Secret obtains the external authority stored inside it. Permission to create a Pod may let an attacker cause that Secret to be mounted even without direct `get` permission. Permission to update a Deployment may let the attacker replace its image or command and inherit the workload's mounted credentials.

Think in capability chains:

```text
compromised Pod
  -> Service Account token
  -> allowed API verb
  -> create or modify workload
  -> select identity or mount Secret
  -> obtain external credential
  -> reach allowed network destination
  -> affect data or another system
```

Review direct and indirect paths. Sensitive verbs include reading Secrets, creating Pods or Jobs, modifying workload controllers, using `pods/exec`, creating service-account tokens, impersonating identities, and changing RBAC. A low-sounding permission can be powerful in combination.

Namespaces constrain many steps but do not automatically block chains. An identity bound across namespaces, a shared Service Account, a cluster-scoped controller, node access, or open network route can cross the boundary. Treat namespace placement as one scope dimension rather than proof of isolation.

Default and shared accounts create ambient paths. A new Pod may inherit the default account. An operator may grant a controller access across every namespace because one feature needs it. A shared deployment role may include Secret reads for all applications. These patterns make future workload additions more powerful without an explicit review.

Audit should focus on dangerous transitions. Watch Secret reads, token creation, Pod and Job creation by non-controller identities, exec sessions, RBAC changes, impersonation, and access-denied bursts. Tie events to workload owner, image digest, deployment revision, and source identity.

Container runtime isolation changes the chain. Non-root, a read-only root, dropped capabilities, seccomp, narrow mounts, and resource limits do not remove an authorized API token, but they reduce other post-compromise options. Network policy can prevent a stolen credential from reaching some destinations. Downstream authorization limits what the credential can do.

Image and registry security also contribute. A digest-pinned signed image with provenance reduces the chance that unauthorized code entered before runtime. It does not justify broad runtime authority. Supply-chain trust and least-privileged execution protect different transitions.

The complete authority chain is:

```text
human or workload identity
  -> Kubernetes RBAC
  -> allowed desired state or read
  -> Pod runtime identity and mounts
  -> Secret or external credential
  -> network-reachable system
  -> downstream authorization
```

The chain is only as narrow as its broadest link. A tiny Kubernetes Role followed by an administrative database password is not end-to-end least privilege. A narrow external credential combined with cluster-admin Service Account permission is also weak.

Consider a weak design. Every Pod in `payments` uses the default Service Account. A ClusterRoleBinding grants it broad read access. Database administrator credentials live in one namespace Secret. The cluster network is open. A compromise in any ordinary service can reuse the token, enumerate Secrets, obtain the database credential, and connect to the database.

Now compare the stronger shape. Each workload has a separate Service Account. Most receive no API token. The one controller needing API access gets named verbs on named resources in one namespace. The payments API receives one database identity through a narrow mount or workload-identity exchange. That identity can perform only application queries. Network policy allows only the database edge. Audit connects Kubernetes and external identity use.

The stronger design does not assume the Pod is safe. It gives compromise fewer steps and creates signals at each attempted boundary. An attacker may control application code yet find no cluster token, no Secret enumeration, no administrative database role, and no route to unrelated services.

Capability chaining should influence remediation priority. A `get pods` permission may seem lower risk in isolation, but if Pod definitions reveal mounted Secret names and another permission creates Jobs, the combined path deserves attention. Review tools that list permissions should supplement, not replace, architectural reasoning about combinations.

Break-glass human access is another chain. An emergency identity might read Secrets or modify RBAC, but it should require strong authentication, accountable approval, short duration, and independent audit. Do not put that authority into the same Service Account used by continuous automation simply because both might need it during an incident.

Rotation after compromise must address every copied capability. Replacing a Pod without revoking its external database credential leaves the attacker with usable material. Rotating the database password without invalidating a stolen Kubernetes token leaves API authority. Trace identity and credential lineage so response can close all affected links.

Audit logs from Kubernetes, the external secret manager, cloud identity system, database, and registry can be correlated through workload, time, and artifact identity. No one log describes the entire chain. A useful incident timeline shows which image ran, which Service Account token it used, which Secret or dynamic credential it obtained, and which downstream action followed.

## What Does a Complete Least-privilege Review Look Like?
<!-- section-summary: Review whether API access is necessary, enumerate effective verbs and bindings, narrow Secret delivery and downstream power, test compromised-Pod outcomes, and automate the controls and audit trail. -->

For a payments API that only handles requests and connects to one database, a strong design can be deliberately boring:

```text
payments-api Pod
  -> dedicated Service Account
  -> no automatic Kubernetes API token
  -> no Kubernetes RBAC grants
  -> database credential mounted as one read-only file
  -> credential limited to required database operations
  -> network egress limited to database and required infrastructure
  -> non-root, read-only runtime with bounded resources
```

If the service must read one named ConfigMap through the API, add only a projected token, one `get` rule for that name, and the required API network path. Confirm it cannot list ConfigMaps or read Secrets.

A Service Account review asks:

1. Does the workload need the Kubernetes API at all?
2. Does it use a dedicated identity instead of `default` or a shared account?
3. Is token mounting disabled when unnecessary?
4. Are tokens short-lived and audience-bound when used?
5. Which Roles and ClusterRoles reach the subject through every binding?
6. Are wildcards, cluster scope, mutation, exec, impersonation, or RBAC changes present?
7. Can the identity create a workload that gains another identity or Secret?
8. Do positive and negative `can-i` tests match the design?
9. Do audit logs show only expected calls?

A Secret review asks:

1. Is the value absent from Git, images, build logs, and ordinary configuration?
2. Is Kubernetes storage encrypted and are backups protected?
3. Which identities can get, list, watch, or indirectly mount it?
4. Does only the intended workload receive it?
5. Is file mounting preferable to broad environment exposure?
6. What external authority does the value grant?
7. Is that authority limited to workload and environment?
8. Can workload identity or dynamic credentials remove standing secret material?
9. How are rotation, reload, revocation, and audit verified?

Apply the compromised-Pod test. Assume code execution inside the service and ask:

- Is a Kubernetes API token present?
- Which API calls succeed?
- Can the attacker read or cause another workload to mount Secrets?
- Can it create or modify Pods, Jobs, Deployments, or RBAC?
- Which external credentials are readable?
- Which networks can those credentials reach?
- What can the downstream identities do?
- Which audit and runtime signals would reveal the attempt?

Automate the answers. Admission policy can reject automatic token mounting for classes that do not need it, broad RBAC, default Service Account use, privileged pods, forbidden secret patterns, and unapproved identity mappings. CI can scan source and manifests for embedded values and test expected authorization. Continuous review can compare effective permissions and audit usage.

The three distinctions worth memorizing are:

```text
identity is not permission
permission definition is not permission attachment
Secret storage protection is not limited Secret authority
```

The deepest rule is to minimize standing authority available after compromise. Static tokens, shared accounts, broad Roles, permanent passwords, and open network paths accumulate power before it is needed. Dedicated identities, no-token defaults, precise verbs, workload identity, dynamic credentials, narrow networks, and short lifetimes make authority explicit and temporary.

The complete model is:

```text
Kubernetes least privilege
  = necessary workload identity
  + explicit minimal RBAC
  + narrow binding scope
  + verified effective access
  + protected Secret lifecycle
  + minimal downstream credential authority
  + runtime and network containment
  + audit and automated prevention
```

For automated review, version the expected permission contract alongside the workload. CI can render the Role and binding, reject wildcards and known dangerous verbs, and compare a server-side authorization test against expected positives and negatives. Deployment can then verify the live subject rather than trusting template output alone.

Monitor permission drift after release. A platform administrator may add a ClusterRoleBinding outside the application's repository, or an installed controller may introduce new resources and permissions. Periodic effective-access snapshots can identify newly reachable verbs, while audit usage distinguishes actively required permissions from old grants.

Secret lifecycle should have comparable evidence: value owner, intended workloads, environment, storage path, external authority, issuance method, rotation period, last rotation, active consumers, and revocation procedure. This record should not contain the value itself. It makes a Secret an owned capability instead of an opaque string.

When an application needs a new integration, review from the destination backward. What exact downstream action is required? Which short-lived identity can perform it? How will the Pod obtain that identity? Which Kubernetes token, Secret mount, network path, and RBAC rule does that require? This sequence prevents choosing broad cluster permissions before defining the business need.

When retiring an integration, remove the path forward: revoke the downstream role or credential, delete the Secret or identity mapping, remove mounts and environment variables, remove RBAC, disable any token, close network policy, and verify audit silence. Partial cleanup leaves standing authority waiting for a future compromise.

Least privilege is not a one-time minimalist YAML exercise. It is a maintained correspondence between declared application behavior and effective capability. Tests, audit, ownership, expiration, and removal keep that correspondence accurate as the service and cluster evolve.

Review that correspondence after every identity, dependency, platform, namespace, or deployment change, and retain the verified result with the release evidence.

## Check Your Answers

:::expand[Why Does Kubernetes Security Begin at the API Server?]{kind="recap"}
Kubernetes turns authenticated API requests into desired state, so human, automation, and Pod identities must pass authorization, admission, storage, and audit boundaries before controllers act.
:::

:::expand[How Does RBAC Describe Allowed API Actions?]{kind="recap"}
RBAC grants allow rules over verbs, resources, scopes, and sometimes names; read, collection, mutation, execution, and wildcard permissions have very different consequences.
:::

:::expand[How Do Roles and Bindings Set Permission Scope?]{kind="recap"}
Roles and ClusterRoles define rules, while RoleBindings and ClusterRoleBindings attach them; the attachment determines whether reusable permission remains namespaced or becomes broad.
:::

:::expand[How Should a Pod Receive and Verify Its API Identity?]{kind="recap"}
Use a dedicated Service Account only when needed, disable automatic credentials otherwise, and test both required and forbidden effective actions from the exact workload identity.
:::

:::expand[What Does a Kubernetes Secret Protect and What Does It Not?]{kind="recap"}
A Secret separates sensitive data from ordinary configuration, but base64 is not encryption and storage encryption does not stop an identity authorized to read through the API.
:::

:::expand[How Should Secret Values Reach a Workload?]{kind="recap"}
Deliver only the needed value through a narrow mount or workload identity, limit its downstream authority, and handle rotation, environment separation, and external-manager semantics explicitly.
:::

:::expand[How Do RBAC, Secrets, and Other Capabilities Chain Together?]{kind="recap"}
Attackers combine API verbs, workload creation, Secret mounts, tokens, networks, and downstream permissions, so effective security depends on the entire capability path.
:::

:::expand[What Does a Complete Least-privilege Review Look Like?]{kind="recap"}
Ask whether API access exists at all, enumerate effective bindings and indirect paths, narrow Secret and external authority, run compromised-Pod tests, and automate prevention and evidence.
:::
