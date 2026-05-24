---
title: "Secrets & Encryption"
description: "Store private runtime values in AWS, control which workload roles can read them, and gather evidence without exposing the secret."
overview: "After an application has a workload role, the next question is where its private values live. This article explains Secrets Manager, Parameter Store, KMS envelope encryption, and audit trails."
tags: ["secrets", "encryption", "kms", "cloudtrail"]
order: 3
id: article-cloud-providers-aws-identity-security-secrets-encryption-basics
aliases:
  - secrets-manager-and-kms
  - secrets-encryption-and-security-evidence
  - secrets-and-encryption-basics
  - cloud-providers/aws/identity-security/secrets-encryption-and-security-evidence.md
  - cloud-providers/aws/identity-security/secrets-and-encryption-basics.md
---

## Table of Contents

1. [The Plaintext Injection Trap](#the-plaintext-injection-trap)
2. [What Counts as a Secret](#what-counts-as-a-secret)
3. [Secrets Manager vs Parameter Store](#secrets-manager-vs-parameter-store)
4. [KMS and Envelope Encryption](#kms-and-envelope-encryption)
5. [Auditing with CloudTrail and Safe Logging](#auditing-with-cloudtrail-and-safe-logging)
6. [Putting It All Together](#putting-it-all-together)

## The Plaintext Injection Trap

Now that your application container runs securely under a workload role and retrieves temporary credentials automatically, you face the next practical problem: Where do you store the sensitive credentials required by your code, such as database passwords, Stripe webhook signing keys, and vendor API tokens?

A common and highly insecure habit is to copy these values directly into the deployment configuration as plaintext strings. While this makes the secrets available to the container's environment variables at runtime, it creates major security vulnerabilities:

* **Exposure in operational surfaces**: Plaintext secrets copied into task definitions, build variables, or infrastructure-as-code files are visible to anyone who has access to the deployment history, build logs, or management console.
* **Accidental console leaks**: If an engineer inspects the environment configuration of a running container to debug a minor issue, the database password is displayed in plain text on their screen.
* **No dynamic lifecycle**: Because the secrets are hardcoded in the deployment configuration, rotating a database password requires editing your deployment scripts, regenerating your task definitions, and running a complete CI/CD deployment pipeline, increasing the risk of downtime.

To eliminate these vulnerabilities, you need to store your sensitive configuration in a vaulted, encrypted storage system in the cloud, dynamically inject the values directly into the container's memory at boot time, and keep them completely out of your deployment scripts, console screens, and build histories.

## What Counts as a Secret

To design a clean configuration structure, you must distinguish between ordinary application configuration and true runtime secrets.

* **Configuration**: Values that affect how your application behaves but grant no administrative authority. Examples include the port number your server listens on, the active logging level, or the base URL of a public API. These are safe to store as plaintext environment variables in your codebase or task definitions.
* **Secrets**: Highly sensitive values that grant direct access to protected data, systems, or third-party paid services. If an unauthorized person copies these values, they can connect directly to your production database, verify fake webhooks, or charge transactions to your company. These must be vaulted and encrypted.

Filing settings correctly prevents operational bloat:

* **Production database password**:
  * Type: Secret
  * Risk: Absolute data exposure. An attacker can bypass the app and query, modify, or delete database tables directly.
* **Stripe signing secret**:
  * Type: Secret
  * Risk: Payment fraud. An attacker can forge fake payment success webhooks, forcing the app to deliver orders without payment.
* **Logging Level (e.g., info or debug)**:
  * Type: Configuration
  * Risk: Extremely low. Changing the level changes console scrollback density but grants zero security access.
* **Server Port (e.g., 3000)**:
  * Type: Configuration
  * Risk: Extremely low. Defines which port the container binds to, but provides no authority to incoming requests.

If you treat every minor configuration setting as a secret, you introduce unnecessary operational overhead, increase system load times, and complicate local testing. Keep your standard configuration settings in ordinary environment files, and reserve your vaulted secure paths strictly for high-risk credentials.

## Secrets Manager vs Parameter Store

AWS provides two distinct systems for storing and retrieving runtime configurations: AWS Secrets Manager and Systems Manager Parameter Store. While both systems protect sensitive values by integrating with KMS encryption, they are built around different pricing, scale limits, and operational lifecycles.

AWS Secrets Manager is a dedicated vault engineered for high-value sensitive data that changes dynamically. It is optimized for active lifecycle management, supporting out-of-the-box cross-region replication (critical for disaster recovery) and native API integrations with database engines to automate password rotation. Secrets Manager charges a flat monthly fee per secret, making it a design target specifically for production credentials, third-party transactional tokens, and private API keys.

Systems Manager Parameter Store, on the other hand, is a hierarchical configuration and parameter tree designed to manage both plaintext and encrypted settings (via SecureString parameters). Standard parameters are free of charge, making them highly cost-effective for large configuration inventories, such as environment-specific URLs, resource tags, or feature toggles. However, Parameter Store does not support out-of-the-box cross-region replication, and automated rotation must be custom-built using Lambda schedules.

To decide where a setting belongs, engineers evaluate limits, costs, and features side by side.

Secrets Manager vs Systems Manager Parameter Store:

* **Max Size Limit**:
  * AWS Secrets Manager: 64 KB per secret.
  * SSM Parameter Store (Standard): 4 KB per parameter.
  * SSM Parameter Store (Advanced): 8 KB per parameter.
* **Pricing Metric**:
  * AWS Secrets Manager: Monthly fee per secret plus fee per 10,000 API requests.
  * SSM Parameter Store (Standard): Free tier for parameters and standard API throughput.
  * SSM Parameter Store (Advanced): Low monthly storage fee per parameter plus fee per 10,000 API requests.
* **Automated Rotation**:
  * AWS Secrets Manager: Native integration with RDS and custom Lambda rotation engines.
  * SSM Parameter Store: Must be manually orchestrated using custom EventBridge and Lambda functions.
* **Cross-Region Replication**:
  * AWS Secrets Manager: Native, automated replication of secrets across multiple regions.
  * SSM Parameter Store: Requires manual synchronization scripts or custom pipelines.

A vital pattern for containerized applications is to reference these secrets by their Amazon Resource Name (ARN) in the task definition rather than pasting the plaintext values.

```mermaid
flowchart TD
    Registry[Deployment pipeline] --> Register[Register ECS task definition]
    Register --> SecretARN[Reference Secret ARN in container config]
    SecretARN --> ECSAgent[ECS Agent boots container task]
    ECSAgent --> Fetch[Fetch secret from Secrets Manager]
    Fetch --> Decrypt[Decrypt secret value via KMS]
    Decrypt --> Inject[Inject plaintext secret into container RAM]
    Inject --> App[Application reads memory variable]
```

At container boot, the ECS agent reads the secret ARN from the task definition, calls the Secrets Manager API to retrieve the value, and injects it as an environment variable directly into the container's memory space. The developer writes standard code to read the environment variable, but the secret never touches the code repository, build system, or deploy files. It remains securely vaulted in AWS, cabled directly into memory.

## KMS and Envelope Encryption

When you write an encrypted parameter or secret to AWS storage, the plaintext value is never written to disk in its raw form. AWS enforces encryption at rest using the Key Management Service (KMS). To understand how this works in a high-capacity production system, you must look past simple key-locking concepts and inspect the underlying mechanism called Envelope Encryption.

Envelope Encryption is the practice of encrypting your sensitive data with a temporary symmetric key, and then encrypting that symmetric key itself with a persistent master key. To understand why AWS enforces this double-layer architecture rather than simply encrypting every secret directly with a master key, you must evaluate the performance and API limitations of a cloud-scale network:

* **The Network and Performance Bottleneck**: Symmetric encryption of large payloads requires significant CPU processing and network bandwidth. If an application had to send massive configuration files or database schemas directly to the KMS service over the network for encryption and decryption, the network latency would severely slow down container startup times.
* **KMS API Quota Throttling**: The persistent master keys inside KMS live behind hardware security modules (HSMs) that have strict API request limits (throttling thresholds). If thousands of container instances scaled up during a traffic spike and paged KMS to decrypt their configurations simultaneously, the KMS APIs would throttle, crashing the deployment.
* **Local Cryptographic Isolation**: By using envelope encryption, the master key never leaves the secure KMS boundary. KMS only decrypts a tiny, 256-bit symmetric key over the network. The actual heavy decryption of the secret payload happens locally in the memory space of Secrets Manager using that fast symmetric key, protecting your system from both network bottlenecks and API throttling.

To manage this process, you must choose between two distinct categories of master keys, known as Key Management styles:

* **AWS Managed Keys**: Default encryption keys created and managed automatically by AWS on your behalf (such as `aws/secretsmanager` or `aws/ssm`). These keys are free and require zero configuration, but they have a massive operational limitation: you cannot edit their key policies. This means they cannot be used to authorize cross-account access, preventing a developer or deployment role in a separate AWS staging account from reading production secrets encrypted under the default key.
* **Customer Managed Keys (CMKs)**: Persistent keys that you create, own, and configure within your organization. CMKs give you absolute control over key policies, IAM grants, and auto-rotation schedules. They are mandatory for secure, multi-account enterprise systems because they let you write custom permission policies to authorize exact workload roles across account boundaries.

The architectural elements of this envelope pattern include:

* **Customer Managed Key (CMK)**: The persistent Master Key, stored securely inside the hardware boundary of KMS. It never leaves KMS.
* **Data Key**: A unique, short-lived 256-bit symmetric key generated dynamically by KMS for the specific secret.
* **Encrypted Data Key**: The Data Key after being encrypted by the Master Key. It is stored directly alongside the encrypted secret payload on disk.

The operational lifecycle of envelope encryption is divided into two distinct phases.

### The Encryption Phase (When you save a secret)

* **Step 1: Request Data Key**: Secrets Manager requests a new Data Key from KMS, passing the ARN of your Customer Managed Key (CMK) as the master authority.
* **Step 2: Generate Keys**: KMS generates a new 256-bit symmetric Data Key in memory. It makes two copies: a plaintext Data Key and an encrypted Data Key (encrypted using your CMK master key).
* **Step 3: Deliver Keys**: KMS returns both copies to Secrets Manager over a secure network channel. The CMK remains locked inside KMS.
* **Step 4: Encrypt Payload**: Secrets Manager uses the plaintext Data Key in memory to encrypt your raw secret string.
* **Step 5: Discard Plaintext**: Secrets Manager immediately scrubs the plaintext Data Key from its memory.
* **Step 6: Write to Disk**: Secrets Manager writes the encrypted secret payload and the encrypted Data Key side by side to its persistent disk storage.

### The Decryption Phase (When a container task boots)

* **Step 1: Load Payload**: The ECS agent starts your container and requests the secret. Secrets Manager reads the encrypted payload and the encrypted Data Key from its disk.
* **Step 2: Decrypt Request**: Secrets Manager sends only the encrypted Data Key to KMS, asking for decryption.
* **Step 3: Hardware Decryption**: KMS reads the encrypted Data Key, decrypts it inside its highly secure HSM boundary using your CMK master key, and returns the plaintext Data Key to Secrets Manager.
* **Step 4: Decrypt Payload**: Secrets Manager uses the plaintext Data Key in memory to decrypt the encrypted secret payload.
* **Step 5: Scrub Memory**: Secrets Manager immediately discards the plaintext Data Key, never writing it to disk.
* **Step 6: Deliver Secret**: Secrets Manager returns the plaintext secret to the ECS agent, which injects it directly into your container's environment RAM.

```mermaid
flowchart TD
    AppTask[Application task container] --> Request[Request secret payload]
    Request --> SecretsManager[Secrets Manager reads encrypted payload]
    SecretsManager --> DecryptKey[Request KMS to decrypt Data Key]
    DecryptKey --> KMS[KMS uses Master Key to decrypt Data Key]
    KMS --> ReturnKey[Return plaintext Data Key to Secrets Manager]
    ReturnKey --> DecryptSecret[Decrypt secret payload with Data Key]
    DecryptSecret --> ReturnSecret[Return plaintext secret to application task]
```

This envelope design enforces absolute administrative control. To retrieve the database password, your application's workload role must have authorization to call both `secretsmanager:GetSecretValue` on the secret ARN, and `kms:Decrypt` on the specific Customer Managed Key (CMK) ARN. If a developer accidentally grants your container permission to read the secret vault but excludes the KMS key permission, the decryption fails, and the secret remains protected.

## Auditing with CloudTrail and Safe Logging

Storing your secrets in a vaulted system and encrypting them via KMS resolves the storage risk, but it leaves an operational question open: How do you prove that only authorized workloads are reading your secrets, and how do you prevent developers from accidentally printing those secrets during system incidents?

To gather evidence without exposing the secret payload, AWS implements AWS CloudTrail. CloudTrail acts as an immutable flight recorder for your AWS account, logging every single API request made to your resources:

* **Identifiable caller**: CloudTrail records the exact assumed workload role session principal that requested the secret.
* **Precise action**: It logs the exact operation, such as `GetSecretValue` or `Decrypt`.
* **Zero payload exposure**: CloudTrail records the metadata of the call—the timestamp, caller IP, and target ARN—but never logs the plaintext secret value itself.

While CloudTrail keeps your cloud API calls safe, your own application logs inside the container require careful design. A common diagnostic trap is writing broad exception catch blocks that print full objects or raw error strings to console output. 

For example, if your database connection fails, printing the raw connection error can write `postgres://user:password@host` directly into your stdout streams, exposing the password to your centralized logging platform.

Log Scrubbing and Exception Safety Rules:

* **Database Connection Traces**:
  * Dangerous Habit: `console.log(error)`
  * Safe Habit: `console.log("Database connection failed: check host reachability")`
  * Rationale: Standard database client errors print the full connection URI, including the plaintext password. Catch the error and print a generic status message.
* **Third-Party API Errors**:
  * Dangerous Habit: `console.log(JSON.stringify(response))`
  * Safe Habit: `console.log("Stripe API returned status code " + response.status)`
  * Rationale: API response bodies often contain client profiles, transaction details, or signing keys. Extract the metadata and discard the payload.
* **Local Exception Traces**:
  * Dangerous Habit: `console.log(process.env)`
  * Safe Habit: `console.log("Container boot complete: checked required config keys")`
  * Rationale: Printing the entire environment dump dumps every injected secret, database host, and token to console logs.

By combining AWS CloudTrail audits with safe, explicit application logging, you establish an ironclad security pipeline. You can easily prove which workload accessed your secrets while ensuring that your operational scrollback remains free of sensitive credentials.

## Putting It All Together

Securing your runtime credentials is the final layer of your application's security posture:

* **Isolate Secrets from Config**: Keep port numbers, debug levels, and URLs in ordinary environment variables. Reserve secure vaults strictly for database passwords and signing keys.
* **Inject via ARNs**: Never copy raw secrets into your codebase, container images, or deployment tasks. Reference the secret ARN in your container configuration and let the ECS agent inject it at boot.
* **Leverage Envelope Encryption**: Use customer-managed KMS keys to protect your data keys, dividing access control between vault permissions and key decryption permissions.
* **Scrub Your Output Logs**: Never log entire error objects, response payloads, or environment dumps to stdout. Keep your console scrollback clean of credentials.

By implementing vaulted secrets, envelope encryption, and safe logging, you build a cloud system that is highly secure at rest, protected during delivery, and fully audited at runtime.

---

**References**

- [AWS Secrets Manager User Guide](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html) - Documentation on storing, rotating, and retrieving runtime secrets.
- [What Is AWS KMS?](https://docs.aws.amazon.com/kms/latest/developerguide/overview.html) - Technical overview of the Key Management Service and envelope encryption mechanics.
- [AWS CloudTrail User Guide](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - Instructions on tracking user and workload API activity across your AWS account.
