---
title: "Least Privilege and Secrets"
description: "Limit permissions to what workloads actually need and secure the credentials they use."
overview: "Safe software operation depends on limiting access. This article explains the principle of least privilege and guides you through storing, delivering, and rotating application secrets securely."
tags: ["iam", "permissions", "least-privilege", "secrets", "rotation"]
order: 2
id: article-devsecops-security-foundations-least-privilege
aliases:
  - least-privilege
  - article-devsecops-security-foundations-least-privilege
  - devsecops/security-foundations/least-privilege.md
  - secrets-management-basics
  - article-devsecops-security-foundations-secrets-management-basics
  - devsecops/security-foundations/secrets-management-basics.md
  - devsecops/security-foundations/02-least-privilege-and-secrets.md
  - devsecops/security-foundations/02-least-privilege-and-secrets
  - security-foundations/02-least-privilege-and-secrets
---

## Table of Contents

1. [The Risk of Over-Privileged Access](#the-risk-of-over-privileged-access)
2. [What Is Least Privilege?](#what-is-least-privilege)
3. [Structuring Access as a Sentence](#structuring-access-as-a-sentence)
4. [Securing Workflow Tokens](#securing-workflow-tokens)
5. [Workload Identity vs Static Keys](#workload-identity-vs-static-keys)
6. [Secrets Management Basics](#secrets-management-basics)
7. [Dynamic Secret Injection at Runtime](#dynamic-secret-injection-at-runtime)
8. [Rotation and Incident Cleanup](#rotation-and-incident-cleanup)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Risk of Over-Privileged Access

Every application needs credentials to interact with adjacent systems. A backend service needs a database password. A build workflow needs a token to upload container images. A deployment runner needs a key to configure cloud servers. 

But when access is configured carelessly, these credentials carry far more power than their specific jobs require. Consider these three common failures:

* **Static Master Keys**: A database password with full administrator rights is hardcoded in a configuration file. An attacker exploits a read vulnerability in the application, recovers the password, and drops the entire production database.
* **Over-Scoped Builder Roles**: A CI/CD runner is granted administrative cloud permissions so that its deployment script *"just works."* When an untrusted pull request execution hijacks the runner, it gains the power to delete the company's billing account.
* **Shared Environments**: A production service uses the same credentials as the staging and development environments. A developer debugs a staging database issue and accidentally runs an destructive script against the live production tables.

To prevent these disasters, we rely on two core security principles: **Least Privilege** and **Secrets Management**. Least privilege limits what each actor can do. Secrets management controls the credentials that prove who those actors are.

## What Is Least Privilege?

The principle of least privilege states that every user, program, workflow, and system process should operate using the absolute minimum set of privileges necessary to complete its specific task.

Think of it like a valet key for a car. When you hand your car keys to a parking valet, you do not give them your house keys, your office keys, and the key to your mailbox. You give them a valet key that only has the power to start the engine and drive a short distance. It cannot open the glove compartment or unlock the trunk:

* **Full Master Access**: Standard Key &rarr; Starts car + opens glovebox + unlocks trunk + opens house + opens office.
* **Least Privilege Access**: Valet Key &rarr; Starts car only (glovebox and trunk stay locked, house and office keys removed).

In software delivery, we apply this valet key discipline to every job in our pipeline:

* **A test runner** needs to read the repository source code and report passing status. It has no need to publish packages or deploy files.
* **A build runner** needs to read source code and push a container image to a registry. It has no need to request cloud administration permissions.
* **A deploy runner** needs to read the built container digest and update a specific production service. It has no need to write code to the repository or read billing data.
* **A running application** needs to read its own database tables and write application logs. It has no need to list other services' credentials or change cloud networking.

By matching permissions strictly to the task at hand, we isolate potential failures. If a test runner gets compromised, the attacker only gains read access to the current commit, not the power to deploy malware directly to customers.

## Structuring Access as a Sentence

Access control policies can quickly become a complex web of nested YAML, JSON, and provider-specific configurations. A useful habit to make these rules understandable is to write them out as a simple sentence:

**Actor** can perform **Action** on **Target** for a specific **Duration**.

Applying this structure reveals the difference between a secure, narrow design and a dangerous, broad one:

* **Secure, Narrow Policy**: The *deploy-prod runner* (**Actor**) can *update* (**Action**) the *orders-api-prod service* (**Target**) for a *30-minute deployment session* (**Duration**).
* **Insecure, Broad Policy**: The *CI platform* (**Actor**) can *do anything* (**Action**) in our *entire Cloud Account* (**Target**) *forever* (**Duration**).

When writing or reviewing policies for workflows, roles, or running processes, always write down this sentence first. If the "Target" includes unrelated resources, or the "Action" is a wildcard (`*`), the policy is too broad and should be split.

## Securing Workflow Tokens

In CI/CD tools like GitHub Actions, automation runs are executed using a temporary cryptographic token (`GITHUB_TOKEN`). This token is automatically generated for every job run. By default, older repositories grant this token broad read and write permissions across the entire workspace.

To enforce least privilege, we write explicit `permissions` blocks directly in our workflow YAML configuration:

```yaml
name: build-and-publish

on:
  push:
    branches: ["main"]

permissions:
  contents: read
  packages: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      - name: Publish Package
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Notice the design choices in this workflow:

* **Declared Permissions**: The top-level `permissions` block limits the GITHUB_TOKEN to the bare minimum. `contents: read` allows checking out the repository code. `packages: write` allows pushing the completed image or package.
* **No Extra Reach**: The workflow is denied permissions like `actions: write` (managing workflows), `security-events: write` (updating security scans), or `id-token: write` (requesting cloud identity roles).
* **Isolation**: The publish step only consumes the `GITHUB_TOKEN` locally via an environment variable (`NODE_AUTH_TOKEN`), preventing other unrelated steps in the job from leaking it to external log systems.

## Workload Identity vs Static Keys

For a runner to deploy files to a cloud provider (such as AWS, Google Cloud, or Azure), it must authenticate itself. Historically, developers did this by generating a static, long-lived access key pair (like an AWS Access Key ID and Secret Access Key) and saving it as a repository secret.

Static keys are highly sensitive. If an attacker gains access to the repository secrets, they acquire a permanent credential that bypasses the delivery pipeline completely. 

To eliminate this risk, modern systems use **Workload Identity Federation** (often implemented via OpenID Connect or OIDC). Instead of storing a password, the runner requests a short-lived, single-use identity token from GitHub Actions and exchanges it with the cloud provider for a temporary session key:

| Dimension | Static Access Keys | Workload Identity (OIDC) |
| :--- | :--- | :--- |
| **Lifecycle** | Permanent until manually rotated. | Temporary (expires automatically, e.g., in 15-30 minutes). |
| **Storage** | Must be saved as a static string in repository secrets. | No keys stored. Uses trust rules configured between GitHub and the Cloud. |
| **Scope** | Often broad, administrative access. | Narrowly scoped to a specific deployment role. |
| **Audit Path** | Hard to map a cloud action back to a specific workflow run. | Cloud logs show the exact workflow run ID and commit SHA that assumed the role. |

By configuring trust between the systems, the deploy workflow gets the temporary power it needs without leaving a single static credential in the repository.

## Secrets Management Basics

Workloads still need credentials to communicate with third-party APIs (like database servers, payment gates, or notification webhooks). These sensitive strings are called **secrets**.

A fundamental rule of security is that **secrets must never be committed to source control**. Even if a repository is private, hardcoding secrets in code makes them permanent part of the Git history, exposing them to anyone who pulls the repo or runs a build.

Instead, we use a central **Secrets Manager** (like AWS Secrets Manager, HashiCorp Vault, or Google Secret Manager) to store sensitive variables securely. The repository should only contain sample files that show which variables are required without revealing the real values:

```dotenv
# .env.example (Safe to commit to Git)
PORT=3000
DATABASE_URL=postgres://user:password@localhost:5432/orders
PAYMENT_API_URL=https://sandbox-payments.example.test
PAYMENT_API_TOKEN=replace-me-in-local-dev
```

The string `replace-me-in-local-dev` acts as a clear sign. It tells local developers that they must supply their own mock credentials, while production systems will pull live values from a secure vaults.

## Dynamic Secret Injection at Runtime

Once secrets are securely stored, how does our running application read them? We avoid writing secrets to disk or baking them into container images during the build step. If a secret is baked into an image, anyone who pulls that image (such as an engineer testing locally) can extract the credential.

Instead, we use **dynamic injection** at runtime. The runtime platform (like Kubernetes or a managed cloud environment) retrieves the secrets from the vault at startup and exposes them to the application using one of two methods:

1. **Mounted Files**: The secrets are written to an in-memory, read-only directory (such as `/var/run/secrets/db-password`). The application reads the file's contents at startup.
2. **Environment Variables**: The secrets are loaded directly into the process environment memory (`process.env.DATABASE_URL`).

```mermaid
flowchart TD
    VAULT["Cloud Secret Store"] -->|1. Authenticate & Retrieve| PLATFORM["Runtime Platform (Kubernetes)"]
    PLATFORM -->|2. Mount in Memory| MEM["In-Memory tmpfs Directory"]
    MEM -->|3. Read File at Startup| APP["Node.js Application Process"]
    APP -->|4. Establish Connection| DB["Production Database"]
```

Mounted files are generally preferred over environment variables. If an application crashes, its environment variables are often printed in debug logs or crash dumps, exposing the secrets. Mounted files remain isolated in-memory and are not printed in system crash reports.

### Concrete Application Code Example

To see how an application reads these mounted files without losing the ability to run in local development, let us look at a concrete Node.js implementation:

```javascript
// src/config/secrets.js
import fs from 'fs';
import path from 'path';

/**
 * Safely loads a production secret from a mounted file,
 * falling back to an environment variable in local development.
 */
export function getSecret(secretName, fallbackValue = null) {
  const prodSecretPath = path.join('/var/run/secrets/orders', secretName);

  try {
    if (fs.existsSync(prodSecretPath)) {
      // Read the secret file, trim whitespace, and return it
      return fs.readFileSync(prodSecretPath, 'utf8').trim();
    }
  } catch (error) {
    console.warn(`Failed to read production secret from file: ${secretName}`, error);
  }

  // Fall back to environment variable for local sandbox testing
  return process.env[secretName.toUpperCase()] || fallbackValue;
}

// Usage in our application initialization
const dbUrl = getSecret('database-url', 'postgres://user:password@localhost:5432/orders');
const paymentToken = getSecret('payment-token');

if (!paymentToken) {
  throw new Error('Fatal: payment-token is missing and cannot be initialized.');
}
```

This Node.js snippet shows the benefit of dynamic injection. In production, our app reads the unique mounted secrets securely from memory (`fs.readFileSync`). In local development, the file does not exist, so the function automatically falls back to safe local environment variables, keeping the developer workflow identical.

## Rotation and Incident Cleanup

A credential should never be permanent. Over time, keys can leak through logs, backups, or developer laptops. To bound the impact of a silent leak, we practice **Rotation**—the routine replacement of an active secret with a new value.

A healthy rotation process must follow a **two-phase update** to prevent application downtime:

**Phase 1: Dual-Support**
Add the new secret version to the database/API &rarr; Keep the old secret active &rarr; Update the application configuration to use the new secret &rarr; Confirm the application restarts and connects successfully.

**Phase 2: Deprecation**
Confirm all application instances are running on the new secret &rarr; Deactivate the old secret version &rarr; Revoke old credentials &rarr; Audit access logs to confirm the old key is no longer used.

If the old key is never deactivated, the rotation is incomplete. 

If an active leak is detected (such as a token printed in a public CI pipeline log), we treat the credential as fully compromised. Deleting the log file is not enough. The team must immediately:
1. **Revoke** the token authority at the source provider.
2. **Rotate** the secret, generating a fresh key.
3. **Audit** access logs to confirm no unauthorized requests were made while the key was exposed.

## Putting It All Together

Limiting access and managing credentials are the operational anchors of DevSecOps. By combining least privilege with secrets management, we ensure that a failure in one component does not compromise the entire architecture.

When verifying your application access, ensure you maintain these practices:

* **Least Privilege**: Always start with a read-only permissions baseline for workflows, roles, and human users.
* **Workload Identity**: Replace long-lived static API keys with short-lived federated tokens (OIDC) for deployment pipelines.
* **Decoupled Configuration**: Store configuration in the codebase, but keep secrets in a dedicated Secrets Manager.
* **Dynamic Injection**: Deliver secrets to running processes as mounted in-memory files at runtime rather than baking them into container images.
* **Routine Rotation**: Implement a scheduled rotation cycle and confirm that old key versions are deactivated.

## What's Next

Restricting access and credentials secures our active operations. In the next chapter, we will cover **Ownership and Evidence**, learning how to map code ownership to named reviewers and gather tamper-proof logs to verify that our security controls are working.

![Least privilege and secrets summary map](/content-assets/articles/article-devsecops-security-foundations-least-privilege/privilege-secrets-summary.png)

*This summary ties least privilege to scoped tokens, workload identity, secret storage, runtime injection, and rotation.*

---

**References**

- [CISA Zero Trust Maturity Model](https://www.cisa.gov/resources-tools/resources/zero-trust-maturity-model) - CISA guidelines on identity verification, session limitations, and least privilege access.
- [GitHub Actions - Permissions for the GITHUB_TOKEN](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication) - Official documentation on token scoping and default permissions configurations.
- [AWS Security Best Practices - Least Privilege IAM Policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#grant-least-privilege) - AWS principles for designing narrow IAM roles and resources.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) - Standard guidelines for storing, accessing, rotating, and revoking sensitive secrets.
- [NIST SP 800-207 Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final) - NIST principles on resource-centric access, short-lived sessions, and identity protection.
