---
title: "Kubernetes RBAC and Secrets"
description: "Configure namespaced API permissions and deliver application database secrets using read-only mounted volumes."
overview: "Kubernetes control plane security depends on granular identity access and secure credential storage. This article explains how to audit dynamic RBAC bindings, avoid cluster-wide exposures, and mount base64 Secrets securely without exposing them in repositories."
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

1. [Control Plane Authentication and Authorization](#control-plane-authentication-and-authorization)
2. [Anatomy of a Cluster-Wide RBAC Compromise](#anatomy-of-a-cluster-wide-rbac-compromise)
3. [The Request Sentence: Subjects, Verbs, and Resources](#the-request-sentence-subjects-verbs-and-resources)
4. [Scoping API Permissions: Roles vs. ClusterRoles](#scoping-api-permissions-roles-vs-clusterroles)
5. [Binding Identities: RoleBindings vs. ClusterRoleBindings](#binding-identities-rolebindings-vs-clusterrolebindings)
6. [Testing effective Permissions with kubectl auth can-i](#testing-effective-permissions-with-kubectl-auth-can-i)
7. [Secrets in Kubernetes: Base64 is Not Encryption](#secrets-in-kubernetes-base64-is-not-encryption)
8. [Delivering Secrets to Pods: Mounted Volumes vs. Environment Variables](#delivering-secrets-to-pods-mounted-volumes-vs-environment-variables)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Control Plane Authentication and Authorization

In a Kubernetes cluster, every internal and external operational request routes through a single centralized gateway: the API Server. A developer executing commands on their laptop, a continuous delivery pipeline deploying a new container version, an internal operator managing cluster state, and a microservice workload running inside a pod all interact with the system by sending HTTP requests to the API Server.

Securing the control plane requires authenticating and authorizing these requests at the cluster boundary. This process occurs in three systematic stages:

First, **Authentication** identifies the caller. Kubernetes authenticates requests using client certificates, external identity providers (via OpenID Connect federations), or short-lived ServiceAccount tokens injected into running containers. This stage verifies *who* is making the request, mapping the connection to a specific username, group, or ServiceAccount principal.

Second, **Authorization** decides whether the authenticated principal has permission to perform the requested operation. Kubernetes uses Role-Based Access Control (RBAC) to evaluate this step. The authorization engine inspects the request details to verify if the principal is permitted to execute the target action on the specific resource within the requested scope.

Third, **Admission Control** reviews the structure of the submitted object itself, validating or mutating the configuration before it is written to the persistent etcd storage database.

By decoupling identity authentication from permission authorization, Kubernetes provides a highly granular access control framework. However, because the API Server represents the ultimate control point, a single over-privileged access policy or exposed token can grant an attacker unrestricted control over the entire cluster fabric.

## Anatomy of a Cluster-Wide RBAC Compromise

To understand why granular control plane security is critical, we must trace how an attacker exploits broad RBAC policies to compromise a live production cluster. Consider a common automated workflow designed with convenience in mind.

A platform engineering team configures an automated deployment runner tasked with rolling out microservice updates. To make configuration straightforward, the engineer binds the runner's ServiceAccount to a cluster-wide administrative role. This binding permits the runner to modify any resource in any namespace across the cluster.

During a routine application release, the team includes a debugging library inside a public-facing developer tool container. An attacker discovers a remote code execution vulnerability in this tool, executes an exploit payload, and acquires a shell session inside the container. 

The attacker navigates to the container's default token path under the local runtime directory. Because the pod was deployed without restricting ServiceAccount token projection, the attacker extracts the runner's ServiceAccount token from the mounted filesystem.

Because the ServiceAccount was granted cluster-wide administrative permissions, the attacker uses the stolen token to log into the cluster API Server from their command line. Bypassing all namespace isolation boundaries, they immediately download every database credential Secret, delete running production workloads, provision privileged daemon sets to hijack the cluster's physical host nodes, and deploy persistent cryptocurrency miners across the entire infrastructure.

This security compromise demonstrates that the primary architectural failure was not the software vulnerability in the developer tool, but the over-privileged cluster-wide RBAC role binding. Had the runner's ServiceAccount been strictly scoped using a namespaced Role bound exclusively to its target application namespace, the stolen token would have granted the attacker no path to reach other namespaces, inspect database secrets, or deploy cluster-wide daemons, halting the exploit at the namespace boundary.

## The Request Sentence: Subjects, Verbs, and Resources

Every authorization check inside Kubernetes RBAC can be expressed as a simple grammatical sentence. The RBAC engine parses each API request to answer a single question: can a specific Subject perform a specific Verb on a specific Resource inside a specific Scope?

To write least-privilege security policies, we must understand the three distinct components that construct this request sentence:

* **Subjects**: The identity performing the action. Kubernetes supports three kinds of subjects: Users, Groups, and ServiceAccounts. Users represent real human operators authenticated by external identity systems. Groups represent collections of users mapped from corporate registries. ServiceAccounts are namespaced identities designed specifically for applications and automated workloads running inside the cluster.
* **Verbs**: The specific action being executed. Standard API verbs include read-only operations (`get`, `list`, `watch`) and modifying operations (`create`, `update`, `patch`, `delete`). The difference between these verbs is highly significant. For example, an identity with `get` access can read a single resource, while `list` access permits reading an entire collection of resources, and `patch` access permits modifying properties of a running configuration.
* **Resources**: The Kubernetes API objects being targeted. Resources include core cluster components (such as `pods`, `services`, and `secrets`) and API group objects (such as `deployments.apps` or `ingresses.networking.k8s.io`). Many resources also support specialized subresources, such as `pods/log` for reading container logs, or `pods/exec` for launching interactive shells.

By structuring rules around these precise terms, security reviewers can translate abstract business requirements into explicit, granular configurations. For example, a developer's feature request to "view application logs in staging" translates to allowing their User identity to execute the `get` verb on the `pods/log` subresource exclusively inside the staging namespace.

## Scoping API Permissions: Roles vs. ClusterRoles

To define permissions inside a cluster, we utilize two distinct policy objects: Roles and ClusterRoles. Understanding the structural boundaries between these two resources is critical to preventing accidental privilege escalation.

A **Role** is a namespaced policy object. It defines a list of permitted API operations that apply exclusively within a single namespace boundary. Consider a namespaced Role designed to permit an automated deployer to manage deployments inside a production orders namespace:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: orders-deployer
  namespace: orders-prod
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "patch", "update"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

This Role is securely isolated. The `metadata.namespace` field guarantees that the permissions declared inside the `rules` block—allowing the identity to patch Deployments and read Pod logs—only apply within the `orders-prod` namespace. The deployer has no authority to read or modify resources in any other namespace.

A **ClusterRole** is a non-namespaced policy object. It is designed to define permissions that apply cluster-wide. ClusterRoles are required for cluster-scoped resources (such as `nodes`, `namespaces`, or `persistentvolumes`) and are commonly used by shared system controllers. However, because ClusterRoles are not bound to a namespace, assigning them to human operators or application workloads represents a significant security risk.

When auditing your cluster, always prefer namespaced Roles for application workloads. A namespaced Role ensures that even if an application's ServiceAccount is compromised, the blast radius remains strictly confined to the host namespace boundary.

## Binding Identities: RoleBindings vs. ClusterRoleBindings

Permissions defined inside a Role or ClusterRole have no effect until they are attached to a subject using a Binding. Kubernetes supports two types of binding objects: RoleBindings and ClusterRoleBindings.

A **RoleBinding** grants the permissions defined in a Role to a subject within a specific namespace. RoleBindings can also bind a ClusterRole to a subject, but the resulting permissions are strictly limited to the namespace of the RoleBinding. Consider a manifest that defines a ServiceAccount and binds our deployer Role to it:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-deployer-sa
  namespace: orders-prod
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: orders-deployer-binding
  namespace: orders-prod
subjects:
  - kind: ServiceAccount
    name: orders-deployer-sa
    namespace: orders-prod
roleRef:
  kind: Role
  name: orders-deployer
  apiGroup: rbac.authorization.k8s.io
```

This configuration securely couples the `orders-deployer-sa` ServiceAccount to the namespaced `orders-deployer` Role. The binding occurs exclusively inside `orders-prod`.

A **ClusterRoleBinding** grants permissions cluster-wide, across every namespace in the cluster. If a ClusterRole containing permission to read Secrets is attached to a subject via a ClusterRoleBinding, that subject can read every Secret in the entire cluster, including administrative credentials and system database keys.

When reviewing bindings, apply three strict audit controls:

First, never use ClusterRoleBindings for application-level service accounts. Limit their use exclusively to cluster-wide system operators (such as CNI network controllers or cluster monitoring agents).

Second, audit the subjects of every RoleBinding. Ensure that broad groups (like `system:authenticated` or `system:unauthenticated`) are never bound to modifying roles, as this grants anonymous connections immediate permission to alter cluster state.

Third, ensure that no ServiceAccount is granted the permission to modify `roles` or `rolebindings` in its own namespace unless it is a dedicated security administrator, as this permission allows the workload to escalate its own privileges at will.

## Testing effective Permissions with kubectl auth can-i

To verify that our RBAC policies are enforced correctly and that no unintended permissions exist, we must test the effective permission state of our subjects. Rather than manually parsing nested YAML files, we use the built-in `kubectl auth can-i` utility.

This command asks the API Server to evaluate our request sentences dynamically, returning a simple `yes` or `no` response based on the active authorization state.

We can run validation checks from the perspective of our deployer ServiceAccount:

```bash
$ kubectl auth can-i patch deployments.apps \
  --as=system:serviceaccount:orders-prod:orders-deployer-sa \
  -n orders-prod
yes

$ kubectl auth can-i get pods/log \
  --as=system:serviceaccount:orders-prod:orders-deployer-sa \
  -n orders-prod
yes

$ kubectl auth can-i get secrets \
  --as=system:serviceaccount:orders-prod:orders-deployer-sa \
  -n orders-prod
no

$ kubectl auth can-i update roles.rbac.authorization.k8s.io \
  --as=system:serviceaccount:orders-prod:orders-deployer-sa \
  -n orders-prod
no
```

These checks confirm that our deployer ServiceAccount possesses the correct, scoped-down permissions. It can patch Deployments and read logs, but is securely blocked from reading Secrets or modifying access controls.

We can also test cluster-wide boundaries to ensure our namespace isolation holds:

```bash
$ kubectl auth can-i get pods \
  --as=system:serviceaccount:orders-prod:orders-deployer-sa \
  -n kube-system
no
```

This negative test proves that the namespaced binding is operating correctly, preventing the ServiceAccount from inspecting resources in administrative namespaces. Incorporate these commands into your deployment verification scripts to guarantee your security boundaries remain active after cluster upgrades.

## Secrets in Kubernetes: Base64 is Not Encryption

Once we have secured our API control plane using RBAC, we must address how the cluster stores and manages sensitive configuration parameters, such as database credentials, API tokens, and cryptographic keys. In Kubernetes, these parameters are represented as Secret objects.

A common and highly dangerous beginner mistake is to treat Kubernetes Secrets as inherently encrypted storage. Consider a standard Secret manifest designed to store a database URL:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orders-db-secret
  namespace: orders-prod
type: Opaque
data:
  database-url: cG9zdGdyZXM6Ly9vcmRlcnNfYXBpOmV4YW1wbGUtcGFzc3dvcmRAZGIub3JkZXJzLnN2Yy5jbHVzdGVyLmxvY2FsOjU0MzIvb3JkZXJz
```

The `database-url` value appears as an alphanumeric string. However, this value is not encrypted. It is merely **Base64 encoded**—a reversible formatting mechanism designed to transport binary data safely over JSON and YAML text streams.

Anyone who has access to the manifest file, or who possesses RBAC permission to get the Secret from the API Server, can decode the value instantly using standard shell commands:

```bash
$ echo 'cG9zdGdyZXM6Ly9vcmRlcnNfYXBpOmV4YW1wbGUtcGFzc3dvcmRAZGIub3JkZXJzLnN2Yy5jbHVzdGVyLmxvY2FsOjU0MzIvb3JkZXJz' | base64 --decode
postgres://orders_api:example-password@db.orders.svc.cluster.local:5432/orders
```

Because Base64 is completely reversible, we must establish three strict architectural controls to secure our Secret storage:

First, never commit Secret manifest files containing raw Base64 data to your version control repositories. If an attacker gains access to your repository history, they compromise all historical secrets. Instead, use external Secrets operators (such as HashiCorp Vault or AWS Secrets Manager) to dynamically inject secret values into the cluster at runtime.

Second, encrypt your secrets at rest in etcd. By default, etcd stores cluster data in plaintext. Configure the API Server's **EncryptionConfiguration** resources to encrypt Secret data using a cryptographic Key Management Service (KMS) provider before it is written to the physical database disk.

Third, restrict API access to Secrets strictly. Treat `get secrets` and `list secrets` as highly privileged permissions, limiting them exclusively to the workloads that require the specific credential at runtime.

## Delivering Secrets to Pods: Mounted Volumes vs. Environment Variables

Once a Secret is stored securely in the cluster control plane, it must be delivered to the running application container. Kubernetes supports two primary delivery mechanisms: injecting secrets as environment variables, or mounting secrets as files inside a virtual volume.

The first mechanism is **Environment Variable Injection**. The Secret key is mapped directly to an environment variable in the container specification. While this model is simple for application code to read, it introduces significant security and operational tradeoffs. 

Environment variables are easily exposed in diagnostic logs, process dumps, or debugging interfaces (such as running `env` inside the container). Furthermore, environment variables are static. If the Secret value is rotated in the control plane, the running process continues to hold the old value indefinitely until the container is manually restarted.

The second, highly secure mechanism is **Mounted Volume Delivery**. The Secret is projected as a read-only file system volume, mapping each key to a virtual file under a secure directory path. Consider a Deployment template configured to mount our database secret:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api-deployment
  namespace: orders-prod
spec:
  replicas: 2
  selector:
    matchLabels:
      app: orders-api
  template:
    metadata:
      labels:
        app: orders-api
    spec:
      containers:
        - name: orders-api-container
          image: ghcr.io/devpolaris/orders-api:v1.2.0
          volumeMounts:
            - name: db-secret-vol
              mountPath: /var/run/secrets/devpolaris-orders-api
              readOnly: true
      volumes:
        - name: db-secret-vol
          secret:
            secretName: orders-db-secret
            items:
              - key: database-url
                path: database-url
```

This configuration securely projects the database credential as a file located at `/var/run/secrets/devpolaris-orders-api/database-url`. The `readOnly: true` setting ensures the application container cannot modify the file.

Mounted volume delivery provides three critical security advantages:

First, it eliminates log exposure. Because the secret lives inside a file, it does not appear in process environment listings or standard shell dumps.

Second, it supports automatic, dynamic updates. When a Secret value is rotated in the control plane, the kubelet agent on the node automatically updates the mounted virtual file within minutes.

Third, it simplifies rotation verification. The application can be designed to monitor the file for changes, dynamically closing old connections and establishing new database channels without requiring a complete container restart, minimizing release friction during credential rotation cycles.

## Putting It All Together

Securing the control plane and data configuration layers represents the primary security boundary in a Kubernetes cluster. By restricting API access usingnamespaced RBAC, eliminating permanent static secrets from Git repositories, encrypting data at rest in etcd, and delivering credentials using read-only mounted volumes, we protect our orchestrator from administrative compromises.

When configuring and auditing your cluster's access and secret controls, ensure you enforce these five core practices:

First, restrict application permissions to namespaced Roles. Completely avoid ClusterRoles and ClusterRoleBindings for ordinary workloads, ensuring that a compromised container cannot escalate access beyond its namespace boundary.

Second, test your active RBAC policies regularly using `kubectl auth can-i`. Run programmatic verification checks from the perspective of your ServiceAccounts to prove that unauthorized access is successfully blocked.

Third, treat Base64 as transport formatting, never as encryption. Implement KMS-backed etcd encryption at rest to protect physical cluster storage disks from credential extraction.

Fourth, project secrets to containers exclusively as read-only volumes. Avoid environment variable injection to prevent secret leaks in diagnostic logs and process dumps.

Fifth, design your applications to support dynamic credential rotation. Monitor mounted secret files for modifications, allowing workloads to dynamically update connection strings without incurring container restart downtime.

## What's Next

Securing API Server access and secret configurations establishes a secure control plane baseline. However, once an authorized pod is scheduled, we must still isolate the process execution on the physical nodes and prevent host-level breakouts. In the next chapter, **Pod Security and Runtime Hardening**, we will cover configuring pod securityContexts, dropping Linux capabilities, running shell-less containers, and auditing active containers using runtime syscall sensors.

---

**References**

- [Kubernetes RBAC Authorization Guide](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) - Official documentation on configuring Roles, RoleBindings, and cluster access controls.
- [Kubernetes Secrets Concept Overview](https://kubernetes.io/docs/concepts/configuration/secret/) - Comprehensive guide on managing, mounting, and rotating Secret objects.
- [Kubernetes Etcd Encryption at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) - Best practices for securing sensitive database storage using KMS providers.
- [OWASP Kubernetes Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Kubernetes_Security_Cheat_Sheet.html) - OWASP recommendations on least-privilege service accounts and secret delivery mechanisms.
- [NIST SP 800-190 Application Container Security Guide](https://csrc.nist.gov/pubs/sp/800/190/final) - NIST guidelines on cluster access policies, secrets isolation, and orchestrator boundaries.
