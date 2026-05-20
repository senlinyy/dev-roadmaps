---
title: "Secrets Management"
description: "Store, deliver, rotate, and remove credentials without letting them become permanent production keys."
overview: "Secrets are the values software uses to prove identity to another system. This article explains where secrets live, how they move through delivery systems, and what real incidents teach about rotation and exposure."
tags: ["secrets", "rotation", "vaults", "ci"]
order: 4
id: article-devsecops-security-foundations-secrets-management-basics
aliases:
  - secrets-management-basics
  - article-devsecops-security-foundations-secrets-management-basics
  - devsecops/security-foundations/secrets-management-basics.md
---

## Table of Contents

1. [What Is a Secret?](#what-is-a-secret)
2. [Where Secrets Appear](#where-secrets-appear)
3. [Delivery Secrets](#delivery-secrets)
4. [Runtime Secrets](#runtime-secrets)
5. [Rotation](#rotation)
6. [Case Study: Codecov](#case-study-codecov)
7. [Leak Evidence](#leak-evidence)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Is a Secret?

A secret is a value that lets one actor prove identity to another system. Passwords, API keys, deploy tokens, private keys, webhook signing keys, database URLs, session secrets, and cloud credentials are all secrets. The value matters because another system trusts it.

Secrets are different from configuration. A region name, feature flag, or service URL may be configuration. A database password is a secret because anyone who has it can act as the database user. A cloud access key is a secret because anyone who has it can call the cloud API as that identity.

The core questions are practical:

```text
Where is the secret stored?
Who can read it?
How does it reach the process that needs it?
How do we rotate it?
How do we know it was exposed?
```

If the team cannot answer those questions, the secret will eventually become a hidden dependency. Hidden secrets are hard to rotate because nobody knows which job, service, developer laptop, or old script still uses them.

## Where Secrets Appear

Secrets appear in more places than teams expect. The safest design is to assume they can leak anywhere code or automation can read environment variables, files, process memory, logs, caches, or build artifacts.

| Place | Example | Risk |
|-------|---------|------|
| Repository | `.env`, private key, token in a script | Long-lived leak through source history |
| CI secret store | `NPM_TOKEN`, cloud key | Exposed to workflow steps with secret access |
| Runner environment | Environment variables during a job | Read by scripts, dependencies, or actions |
| Runtime secret store | Database password, API key | Exposed to the application process |
| Logs | Command output or stack trace | Secret copied into searchable evidence |
| Cache or artifact | Build cache, test report, archive | Secret moves to a later job or download |
| Developer machine | CLI config, SSH key, npm token | Local compromise becomes service compromise |

This table is not a reason to panic. It is a map. Each row needs a storage rule and a delivery rule. Repository secrets need scanning and removal from history when leaked. CI secrets need workflow boundaries. Runtime secrets need service identity and narrow read access. Logs need redaction and review. Developer machines need credential hygiene and short-lived access when possible.

## Delivery Secrets

Delivery secrets are used by CI/CD systems. They publish packages, push images, assume cloud roles, sign artifacts, call deployment APIs, or notify other systems.

The first improvement is to avoid long-lived secrets where a short-lived identity can do the job. In GitHub Actions, OpenID Connect lets a workflow request a short-lived token and exchange it with a cloud provider or supported registry. The workflow still needs careful boundaries, but there is no static cloud key sitting in the repository secret store.

```yaml
permissions:
  contents: read
  id-token: write

jobs:
  deploy-prod:
    environment: production
    steps:
      - run: ./scripts/exchange-oidc-for-cloud-token.sh
      - run: ./scripts/deploy-prod.sh
```

The `id-token: write` line is powerful. It allows the job to request a GitHub OIDC token. The `environment: production` line matters because environment protection rules can require approval before the job receives environment-specific secrets or proceeds with deployment. The script should exchange the token for access scoped to the repository, workflow, branch, and environment the cloud provider expects.

Short-lived identity reduces one class of secret, but it does not remove the need for trust boundaries. If untrusted code can run inside the deploy job, it can use the short-lived identity while it exists.

## Runtime Secrets

Runtime secrets are used by the running application. The orders service needs a database credential. It may need a payment API token. It may need a signing key for sessions. Those values should be delivered to the service at runtime from a controlled secret store, not baked into the image.

```text
orders-api container image
  -> no database password inside image
  -> runtime identity reads orders/prod/database-url
  -> process receives value as mounted file or environment variable
```

The image should be reusable across environments. The same image digest can run in staging and production because the environment supplies the secret at runtime. If the secret is baked into the image, rotating the secret requires rebuilding and republishing the image. It also means anyone who can pull the image may be able to recover the secret.

Environment variables are convenient, but they are not invisible. They can appear in process inspection, crash reports, debug output, or accidental logs. Mounted secret files have their own risks. The important choice is to know how the value reaches the process and which tools can read it.

## Rotation

Rotation means replacing a secret with a new value and retiring the old value. Rotation is easy to say and hard to do when the secret has spread.

A good rotation plan has two phases:

```text
1. Add the new secret and move consumers to it.
2. Disable the old secret after evidence shows consumers have moved.
```

The first phase avoids downtime. The second phase removes risk. If the old value stays enabled forever, rotation did not finish.

Here is a small rotation record:

```text
Secret: orders/prod/database-url
Reason: quarterly rotation
New version: 2026-05-19-01
Consumers: orders-api-prod, orders-worker-prod
Validation: both services opened database connections with new version
Old version disabled: 2026-05-19T12:30Z
Owner: orders-team
```

The `Consumers` line matters because a secret usually has more than one reader. The `Validation` line matters because rotation should be proven through behavior, not hope. The `Old version disabled` line matters because enabled old secrets keep the original risk alive.

## Case Study: Codecov

Codecov's April 2021 postmortem described a compromise of its Bash Uploader. The incident involved an attacker modifying the uploader script, which customers commonly ran in CI. The modified script could collect credentials from CI environments and send them to an attacker-controlled server. Codecov's response included customer notification, rotation guidance, and investigation of affected uploaders.

The lesson is direct: a CI environment often contains valuable secrets because it can build, test, publish, and deploy. A script that runs inside that environment may be able to read those values. The script may come from a vendor, a package, a shell command, or a checked-in helper.

Read the risk path:

```text
CI job
  -> downloads uploader script
  -> runs script with environment variables present
  -> script reads secrets
  -> secrets leave the environment
```

The controls are also direct. Pin or verify downloaded tooling. Prefer official actions or checked-in scripts over unchecked network scripts. Keep CI secrets scoped to the exact job that needs them. Avoid putting production secrets in test jobs. Rotate secrets when there is credible evidence that a CI job or runner may have exposed them.

Codecov is also a reminder that secret management includes response. A team needs to know which secrets were present in affected jobs, which systems accepted those secrets, and which rotations prove the old values no longer work.

## Leak Evidence

When a secret leak alert fires, start by identifying the secret and its authority.

```text
Secret type: npm automation token
Found in: GitHub Actions log
Repository: devpolaris-orders-api
First seen: workflow run #1842
Authority: publish packages under @devpolaris/orders-api
Status: revoked
Replacement: npm trusted publishing via OIDC
```

`Secret type` tells you what kind of value leaked. `Found in` tells you where evidence exists. `Authority` tells you what the value could do. `Status` tells you whether the old value still works. `Replacement` records the safer path.

Do not stop after deleting the visible copy. If a secret reached Git history, logs, caches, build artifacts, or a public package, assume it was copied. The safe response is revoke or rotate the value, then remove the exposure path.

## Putting It All Together

Secrets are credentials in motion. They start in a secret store, reach a workflow or process, and let that actor call another system. The security job is to keep that path narrow and reviewable.

For `devpolaris-orders-api`, delivery secrets belong only in trusted jobs. Runtime secrets are delivered by the environment, not baked into the image. Long-lived static cloud keys are replaced with short-lived identity where possible. Rotation records name consumers and prove the old value was disabled.

The Codecov case shows why this matters. A script running in CI can become a secret collection point if secrets are broadly available. Narrow job scopes, verified tooling, and rotation evidence reduce the damage when a tool or workflow is compromised.

## What's Next

Secrets prove identity. Audit logs and evidence show how those identities were used. The next article explains which records help a team answer what changed, who acted, and what production is running now.

---

**References**

- [Codecov April 2021 postmortem](https://about.codecov.io/apr-2021-post-mortem/) - Codecov describes the Bash Uploader compromise, investigation, and customer guidance.
- [CircleCI January 2023 incident report](https://circleci.com/blog/jan-4-2023-incident-report/) - CircleCI describes an incident involving customer secrets and broad rotation guidance.
- [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) - GitHub explains short-lived OIDC tokens for deployment workflows.
- [GitHub encrypted secrets documentation](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) - GitHub documents how secrets are stored and made available to workflows.
