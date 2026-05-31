---
title: "Cloud Identity and Access Management"
description: "Enforce least privilege IAM policies, eliminate static credentials with dynamic OIDC role assuming, and design audited break-glass recovery paths."
overview: "Cloud infrastructure security shifts the security perimeter from network boundaries to identity policies. This article explains how to audit wildcard privileges, transition to short-lived temporary access, and orchestrate secure, time-limited emergency access sessions."
tags: ["iam", "oidc", "least-privilege", "break-glass", "audit-logging"]
order: 4
id: article-devsecops-cloud-infrastructure-security-cloud-identity-and-access
aliases:
  - iam-review
  - break-glass-access
  - article-devsecops-cloud-infrastructure-security-iam-review
  - article-devsecops-cloud-infrastructure-security-break-glass-access
  - devsecops/cloud-infrastructure-security/iam-review.md
  - devsecops/cloud-infrastructure-security/break-glass-access.md
  - devsecops/cloud-infrastructure-security/04-cloud-identity-and-access.md
  - devsecops/cloud-infrastructure-security/04-cloud-identity-and-access
  - cloud-infrastructure-security/04-cloud-identity-and-access
---

## Table of Contents

1. [The Identity Perimeter in Modern Cloud](#the-identity-perimeter-in-modern-cloud)
2. [Anatomy of a Cloud Credential Hijack](#anatomy-of-a-cloud-credential-hijack)
3. [Scoping Down IAM Policies: Action, Resource, and Condition](#scoping-down-iam-policies-action-resource-and-condition)
4. [Eliminating Static Keys with Dynamic OIDC Role Assuming](#eliminating-static-keys-with-dynamic-oidc-role-assuming)
5. [Privileged Just-In-Time and Break-Glass Access](#privileged-just-in-time-and-break-glass-access)
6. [Forensic Audit Trails and Incident Investigation](#forensic-audit-trails-and-incident-investigation)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Identity Perimeter in Modern Cloud

In traditional on-premises infrastructure, security relied almost entirely on the network perimeter. Firewalls, physical isolation, and Virtual Private Networks (VPNs) formed a solid defensive wall around servers and data. If a bad actor was outside the corporate network, they could not touch the applications. 

Modern cloud computing completely changes this security model. In a highly distributed cloud, resource endpoints—such as object storage buckets, database engines, and serverless compute functions—are theoretically accessible from anywhere on the global internet via public API endpoints. What prevents a random internet connection from deleting a production database or downloading proprietary source code is not a physical firewall, but the cloud provider's Identity and Access Management (IAM) engine.

Consequently, identity has become the primary security perimeter in the cloud. Every compute task, deployment runner, and system operator must carry an authenticated cryptographic identity. If a single identity is granted excessive permissions, or if its associated access keys are leaked, the entire network perimeter becomes irrelevant. Auditing and hardening how cloud workloads establish identity, acquire credentials, and exercise permissions is the most critical control in a modern cloud architecture.

## Anatomy of a Cloud Credential Hijack

To understand why loose identity control represents a catastrophic risk, we must examine how credential compromise unfolds in a real cloud environment. Consider a common deployment pipeline design that runs into a silent vulnerability.

An engineering team deploys a serverless web API to handle order processing. Because the application was developed rapidly under pressure, the infrastructure engineer configures the application runtime role using a generic administrative wildcard policy. This policy permits every cloud action on every cloud resource. During a routine feature release, the team includes a third-party dependency in the application bundle to convert customer invoices into PDFs.

A remote attacker discovers a known remote code execution vulnerability inside that third-party PDF utility. They send a malicious payload to the orders API endpoint, forcing the application to execute an arbitrary system command. The attacker runs a script that calls the cloud provider's internal metadata endpoint to retrieve the temporary credentials associated with the compute runtime role.

Because the compute runtime role was configured with administrative wildcards, the stolen temporary credentials grant the attacker full, unrestricted access to the entire cloud account. Within minutes, the attacker bypasses all network boundaries. They log into the cloud API, disable active security logs, create administrative users, deploy thousands of high-cost cryptocurrency mining tasks, and copy customer databases to an external storage server.

The core lesson of this incident is that the primary failure was not the software vulnerability in the PDF utility, but the over-scoped identity role. Had the orders API role been strictly constrained to its narrow, intended actions, the stolen credentials would have given the attacker no path to read other secrets, provision new machines, or access customer data, halting the blast radius of the exploit immediately.

## Scoping Down IAM Policies: Action, Resource, and Condition

Hardening cloud identity requires translating loose human intentions into strict, programmatic policies. An IAM policy is a structured statement that answers four specific questions: who is making the request, what action is being requested, which resource is targeted, and under what conditions the request is evaluated.

Most cloud provider engines evaluate these policies as an explicit allow model with a default deny. Any request that is not explicitly permitted by a matching policy is blocked. If an identity is subject to an explicit deny statement, that statement overrides all allows, regardless of policy evaluation order.

To secure an application runtime, we must write policies that adhere strictly to the principle of least privilege, eliminating generic wildcards in favor of explicit declarations. Consider a vulnerable policy compared directly to its hardened, scoped-down counterpart.

A vulnerable identity policy relies on wildcard actions and unrestricted resources:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAllS3Operations",
      "Effect": "Allow",
      "Action": ["s3:*"],
      "Resource": ["*"]
    }
  ]
}
}
```

This statement allows the identity to perform every possible action on every storage bucket in the cloud account, including deleting public buckets or modifying resource permission settings.

We harden this policy by specifying the exact action, targeting the specific resource ARN, and binding the request to a runtime tag condition:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOrderInvoicesOnly",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::devpolaris-orders-invoices-prod/*"],
      "Condition": {
        "StringEquals": {
          "aws:PrincipalTag/Environment": "production"
        }
      }
    }
  ]
}
```

This hardened policy limits the workload to a single operation (`s3:GetObject`) and restricts the target to a specific storage path (`devpolaris-orders-invoices-prod/*`). Furthermore, the condition statement adds an extra evaluation layer, verifying that the session carrying the request is formally tagged as a production resource. By implementing these constraints, the policy guarantees that a compromised credential cannot be abused to read other buckets or modify critical infrastructure settings.

## Eliminating Static Keys with Dynamic OIDC Role Assuming

Historically, connecting external systems (like CI/CD runners, third-party monitoring platforms, or on-premises servers) to cloud APIs required generating static, long-lived access keys. These keys consisted of an access key ID and a secret access key, which were copied manually into pipeline secret stores or configuration files.

Static credentials represent a severe, recurring security risk. Because they never expire automatically, they remain active indefinitely unless they are manually rotated. If a developer accidentally commits a credential file to a public repository, or if an attacker gains access to a backup of the CI/CD configuration database, the permanent key is exposed. The attacker can use these permanent credentials to access the cloud APIs from any laptop, bypassing all repository controls.

Modern DevSecOps workflows eliminate static keys entirely by utilizing dynamic OpenID Connect (OIDC) role assuming. OIDC establishes a federated, cryptographic trust relationship between your cloud provider and your identity provider (such as GitHub Actions, GitLab CI, or an internal corporate identity server).

```mermaid
flowchart TD
    Runner["CI/CD Runner Task"] --> RequestJWT["1. Request short-lived OIDC JWT"]
    RequestJWT --> Provider["Identity Provider (e.g., GitHub)"]
    Provider --> SendJWT["2. Issues signed JWT with repository context"]
    SendJWT --> Runner
    Runner --> AssumeRole["3. Request STS AssumeRoleWithWebIdentity (passes JWT)"]
    AssumeRole --> CloudAPI["Cloud STS API"]
    CloudAPI --> VerifyOIDC["4. Verify JWT signature against Identity Provider trust"]
    VerifyOIDC --> IssueCreds["5. Returns temporary session credentials (1 hour)"]
    IssueCreds --> Runner
    Runner --> CloudOps["6. Perform scoped cloud operations"]
```

This federated identity exchange operates through six systematic steps:

First, the CI/CD runner task requests a short-lived OIDC JSON Web Token (JWT) from its native identity provider. This token contains metadata about the active pipeline run, such as the repository name, branch, environment, and workflow run ID.

Second, the identity provider issues the cryptographically signed JWT, populated with the specific repository attributes.

Third, the runner connects directly to the cloud provider's Security Token Service (STS) API, presenting the identity provider's signed JWT and requesting to assume a preconfigured IAM role.

Fourth, the cloud provider's STS engine evaluates the request. It verifies the cryptographic signature of the JWT against the trusted identity provider configuration and checks the role's trust policy to ensure that the repository metadata matches the allowed criteria.

Fifth, if the metadata matches, the cloud STS engine generates temporary, short-lived session credentials (typically valid for one hour or less) and returns them to the runner.

Sixth, the runner uses these temporary credentials to perform its configured infrastructure changes, discarding the credentials immediately when the job finishes.

By adopting OIDC federated role assuming, we eliminate the need to store long-lived secrets inside external platforms. If an attacker compromises a runner's active memory or configuration, they only acquire access to credentials that expire within minutes, and they cannot reuse those credentials after the session window closes.

## Privileged Just-In-Time and Break-Glass Access

In a secure cloud environment, developers and operators must not have permanent, standing administrative access to production environments. Standard infrastructure changes, application deployments, and patch operations should proceed exclusively through automated CI/CD pipelines. Permanent administrative privileges on human accounts create a massive attack surface: a single compromised laptop or hijacked corporate password can give attackers immediate control of active cloud accounts.

However, complex production incidents will occasionally occur where standard pipelines are unavailable. For example, a failed deployment script might lock the infrastructure state, or a major database connection failure might require immediate manual intervention. For these rare emergencies, organizations must design a privileged **Just-in-Time (JIT)** and **Break-Glass** access system.

Break-glass access is a highly structured, temporary bypass path. It is designed to be accessible enough to use during high-stress incidents, yet rigorous enough to generate undeniable audit evidence for every action taken.

To enforce security during emergency manual interventions, the JIT break-glass access flow must adhere to five strict design controls:

* **Short-Lived Expiry**: Emergency credentials must never persist. The JIT system must automatically revoke the privileges or expire the session tokens after a pre-configured time limit (such as 60 minutes).
* **Multi-Party Peer Approval**: Activating a privileged session must require a formal request that is approved by a different, named peer. This ensures that no single individual can unilaterally grant themselves administrative access during a crisis.
* **Incident Binding**: Every request must be programmatically linked to an active, verified incident ticket ID (such as `INC-102`). The request must document the specific, expected actions the operator plans to perform.
* **Attributable Human Sessions**: Emergency roles must never rely on generic, shared credentials. Every privileged session must be tied to a specific, authenticated human operator identity, ensuring that the audit trail attributes every API call to an individual.
* **Compensating Post-Incident Audit**: Once the session closes, the system must trigger an automated workflow to compare the active API logs against the expected actions declared in the request, flag any deviations, and run an immediate infrastructure drift check to ensure all manual modifications are codified in Git.

By implementing these structural controls, the organization ensures that emergency access is never treated as a convenient shortcut for routine operations, and that manual overrides remain completely transparent and auditable.

## Forensic Audit Trails and Incident Investigation

When an identity perimeter is breached or an emergency break-glass session is activated, the cloud provider's central auditing service (such as AWS CloudTrail or Google Cloud Audit Logs) becomes the primary source of forensic evidence. Audit logging must be configured globally, protected against modification, and forwarded to an isolated, read-only security account to prevent attackers from deleting the logs to cover their tracks.

Investigating a cloud security incident requires a systematic forensic analysis of these log files. Let us analyze a detailed case study of a real security investigation following a privileged identity breach, illustrating how to trace an attacker's actions step-by-step through the logs.

The security operations team receives a high-severity alert indicating that an unknown IP address is making unauthorized API calls to modify security group rules. The team immediately queries the centralized log repository to identify the compromised principal.

They find the initial, suspicious API event in the logs:

```json
{
  "eventTime": "2026-05-23T20:12:04Z",
  "eventSource": "iam.amazonaws.com",
  "eventName": "CreateAccessKey",
  "sourceIPAddress": "198.51.100.42",
  "userAgent": "aws-cli/2.15.0 Python/3.11.6",
  "userIdentity": {
    "type": "AssumedRole",
    "arn": "arn:aws:sts::111122223333:assumed-role/orders-api-prod-runtime/orders-api-task-7d9f"
  },
  "requestParameters": {
    "userName": "backup-operator"
  },
  "responseElements": {
    "accessKey": {
      "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
      "status": "Active"
    }
  }
}
```

This log record provides the first critical clue. The `eventName` is `CreateAccessKey`, indicating a new permanent credential was generated. The `userIdentity.arn` shows that the action was performed by the `orders-api-prod-runtime` role. 

This is a major architectural red flag: an application runtime task should never need to create IAM access keys. The finding indicates that an attacker has hijacked the serverless container's runtime role and is using its over-scoped wildcard permissions to establish persistence. The source IP address (`198.51.100.42`) does not match the corporate IP range or the container's private NAT gateway.

The team continues their search, querying the logs for any subsequent activity associated with the newly created access key ID (`AKIAIOSFODNN7EXAMPLE`). They find a second event occurring two minutes later:

```json
{
  "eventTime": "2026-05-23T20:14:12Z",
  "eventSource": "ec2.amazonaws.com",
  "eventName": "AuthorizeSecurityGroupIngress",
  "sourceIPAddress": "198.51.100.42",
  "userIdentity": {
    "type": "IAMUser",
    "arn": "arn:aws:iam::111122223333:user/backup-operator",
    "accessKeyId": "AKIAIOSFODNN7EXAMPLE"
  },
  "requestParameters": {
    "groupId": "sg-0db9f1828a2a1c0d",
    "ipPermissions": {
      "items": [
        {
          "ipProtocol": "tcp",
          "fromPort": 5432,
          "toPort": 5432,
          "ipRanges": {
            "items": [
              {
                "cidrIp": "0.0.0.0/0"
              }
            ]
          }
        }
      ]
    }
  }
}
```

This second log confirms the attacker's intent. Using the newly created static access key, they called `AuthorizeSecurityGroupIngress` to open port 5432 (PostgreSQL) on the database security group (`sg-0db9f1828a2a1c0d`) to the entire public internet (`0.0.0.0/0`).

Armed with this undeniable log evidence, the security team executes their response playbook. They immediately revoke the active temporary sessions for the `orders-api-prod-runtime` role, delete the attacker's static access key (`AKIAIOSFODNN7EXAMPLE`), revert the unauthorized database security group modification using Terraform, and narrow down the runtime role's IAM policy to remove all wildcard permissions. 

This forensic case study illustrates that without detailed, immutable audit logging, the compromise would have remained completely invisible, allowing the attacker to persist inside the cloud environment indefinitely.

## Putting It All Together

Securing cloud identity requires a comprehensive transition from static, over-scoped permissions to highly restricted, dynamic access paths. By treating identity as the primary security perimeter, writing granular resource-constrained policies, adopting OIDC role exchange, and enforcing strict JIT break-glass controls, we eliminate credential exposure risk while maintaining operational velocity.

When auditing and hardening your cloud access control configurations, ensure you enforce these five core practices:

First, audit all active IAM roles to eliminate wildcard permissions. Inspect your policy statements regularly, replacing broad actions (`s3:*`) and unrestricted resources (`*`) with targeted operations and specific resource ARNs.

Second, remove all static, long-lived access keys from your CI/CD pipelines. Integrate OpenID Connect (OIDC) federated role assuming to issue short-lived, temporary session credentials dynamically for every pipeline run.

Third, restrict human administrative privileges in production. Route standard infrastructure and application changes through automated repositories, ensuring that developers do not carry standing administrative access on their personal accounts.

Fourth, implement a dedicated Just-in-Time (JIT) break-glass access system for production emergencies. Enforce automatic session expiration, require multi-party peer approvals, and bind every emergency request to an active incident ticket.

Fifth, protect and analyze your cloud provider's central audit logs. Forward all audit trails to an isolated, read-only security account, and monitor active sessions to quickly detect and isolate anomalous API patterns.

## What's Next

Securing cloud identity, static IaC scanning, OPA policy engines, and drift perimeters establishes a highly robust infrastructure security foundation. However, as organizations scale their compute workloads, they must manage these resources within structured container orchestrators. In the next submodule, **Kubernetes Security**, we will focus on the orchestrator tier, beginning with **Kubernetes Access and RBAC** to explore how to secure API server connections, configure service accounts, and write least-privilege role bindings.

---

**References**

- [AWS IAM JSON Policy Elements Reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html) - Official guide detailing the evaluation and syntax of AWS IAM policies.
- [GitHub Actions Security Hardening with OpenID Connect](https://docs.github.com/en/actions/security-hardening-your-workflows/about-security-hardening-with-openid-connect) - Documentation on federating pipeline runner identities with cloud providers.
- [NIST SP 800-207 Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final) - Standards recommending continuous credential verification, least-privilege scoping, and dynamic session management.
- [AWS CloudTrail Forensic Log Auditing Guide](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - Best practices for analyzing event trails and investigating credential misuse.
- [OWASP Top 10 Security Logging and Monitoring Failures](https://owasp.org/Top10/A09_2021-Security_Logging_and_Monitoring_Failures/) - Analysis of common audit logging gaps and how to design resilient forensic evidence repositories.
