---
title: "Managed Identities"
description: "Use managed identities so Azure workloads can call Azure services without storing passwords, client secrets, or access keys."
overview: "After RBAC explains who can do what at which scope, managed identities answer the runtime question: how does app code become the caller without carrying a secret?"
tags: ["azure", "managed-identities", "workload-access", "rbac"]
order: 2
id: article-cloud-providers-azure-identity-security-managed-identities-and-workload-access
aliases:
  - managed-identities-and-workload-access
  - cloud-providers/azure/identity-security/managed-identities-and-workload-access.md
---

## Table of Contents

1. [Workload Access: The Passwordless Principle](#workload-access-the-passwordless-principle)
2. [Workload Identity vs. User Identity](#workload-identity-vs-user-identity)
3. [Managed Identities: Centralized Credentials](#managed-identities-centralized-credentials)
4. [System-Assigned: Resource Bound Lifecycle](#system-assigned-resource-bound-lifecycle)
5. [User-Assigned: Standalone Architecture](#user-assigned-standalone-architecture)
6. [The IMDS Cryptographic Handshake](#the-imds-cryptographic-handshake)
7. [RBAC Authorization: The Active Binding](#rbac-authorization-the-active-binding)
8. [Operational Isolation: Runtime vs. Pipeline](#operational-isolation-runtime-vs-pipeline)
9. [Diagnosing Workload Identity Outages](#diagnosing-workload-identity-outages)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Workload Access: The Passwordless Principle

A managed identity is an automatically managed workload identity in Microsoft Entra ID that allows an Azure-hosted service to authenticate to other Azure resources without storing passwords, client secrets, or long-lived access keys in code or configuration.

To understand why this is a fundamental architectural requirement, you must confront **"the first secret problem"** (also known as the bootstrap credentials paradox). 

Suppose you decide to secure your production database password by storing it inside a highly protected central vault (such as Azure Key Vault). Your application code no longer contains the raw database password. However, when your application container boots up and needs to connect to the database, it must first call the Key Vault API to retrieve the password.

To call Key Vault, your application must prove its own identity. If you use traditional password-based authentication, you must provide your application with a Client Secret or an API key. 

This leads to the paradox: **Where do you store that first client secret?**

If you write it into your application configuration files, your Git repository now holds a plaintext credential. If you pass it in as an environment variable during deployment, your CI/CD pipeline logs and host hypervisor environment registers now contain a secret key. If the client secret is ever compromised, an attacker can use it from any computer in the world to sign in to your Key Vault and download every production credential you own.

Managed identities solve the bootstrap credentials paradox by eliminating the stored secret entirely. Instead of storing a long-lived credential inside the application, the Azure-hosted compute layer (such as an App Service, Container App, or Virtual Machine) is cabled directly to an Entra service principal ID using host hypervisor metadata access. 

The application code never handles a password, client secret, or private certificate key. Instead, the runtime SDK requests short-lived authentication tokens locally, and the Azure platform handles all credential material, cryptographic signatures, and token rotation loops under the hood.

## Workload Identity vs. User Identity

A workload identity is an identity designed specifically for software (such as an active microservice, a scheduled background worker, or a CI/CD pipeline runner) rather than a physical human being.

In local development, engineers are used to running applications using their own personal developer identities (using permissions cached by running `az login`). However, running a production workload under a human user account, or sharing a broad administrative deployment credential, introduces severe security risks:

*   **Principal Creep**: If a microservice shares a developer's identity, the microservice automatically inherits the developer's broad permissions, violating the principle of least privilege.
*   **Audit Ambiguity**: If an incident occurs and a database table is wiped, the audit logs will record the action under the developer's name, making it impossible to distinguish between a manual human error and a runtime application bug.
*   **Rotation Pain**: If the developer leaves the company or changes their password, the production microservice will immediately suffer authentication failures and crash.

A secure cloud architecture treats the running application as an independent principal with its own dedicated workload identity cabled strictly to its runtime job:

| Workload Identity | Specific Runtime Job | Target Scope & Permission |
| :--- | :--- | :--- |
| **`mi-orders-api-prod`** | Read order database passwords and write transaction logs. | `Key Vault Secrets User` on `kv-orders-prod` (Resource Scope). |
| **`mi-payment-processor`** | Process incoming payment cards and write audit ledgers. | `Storage Blob Data Contributor` on payment export storage container. |
| **`mi-log-exporter`** | Export regional telemetry traces to security audit workspaces. | `Monitoring Metrics Publisher` on Log Analytics scope. |

By separating these identities, you enforce granular operational isolation. If the payment processor is compromised, the attacker cannot read secrets from the orders vault, because the payment processor's security token is completely blind to the orders envelope.

## Managed Identities: Centralized Credentials

A managed identity is a specialized Microsoft Entra service principal cabled directly to the lifecycle of an Azure resource. The core value of this design is that the credential material is managed entirely by Azure. 

When you enable a managed identity on a compute resource, Azure creates a service principal row in your Microsoft Entra directory. However, unlike a standard service principal, Entra ID does not generate a client secret string or certificate file for you to copy. Instead, Entra ID manages the private key material internally, using HSM-backed directory engines to rotate the credentials automatically at set intervals without any manual configuration or app downtime.

From the application's perspective, the token flow is completely hands-off. The application code utilizes standard Azure SDK libraries (such as `DefaultAzureCredential` in Node.js, Python, or Go). 

At runtime, the SDK automatically detects the Azure hosting environment, contacts the local metadata endpoint, and retrieves a short-lived JSON Web Token (JWT). The SDK handles token caching and proactively refreshes the token before it expires, keeping application code clean and free of credential-handling logic.

## System-Assigned: Resource Bound Lifecycle

A system-assigned managed identity belongs to exactly one Azure resource instance and is cabled directly to its lifecycle.

```text
Compute Resource (app-orders-prod) <─── Tied 1:1 ───> System Identity (mi-app-orders-prod)
  * Created when enabled on resource.
  * Deleted automatically when resource is deleted.
```

### The Lifecycle Mechanism
When you enable a system-assigned identity on an App Service (e.g. `app-orders-prod`), the ARM engine contacts Microsoft Entra ID and provisions a service principal cabled to the App Service's specific Resource ID. 

If you delete the App Service, ARM triggers an asynchronous cleanup webhook that automatically deletes the service principal row from your Entra directory. Any role assignments that pointed to that principal ID are marked retired and cleared automatically, ensuring zero identity residue.

### Architectural Tradeoffs
*   **Pros**: Tidy and automated. There are no standalone identity resources to manage, clean up, or track. It is a perfect fit for singleton workloads where the resource lifecycle and identity lifecycle are identical.
*   **Cons**: Rebuild volatility. If you delete and recreate your App Service (a common occurrence during controlled platform migrations or stack updates), Entra ID generates a brand-new Object ID for the new system-assigned identity. Even though the App Service name remains unchanged, the old principal ID is gone. You must recreate every role assignment for the new Object ID, which can cause startup failures if your deployment pipeline does not automate this step.

## User-Assigned: Standalone Architecture

A user-assigned managed identity is a standalone Azure resource (`Microsoft.ManagedIdentity/userAssignedIdentities`) created and managed independently of the compute resources that use it.

```text
Standalone Identity Resource (mi-orders-api-prod) 
  ├── Attached to compute: app-orders-prod-slot-a
  ├── Attached to compute: app-orders-prod-slot-b
  └── Persistent lifecycle independent of compute resources
```

### The Lifecycle Mechanism
Because the user-assigned identity exists as its own resource, its lifecycle is decoupled from the compute resources. You create the identity once, assign the required RBAC roles to its Object ID, and then attach it to one or more supported compute hosts (such as App Services or Container Apps). 

If the compute host is deleted, rebuilt, or migrated across slots, the user-assigned identity remains untouched in the directory. The newly provisioned compute host simply binds to the existing identity, inheriting the cabled role assignments instantly without any principal ID shifts.

### Architectural Tradeoffs
*   **Pros**: Stable, reusable, and predictable. Ideal for multi-node deployments, blue-green deployment slots, and GitOps pipelines where permissions must remain active across rolling compute swaps.
*   **Cons**: Administrative cleanup overhead. Because user-assigned identities are independent resources, deleting a compute host does not delete the identity. If your platform team does not actively audit Entra service principals, retired user-assigned identities can linger in the directory, retaining access indefinitely. You must tag these resources and clean them up when their workloads are retired.

## The IMDS Cryptographic Handshake

To understand how a passwordless workload obtains a secure token, you must open the hood and inspect the physical **Instance Metadata Service (IMDS) cryptographic handshake**.

When your application code uses `DefaultAzureCredential` to make an API call, the Azure SDK does not transmit a secret over the internet. Instead, it executes a highly secure, local exchange:

```mermaid
sequenceDiagram
    participant App as Application Code (SDK)
    participant Hypervisor as Host Hypervisor (IMDS Bridge)
    participant Entra as Microsoft Entra ID
    participant Vault as Azure Key Vault

    App->>Hypervisor: HTTP GET http://169.254.169.254/metadata/identity/oauth2/token
    Note over Hypervisor: Hypervisor intercepts request,<br/>validates source VM socket<br/>& cabled virtual switch
    Hypervisor->>Entra: Authenticate VM & Request JWT token
    Entra-->>Hypervisor: Short-lived access token (JWT)
    Hypervisor-->>App: Return token (Bearer JWT)
    App->>Vault: REST Call with Bearer Token
    Note over Vault: Key Vault decrypts JWT,<br/>checks scope & role assignments
    Vault-->>App: Decrypted Database Secret
```

### 1. The Local Request
The application code sends an HTTP GET request to a private, non-routable link-local IP address:
```text
GET http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://vault.azure.net
Headers: Metadata: true
```
This link-local IP address (`169.254.169.254`) is statistically guaranteed to be reachable only within the physical hypervisor hosting the virtual machine or container. The `Metadata: true` header is mandatory; it prevents SSRF (Server-Side Request Forgery) attacks because proxy servers and browsers reject this header by default.

### 2. Hypervisor Interception
The physical hypervisor hosting your container intercepts the TCP packet at the virtual switch level. It does not route the packet to the internet. Instead, the hypervisor's local security controller parses the source socket of the virtual network interface. 

Because the virtual network interface is cabled directly to your specific container, the hypervisor physically proves which Azure resource made the request, resolving the identity without requiring any password.

### 3. Directory Authentication
The hypervisor acts as the security proxy. It contacts Microsoft Entra ID, authenticates the verified hardware identity, and requests an access token for the target resource scope (e.g. `https://vault.azure.net`).

### 4. Ephemeral Token Generation
Microsoft Entra ID issues a short-lived JSON Web Token (JWT) cryptographically signed by Azure's master key, typically valid for 24 hours. Entra ID returns this token to the hypervisor, which passes it back to the application over the local loopback bridge.

### 5. Secure REST Execution
The Azure SDK extracts this JWT and places it in the authorization header of the REST query:
```text
GET https://kv-orders-prod.vault.azure.net/secrets/orders-db-password?api-version=7.4
Headers: Authorization: Bearer eyJ...
```
Key Vault decrypts the token, validates the signature against Entra ID's public keys, reads the caller's Object ID, and evaluates its own RBAC assignments. If allowed, it decrypts the secret value and returns it over TLS.

## RBAC Authorization: The Active Binding

Managed identity answers the authentication question (who the app is). Azure RBAC answers the authorization question (what the app is allowed to do).

> [!IMPORTANT]
> Enabling a managed identity does **not** grant the workload any permissions by default. A freshly created managed identity holds zero access. If your application attempts to read a key vault or write a blob immediately after enabling the identity, ARM will reject the request with a `403 Forbidden` error. You must explicitly create a role assignment that binds the identity's Object ID to a specific role definition at the target scope.

For our transactional orders microservice, the production permissions are strictly bounded:

| Workload Object ID | Assigned Role Definition | Scope URI Target |
| :--- | :--- | :--- |
| `5f1f64a4-0a2c-4f3c-91f4-3b9e68b9f6d1` | `Key Vault Secrets User` | `/subscriptions/.../resourceGroups/rg-orders-prod/providers/Microsoft.KeyVault/vaults/kv-orders-prod` |
| `5f1f64a4-0a2c-4f3c-91f4-3b9e68b9f6d1` | `Storage Blob Data Contributor` | `/subscriptions/.../resourceGroups/rg-orders-prod/providers/Microsoft.Storage/storageAccounts/stordersprod/blobServices/default/containers/exports` |

This explicit binding guarantees that even if an attacker compromises the container app's code, they are locked within these exact data-plane limits. They cannot delete the vault, scale the database, or list files in other storage accounts, keeping the blast radius completely isolated.

## Operational Isolation: Runtime vs. Pipeline

A critical security practice is the strict separation of **Runtime Identities** from **Pipeline Deployment Identities**.

In immature cloud architectures, deployment pipelines (like GitHub Actions or GitLab runners) often deploy applications using the same identity that runs the code. Alternatively, developers are tempted to grant their runtime managed identity administrative roles (like `Contributor` or `Owner`) to make deployment headaches disappear.

This violates operational isolation:

```text
Deploy Pipeline Identity (sp-orders-deploy) -> Management Plane (Bicep templates, scaling, networking)
Runtime Workload Identity (mi-orders-api-prod) -> Data Plane (Read database secret, write blob transactions)
```

By separating these roles, you ensure that the running application can never modify the infrastructure it resides in. The managed identity has zero management plane permissions: it cannot change firewalls, delete subnets, or provision new virtual machines. 

Conversely, the deployment pipeline has control-plane access but lacks data-plane access: it can provision the Key Vault but cannot read the sensitive database passwords stored inside it. This division protects your business from internal configuration drift and external software supply chain attacks.

## Diagnosing Workload Identity Outages

When a managed identity workload fails to access a resource, you can isolate the outage coordinate by running through four clinical diagnostic steps:

### 1. Verify Identity Attachment
Verify that the managed identity is physically enabled and attached to the compute host. If using a user-assigned identity, confirm that the client ID inside the application configuration matches the actual resource ID.
```bash
az containerapp show --name "app-orders-prod" --resource-group "rg-orders-prod-uksouth" --query "identity"
```

### 2. Confirm Token Acquisition
Check application logs to confirm the SDK can contact the local IMDS endpoint. If the log shows `CredentialUnavailableException`, the SDK is failing to reach `169.254.169.254`, meaning the managed identity binding has not settled or is blocked by local container firewall rules.

### 3. Verify Object ID in Role Assignments
Do not check the friendly application name; query the actual Object ID of the service principal and verify it is listed in the target resource's role assignments.
```bash
az role assignment list --assignee "5f1f64a4-0a2c-4f3c-91f4-3b9e68b9f6d1" --scope "/subscriptions/..."
```

### 4. Check Scope Boundaries
Confirm that the role assignment's scope covers the target resource. If the assignment is cabled to `vaults/kv-orders-dev`, the app will be denied when requesting secrets from `vaults/kv-orders-prod`.

## Putting It All Together

Operating a secure, passwordless workload requires transitioning from static credentials to dynamic token-based metadata flows:

*   **Solve the Bootstrap Paradox**: Leverage managed identities to eliminate long-lived passwords and client secrets from code, configurations, and logs.
*   **Decouple Lifecycles with User-Assigned**: Prefer user-assigned managed identities for production to guarantee stable Object IDs across slots and platform migrations.
*   **Audit the IMDS Exchange**: Recognize that the local hypervisor intercepts the link-local IP `169.254.169.254` to issue secure, hardware-verified tokens.
*   **Enforce Strict Least Privilege**: Enabling an identity grants zero access; always cable explicit, resource-scoped role assignments to the principal's Object ID.
*   **Isolate Runtime from Deployment**: Keep management-plane deployment pipelines completely separate from data-plane application runtimes.

## What's Next

We have established how our application securely proves its identity at runtime without passwords. Now we are ready to examine the secure boundary where our sensitive passwords, cryptographic keys, and certificates reside. In the next article, we will go deep into Azure Key Vault. We will contrast secrets, keys, and certificates, evaluate access control architectures, and examine soft-delete and purge protection mechanisms.

---

**References**

* [Managed Identities for Azure Resources](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview) - Core architecture of managed workload credentials.
* [Instance Metadata Service (IMDS) reference](https://learn.microsoft.com/en-us/azure/virtual-machines/instance-metadata-service) - Technical documentation for the 169.254.169.254 endpoint.
* [App Service Managed Identity Guide](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity) - Best practices for managed identities on hosting tiers.
* [Azure SDK Authentication with DefaultAzureCredential](https://learn.microsoft.com/en-us/dotnet/api/azure.identity.defaultazurecredential) - How SDKs resolve identities at runtime.
