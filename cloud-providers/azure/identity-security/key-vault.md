---
title: "Key Vault"
description: "Store secrets, keys, and certificates in Key Vault, grant narrow access, rotate values, and gather evidence without exposing sensitive data."
overview: "After workloads can identify themselves, the next question is where dangerous values live. This article follows one payment secret through Key Vault, access control, versions, rotation, soft delete, and review evidence."
tags: ["azure", "key-vault", "secrets", "keys", "certificates"]
order: 3
id: article-cloud-providers-azure-identity-security-key-vault-secrets-and-encryption-basics
aliases:
  - key-vault-secrets-and-encryption-basics
  - cloud-providers/azure/identity-security/key-vault-secrets-and-encryption-basics.md
---

## Table of Contents

1. [Sensitive Store Isolation: The Key Vault Blueprint](#sensitive-store-isolation-the-key-vault-blueprint)
2. [Secrets: Volatile Plaintext Strings](#secrets-volatile-plaintext-strings)
3. [Keys: Cryptographic Operation Endpoints](#keys-cryptographic-operation-endpoints)
4. [Certificates: Unified X.509 Lifecycles](#certificates-unified-x.509-lifecycles)
5. [Vault Authorization: Access Policies vs. Azure RBAC](#vault-authorization-access-policies-vs-azure-rbac)
6. [Managed Identity Access integration](#managed-identity-access-integration)
7. [Decoupled Secret Rotation Cycles](#decoupled-secret-rotation-cycles)
8. [Reliability Safeguards: Soft Delete and Purge Protection](#reliability-safeguards-soft-delete-and-purge-protection)
9. [Auditing Evidence without Data Exposure](#auditing-evidence-without-data-exposure)
10. [Sample Vault Inventory and Access Topology](#sample-vault-inventory-and-access-topology)
11. [Putting It All Together](#putting-it-all-together)

## Sensitive Store Isolation: The Key Vault Blueprint

Azure Key Vault is a highly secure, centralized cloud service designed to safeguard sensitive application secrets, cryptographic keys, and TLS/SSL certificates in a single, dedicated storage boundary.

To build a secure cloud system, you must establish a dedicated, hard boundary around your sensitive materials. In local workstation development, engineers are used to writing database passwords and API tokens in local `.env` files or hardcoding them in application settings.

However, in a distributed cloud environment, this ad-hoc storage introduces severe risks. plaintext keys spread across multiple servers, compile into deployment logs, leak into diagnostic crash dumps, and remain visible in Git repository histories.

```mermaid
flowchart TD
    subgraph Azure Key Vault Boundary [kv-payments-prod]
        subgraph ProtectedStore [Protected Key Vault Boundary]
            direction TB
            Secret["Secrets<br/>(Volatile Plaintext Strings)<br/>* Returned to authorized callers"]
            Key["Keys<br/>(Cryptographic Operation Endpoints)<br/>* Software or HSM-protected by tier"]
            Cert["Certificates<br/>(X.509 Lifecycle Objects)<br/>* Lifecycle policy depends on issuer setup"]
        end
    end

    App["Application Code<br/>(Managed Identity)"] --> |1. HTTPS REST Request| Secret
    App --> |2. Cryptographic Operation request| Key
    App --> |3. Ingests Public Cert| Cert
```

Azure Key Vault resolves these vulnerabilities by providing a unified, physical and logical security envelope. Under the hood, Key Vault enforces two isolation layers:

### 1. Protected Storage and Key Boundaries
All Key Vault data is encrypted at rest and protected by Azure's managed security boundary. The exact protection model depends on the object and tier. Standard vaults support software-protected keys. Premium vaults support HSM-protected key types, and Azure Managed HSM is a separate service for single-tenant HSM-backed key management.

This distinction matters because secrets and keys behave differently. A secret is returned to an authorized application as a plaintext value over TLS. A nonexportable key can stay inside the Key Vault or HSM boundary while the service performs supported cryptographic operations. Do not teach Key Vault as if every secret string is stored inside a dedicated physical HSM or as if every tier provides the same key protection model.

### 2. Logical REST Isolation
Key Vault does not run as a local database or filesystem folder inside your compute cluster. It runs as an independent, isolated microservice accessed strictly through a hardened HTTPS REST API.

Every single request to read a secret, decrypt a string, or rotate a certificate must pass through TLS 1.2 or 1.3 encryption, prove identity through Microsoft Entra ID, and satisfy explicit role-based access control (RBAC) boundaries before the vault's storage engine evaluates the request.

## Secrets: Volatile Plaintext Strings

A secret is a sensitive configuration string that an application must read in plaintext format to do its job. Common examples include SQL database connection strings, payment provider API tokens, webhook signing signatures, and third-party credential parameters.

When an application container boots up and needs to access a database, it makes an HTTPS REST call to Key Vault:
```text
GET https://kv-payments-prod.vault.azure.net/secrets/payments-db-password?api-version=7.4
```
Key Vault decrypts the secret value inside its secure boundary and transmits the plaintext string back to the application over the encrypted HTTPS channel. Once received, the application stores the string in its local process memory space, utilizing it to open the database socket connection.

> [!WARNING]
> **The Runtime Memory Hazard**: Because secrets are read by the application in plaintext, they are volatile. Once the raw string value enters your application's RAM, it is vulnerable to local leakage. A careless log statement (`console.log(process.env)` or `logger.info("Connecting to DB: " + dbString)`) can easily print the secret into cleartext application logs.

To protect your systems, always keep secrets short-lived in memory, sanitize logging libraries, and use Key Vault to centralize rotation.

## Keys: Cryptographic Operation Endpoints

A key is a cryptographic object (such as an RSA or Elliptic Curve key pair) used to perform secure operations like encryption, decryption, digital signing, and signature verification.

The fundamental systems engineering difference between a secret and a key is the **operational boundary of the raw material**:

*   **Secret (Read-Extract)**: The application reads and extracts the plaintext string value out of Key Vault, performing the subsequent database login locally inside its own memory space.
*   **Key (Remote-In-Vault)**: The application **never** reads or extracts nonexportable cryptographic key material. The key stays inside the Key Vault protection boundary, and HSM-backed protection depends on using the Premium HSM key types or Managed HSM.

```text
Secret Flow: Key Vault [Secret String] ───────── HTTPS ────────> Application Memory
Key Flow:    Application Data ───────── Remote REST Call ────────> Key Vault Key Operation ──── Result ───> App
```

If your application needs to encrypt a customer's bank account ledger before writing it to a database, it does not download the key. Instead, the application sends the raw ledger bytes over a secure REST call to the Key Vault `/encrypt` endpoint.

Key Vault receives the payload, executes the supported cryptographic operation using the key material inside the service boundary, and returns only the operation result back to the application.

Even if an attacker gains complete root access to your container host and dumps the application's RAM, they can never steal the encryption key, because the key material has never entered the application's memory space.

## Certificates: Unified X.509 Lifecycles

A certificate is an X.509 digital certificate used to establish public identity, configure secure TLS handshakes, and verify domain ownership.

In traditional architectures, certificates are treated as raw files scattered across servers. This makes them highly vulnerable:
*   **Expiry Outages**: Certificates expire silently, causing sudden, catastrophic downtime when browsers block user traffic due to untrusted connections.
*   **Access Leaks**: The private key file (`.key` or `.pfx`) must be copied to the web server, risking exposure in plain directories.

Key Vault resolves some of these lifecycle challenges by managing certificates as a unified object that coordinates certificate metadata, a key, and a secret containing certificate material. It can help with certificate creation, import, renewal policy, and integration with supported certificate authorities.

Do not assume Key Vault automatically handles every public certificate issuer or every DNS challenge workflow. Built-in certificate issuer integration is limited to supported providers and configurations, and many teams still use external automation such as ACME clients or platform-managed certificates for Let's Encrypt-style flows. The safe wording is that Key Vault can centralize certificate storage and lifecycle policy, while issuer automation depends on the provider and setup.

## Vault Authorization: Access Policies vs. Azure RBAC

To manage access to these sensitive objects, Key Vault supports two distinct authorization models: legacy **Vault Access Policies** and modern **Azure RBAC**.

![An infographic showing Key Vault as a boundary around secrets, keys, and certificates with explicit authorization](/content-assets/articles/article-cloud-providers-azure-identity-security-key-vault-secrets-and-encryption-basics/vault-access-boundary.png)

*Key Vault is useful because secret values stay behind a dedicated authorization boundary instead of living inside app configuration files.*

For all new cloud architectures, you must explicitly select the **Azure RBAC** model. Differentiating between these two systems reveals critical security and operational implications:

| Authorization Coordinate | Legacy Vault Access Policies | Modern Azure RBAC Integration |
| :--- | :--- | :--- |
| **Storage Boundary** | Defined on the Key Vault resource itself (JSON properties block). | Defined globally using Microsoft Entra and `Microsoft.Authorization`. |
| **Granular Scope** | Flat, vault-level access. Capped at 1024 access policy rows. | Supports finer scopes, though Microsoft recommends assigning data-plane roles at vault scope in most cases and using object scope only for specific exceptions. |
| **Access Resolution** | Cannot grant permission to read `Secret A` without granting access to read `Secret B`. | Fully supports least privilege. Assign role at `/secrets/payments-db-string`. |
| **Governance Audit** | Audited separately using custom vault metadata scripts. | Audited centrally using standard Azure Active Directory and Activity logs. |

Under the legacy Vault Access Policies model, permissions are flat. If you grant your microservice `Secret Get` permission on the vault, the service obtains the right to read **every** secret inside that vault. If your vault holds ten unrelated database passwords, the microservice has access to all of them.

Modern Azure RBAC resolves this vulnerability by integrating Key Vault data-plane access with standard Azure role assignments. In most production designs, create separate vaults per application and environment, then assign data-plane roles at the vault scope. For exceptional cases, Azure RBAC can be scoped to an individual secret, key, or certificate:

```text
Principal: mi-payments-webhook-prod
Role:      Key Vault Secrets User
Scope:     /subscriptions/.../vaults/kv-payments-prod/secrets/payments-db-password
```

This can ensure that the payment processor can read only its specific database password secret, but object-level role assignments are harder to manage at scale. For most teams, separate vaults per app/environment plus vault-scope data roles are easier to audit.

:::expand[History: Why Vault Access Policies Existed Before Azure RBAC]{kind="history"}
When Azure Key Vault was launched in 2015, the Azure Resource Manager (ARM) lacked a granular data-plane authorization framework. At that time, Azure RBAC could only control management-plane operations (such as creating or deleting a vault resource). To authorize data-plane requests—such as reading a specific secret or signing a payload with a key—the Key Vault engineering team had to build a custom, self-contained authorization engine.

This custom engine was designed around **Vault Access Policies**. Under this legacy model, access rules are stored directly as a metadata list inside the Key Vault resource's own JSON configuration. When a request arrived, Key Vault validated the caller's identity via Microsoft Entra ID, but then checked its own local JSON policy list to authorize the action.

While simple and fast, this local architecture suffered from two major enterprise scaling limitations:
1.  **The 1024 Policy Limit**: Because the policies were stored directly inside the vault's resource properties block, the physical size of the policy document was capped, limiting a single vault to exactly 1,024 access policy rows. In large microservice environments or Kubernetes clusters, this limit was frequently exhausted.
2.  **No Granular Scopes**: The local policy engine could only evaluate permissions at the vault level. There was no mechanism to say "grant this principal access to Secret A but deny Secret B."

This scaling pressure drove Microsoft to integrate Key Vault's data plane with Azure RBAC. By delegating authorization to the central Azure RBAC database, Key Vault completely removed the 1,024 policy cap and unlocked secret-level, key-level, and certificate-level role assignments, providing a robust least-privilege boundary.

The top-down diagram below compares these two authorization models:

```mermaid
flowchart TD
    subgraph LegacyAccess["Legacy Access Policies (Local Evaluation)"]
        RequestA["Data Plane Request"] --> VaultA["Key Vault Resource"]
        VaultA -->|"Checks Local JSON"| PolicyList["Local Policy List (Max 1024 Rows)"]
    end

    subgraph ModernRBAC["Modern Azure RBAC (Delegated Evaluation)"]
        RequestB["Data Plane Request"] --> Entra["Microsoft Entra & ARM Engine"]
        Entra -->|"Checks Central RBAC"| RBACDB["Azure RBAC Store (Unlimited & Granular)"]
        RBACDB -->|"Allows Scope"| VaultB["Key Vault Resource"]
    end
```

**Rule of thumb:** Treat legacy access policies as technical debt. When deploying new key vaults in Bicep or Terraform, always set `enableRbacAuthorization: true` and configure granular Azure RBAC role assignments to prevent flat, vault-wide permission exposure.
:::

## Managed Identity Access Integration

Managed identity is the primary, passwordless mechanism to connect your compute containers to Key Vault. The application utilizes its attached user-assigned or system-assigned workload identity to authenticate, bypassing the need to store static client secrets.

To implement this without hardcoding credentials, you configure your application's environment settings to store only the non-sensitive metadata coordinates:

```text
KEY_VAULT_URL=https://kv-devpolaris-payments-prod.vault.azure.net
PAYMENTS_DB_SECRET_NAME=payments-db-connection-string
AZURE_CLIENT_ID=1d6d5d2d-25d8-4d4a-92a0-d58df00f55e1
```

These parameters contain zero secrets. They are stable, public pointers that tell the Azure SDK where to direct its token requests and which workload identity to use. The secret value remains inside Key Vault until an authorized data-plane request asks for it.

## Decoupled Secret Rotation Cycles

Rotation is the operational process of updating a sensitive value to limit the lifetime of a credential. To prevent downtime during credential updates, you must design a decoupled cutover path:

![An infographic showing a secret rotation lifecycle from new version to app reload and old version retirement](/content-assets/articles/article-cloud-providers-azure-identity-security-key-vault-secrets-and-encryption-basics/secret-rotation-lifecycle.png)

*Secret rotation is safer when apps read a named secret from the vault and the vault manages versions behind that name.*

```text
Key Vault Secret Object [Stable Name: payments-db-password]
  ├── Version A (Active: 2026-04-01) ──> Used by current app tasks
  └── Version B (New:    2026-05-13) ──> Used by newly booted app tasks
```

Key Vault handles this gracefully by supporting **secret versioning**. Every time you update a secret value, Key Vault does not overwrite the old data. Instead, it generates a new version GUID while maintaining the stable, human-friendly secret name (e.g. `payments-db-password`).

When your application boots, it queries the stable name without specifying a version GUID. Key Vault automatically returns the latest active version.

During database credential rotation, your platform team writes the new password to Key Vault (creating Version B). The active database engine is configured to accept both Version A and Version B.

Your application containers are then rolled sequentially during a deployment. As new tasks boot, they automatically read Version B and open connections. Once all old containers using Version A have terminated, you safely revoke the old password at the database engine, ensuring a flawless cutover.

:::expand[Pitfall: Version-Pinned Secret URLs Bypass Rotations]{kind="pitfall"}
A common secret rotation failure occurs when applications are configured with fully qualified, version-pinned secret URLs. An Azure Key Vault secret URL follows a strict hierarchical format: `https://{vault-name}.vault.azure.net/secrets/{secret-name}/{version-guid}`. If an engineer copies this complete URL with the specific version GUID into the application settings, or if a Bicep template queries the current secret version at deploy-time and injects it into the environment variables, the application is permanently locked to that specific snapshot.

When your rotation pipeline runs and updates the secret value in Key Vault, a new version GUID is generated. However, because the application configuration contains the old version-pinned URL, the running container continues to request the old secret version. The rotation appears successful in the vault, but the active application never picks up the updated credential. Once the old credential is disabled or deleted at the target database engine, the application immediately suffers authentication failures and crashes.

This identical pitfall exists in AWS Secrets Manager. If you hardcode a specific `VersionId` GUID inside your application code or CloudFormation templates instead of querying the secret name or ARN without a version, the application will bypass dynamic rotations and continue fetching the pinned historical value, missing the `AWSCURRENT` stage updates.

The top-down diagram below compares version-pinned vs unpinned dynamic secret retrieval:

```mermaid
flowchart TD
    subgraph Pinned["Version-Pinned URL (Bad Practice)"]
        AppA["App config: secrets/db-pass/v1"] -->|"1. Requests v1"| VaultA["Key Vault"]
        VaultA -->|"2. Returns v1"| AppA
        RotateA["Rotation: Creates v2"] -.->|"App remains pinned"| AppA
    end

    subgraph Unpinned["Versionless URL (Dynamic Lookup)"]
        AppB["App config: secrets/db-pass"] -->|"1. Requests latest"| VaultB["Key Vault"]
        VaultB -->|"2. Resolves latest to v2"| AppB
        RotateB["Rotation: Creates v2"] -->|"App dynamically pulls"| AppB
    end
```

**Rule of thumb:** Never pin specific secret version GUIDs in application runtimes. Configure your SDKs, App Service settings, or Container App configurations using versionless secret URLs (e.g., `https://kv-prod.vault.azure.net/secrets/db-pass`) to ensure the application dynamically retrieves the latest active credential on boot.
:::

## Reliability Safeguards: Soft Delete and Purge Protection

Secrets and keys are critical to your application's ability to run and recover. If a database password or data encryption key is deleted by accident, your application will fail instantly. If a key used for customer-managed encryption is permanently deleted, the underlying database files become unrecoverable, resulting in permanent data loss.

To protect against accidental human errors or malicious security compromises, Key Vault enforces two mandatory reliability safeguards:

### 1. Soft Delete
When a vault or an individual secret is deleted, the resource is not instantly wiped from physical disks. Instead, it is moved to a temporary "trash bin" state for a configurable retention window (defaults to 90 days).

During this window, the object cannot be read by applications, but it can be recovered by an identity with the required Key Vault recovery permissions. Management-plane contributor access alone does not automatically grant permission to read or recover data-plane objects when the vault uses Azure RBAC.

### 2. Purge Protection
Purge protection is the ultimate administrative lock. When enabled, it blocks anyone—including subscription owners and global directory administrators—from permanently destroying (purging) a soft-deleted vault or secret until the retention window has fully expired.

This is a critical defense against ransomware attacks. If an attacker gains administrative access and attempts to delete and purge your encryption keys, the ARM engine will block the purge command. The keys remain recoverable in the soft-deleted state, allowing you to restore your systems.

## Auditing Evidence without Data Exposure

A central tenet of security engineering is verifying access controls without exposing the protected data. When conducting an audit or troubleshooting a startup error, support engineers must never print sensitive secrets into tickets or capture decryption passwords in screenshots.

Instead, they rely on public metadata and operational evidence:

```text
Safe Audit Evidence:
  Vault ID: /subscriptions/.../providers/Microsoft.KeyVault/vaults/kv-payments-prod
  Secret Name: payments-db-connection-string
  Current Active Version: 55555555-4444-4444-4444-121212121212
  Assigned Principal: mi-devpolaris-payments-webhook-prod (5f1f64a4-0a2c-4f3c-91f4-3b9e68b9f6d1)
  Role: Key Vault Secrets User
  Scope: /subscriptions/.../vaults/kv-payments-prod/secrets/payments-db-connection-string
```

This audit record contains zero sensitive values. It provides complete evidence that the workload is authenticated, the role assignment is cabled to the correct target secret scope, and the correct version is active—all without exposing a single database socket password.

## Sample Vault Inventory and Access Topology

For a secure commerce microservice, the Key Vault inventory is kept clean and tightly bounded:

```text
kv-devpolaris-payments-prod (Key Vault with RBAC enabled)
├── secrets
│   ├── payments-db-connection-string
│   └── payments-webhook-signing-secret
├── keys
│   └── payments-ledger-key (nonexportable cryptographic key)
└── certificates
    └── payments-webhook-tls (SSL/TLS cert object)
```

The corresponding role assignments are cabled to isolate management plane actions from data plane actions:

| Security Principal | Assigned RBAC Role | Scope Target | Allowed Operations |
| :--- | :--- | :--- | :--- |
| **`mi-payments-webhook-prod`** | `Key Vault Secrets User` | Vault Secret Scope (`/secrets/payments-...`) | Reads plaintext secret values over HTTPS. |
| **`mi-payments-webhook-prod`** | `Key Vault Crypto User` | Specific Key Scope (`/keys/payments-...`) | Sends encryption/decryption payloads to Key Vault key operations. |
| **`grp-platform-security`** | `Key Vault Contributor` | Vault Resource Scope (`kv-payments-prod`) | Manages network firewalls and purge settings (no data access). |

This access topology ensures that the payment workload holds the precise permissions required to encrypt ledgers and read its connection database secret, while remaining completely blocked from altering the vault's infrastructure settings or reading adjacent platform keys.

## Putting It All Together

Operating a secure, compliant cloud architecture requires centralizing all sensitive materials inside the physical and logical boundaries of Key Vault:

*   **Isolate Plaintext Strings**: Store SQL database passwords, API tokens, and connection strings inside AES-256 encrypted secrets, keeping configuration files clean.
*   **Use Nonexportable Keys**: Keep encryption keys inside the Key Vault or Managed HSM boundary, executing cryptographic operations through secure remote APIs.
*   **Enforce Azure RBAC**: Choose the Azure RBAC model over legacy access policies, usually assigning data-plane roles at vault scope and using object-level scopes only for specific exceptions.
*   **Enable Purge Protection**: Lock down production vaults with soft delete and purge protection to shield critical encryption keys from accidental deletions or ransomware.
*   **Design Versioned Rotation**: Structure cutover paths using secret versioning, ensuring that applications consume stable names while underlying passwords change.

![An infographic summarizing Key Vault secrets, keys, certificates, RBAC, rotation, and audit evidence](/content-assets/articles/article-cloud-providers-azure-identity-security-key-vault-secrets-and-encryption-basics/key-vault-safety-map.png)

*Use this as the Key Vault safety map: keep sensitive values outside app code, grant access through identity and RBAC, rotate versions deliberately, and audit access without exposing the secret itself.*


---

**References**

* [Azure Key Vault Overview](https://learn.microsoft.com/en-us/azure/key-vault/general/overview) - Core architecture and physical boundaries of Key Vault.
* [Secure access to a key vault](https://learn.microsoft.com/en-us/azure/key-vault/general/security-features) - Authentication and authorization layers.
* [Azure Key Vault soft-delete overview](https://learn.microsoft.com/en-us/azure/key-vault/general/soft-delete-overview) - Deletion protection and purge controls.
* [RBAC Guide for Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide) - Best practices for secret and key-level role assignments.
