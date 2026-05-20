---
title: "Secret Scanning"
description: "Find exposed credentials in code, logs, and pull requests, then rotate the authority they carried."
overview: "Secret scanning catches credentials before or after they enter source control. This article explains token evidence, push protection, rotation, and the Nx supply-chain incident as a real secret-exposure case."
tags: ["secrets", "tokens", "scanning", "rotation"]
order: 4
id: article-devsecops-pipeline-security-secret-scanning
---

## Table of Contents

1. [What Secret Scanning Finds](#what-secret-scanning-finds)
2. [The Authority Behind a Token](#the-authority-behind-a-token)
3. [Push Protection](#push-protection)
4. [Alert Triage](#alert-triage)
5. [Case Study: Nx S1ngularity](#case-study-nx-s1ngularity)
6. [Rotation Evidence](#rotation-evidence)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## What Secret Scanning Finds

Secret scanning looks for credentials in places where they should not be: source code, commit history, pull requests, issues, logs, packages, or artifacts. A scanner may find API keys, cloud access keys, npm tokens, private keys, database URLs, webhook secrets, or provider-specific credentials.

A secret is dangerous because it carries authority. The string itself is small, but another system may accept it as proof of identity.

```text
ghp_xxxxxxxxxxxxxxxxxxxx
npm_xxxxxxxxxxxxxxxxxxxx
AKIAxxxxxxxxxxxxxxxx
-----BEGIN PRIVATE KEY-----
postgres://orders_user:password@example/db
```

These examples are different formats, but the review question is the same:

```text
What could someone do if they had this value?
```

Deleting the value from the pull request is not enough if the value was already committed, logged, downloaded, or copied. The safe response is to revoke or rotate the credential, then remove the exposure path.

## The Authority Behind a Token

Treat every secret alert as an authority question.

```text
Secret type: npm token
Owner: devpolaris-orders-api release automation
Authority: publish @devpolaris/orders-api
Found in: GitHub Actions log
First exposed: workflow run #1842
Status: revoked
Replacement: trusted publishing through OIDC
```

`Secret type` tells you what kind of system accepts the value. `Owner` tells you who is responsible for rotation. `Authority` tells you what the value could do. `Found in` and `First exposed` tell you where evidence exists. `Status` tells you whether the value still works. `Replacement` records the safer path.

The authority line is the line to read first. A test-only token with read access to a sandbox service is different from a production package token with publish access. Both should be cleaned up. They do not have the same blast radius.

## Push Protection

Push protection tries to stop a secret before it enters the remote repository. When a developer pushes a commit containing a recognized token pattern, the platform can block the push or require explicit bypass.

The developer experience may look like this:

```text
Push blocked
Reason: potential npm token detected
File: scripts/release.env
Line: 3
Action: remove the token from the commit or confirm a safe bypass
```

The useful details are file, line, token type, and action. The developer should remove the token from the commit, rotate it if it was real, and move the secret into the approved secret store if the workflow truly needs it.

Push protection is strongest for known token formats and providers. It may miss custom secrets, short passwords, encoded values, or new token formats. It is a guardrail, not a replacement for secret design.

## Alert Triage

When an alert appears, triage it in this order:

```text
1. Identify the secret type.
2. Identify the authority.
3. Revoke or rotate the value.
4. Find where it was exposed.
5. Remove or rewrite the exposure path.
6. Record the replacement.
```

The order matters because exposure cleanup can take time. Revocation stops the old value from working while cleanup continues.

Here is a triage record:

```text
Alert: secret-scanning-2026-05-19-004
Type: cloud access key
Location: commit 8f2a91d scripts/debug-prod.sh
Authority: read production logs
Action: key disabled, replacement moved to OIDC role
Owner: platform-team
Closed: 2026-05-19T11:20Z
```

This record lets the team prove that the leaked value was disabled and that the replacement path is safer.

## Case Study: Nx S1ngularity

Nx published a postmortem for the 2025 S1ngularity npm supply-chain incident. The attack involved a GitHub Actions workflow injection path, a stolen npm token, malicious package versions, and local developer secret exposure behavior. Nx's response included package cleanup, token rotation, and hardening work.

The secret-scanning lesson is that leaked tokens can become publishing authority. Once a publish token is stolen, the registry may accept malicious versions from an attacker. Downstream users then install a package that appears to come from the trusted project name.

Read the path:

```text
workflow injection
  -> npm token exposure
  -> malicious package publish
  -> downstream install
  -> local secrets at risk
```

Secret scanning can help at several points. It can catch a token committed to source. It can alert when a token appears in a log. It can help responders search for exposed credentials after malicious code runs. It cannot repair the trust path by itself. The token still needs revocation, and the workflow path that exposed it still needs hardening.

## Rotation Evidence

A rotation record should prove that the old value stopped working and the new path works.

```text
Credential: npm automation token
Reason: exposed in workflow log
Old value: revoked at 2026-05-19T10:52Z
Replacement: npm trusted publishing
Validation: package dry-run succeeded from release workflow #1848
Exposure cleanup: log access restricted, workflow output redacted
Owner: platform-team
```

The `Old value` line matters because removal from source does not revoke a credential. The `Validation` line matters because replacement credentials can break delivery. The `Exposure cleanup` line records what happened to the place where the secret appeared.

## Putting It All Together

Secret scanning finds sensitive values that escaped their intended storage path. The right response starts with authority, not the string. What could the token do? Where did it appear? Who owns it? Is it revoked? What replaces it?

The Nx incident shows how secret exposure can connect directly to package publishing and downstream compromise. For `devpolaris-orders-api`, secret scanning should be paired with push protection, low-power pull request jobs, short-lived OIDC identity where possible, and rotation records that prove old values are dead.

## What's Next

Secrets and code scanning protect the source and workflow path. Protected branches and environments add gates around merge and deployment so sensitive changes cannot move through the path without the right checks and approvals.

---

**References**

- [Nx S1ngularity postmortem](https://nx.dev/blog/s1ngularity-postmortem) - Nx describes the 2025 npm supply-chain incident, token exposure, malicious publishes, and hardening work.
- [GitHub secret scanning](https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning) - GitHub documents secret scanning behavior and supported secret detection.
- [GitHub push protection](https://docs.github.com/en/code-security/secret-scanning/push-protection-for-repositories-and-organizations) - GitHub documents push protection for blocking supported secrets before they enter repositories.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) - npm documents publishing packages through trusted identity instead of long-lived automation tokens.
