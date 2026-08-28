---
title: "Pipeline Permissions and Token Boundaries"
description: "Learn how CI/CD tokens delegate authority and how job, repository, package, environment, OIDC, and cloud-role boundaries keep that authority narrow."
overview: "Build a pipeline as a sequence of authority transitions. Start with one small job token, separate authentication from authorization, measure capability, resource, identity, audience, environment, and lifetime, then isolate pull-request, build, publish, sign, and deploy identities. Finish by verifying effective permissions, denied operations, trust relationships, and the total authority of each job."
tags: ["devsecops", "pipeline-security", "permissions", "oidc"]
order: 2
id: article-devsecops-pipeline-and-runner-security-permissions-token-boundaries
---

## Table of Contents

1. [Why Is a Pipeline Token Delegated Authority?](#why-is-a-pipeline-token-delegated-authority)
2. [How Do You Measure and Minimize a Job's Authority?](#how-do-you-measure-and-minimize-a-jobs-authority)
3. [Why Must Pull Requests, Builds, and Write Jobs Be Separated?](#why-must-pull-requests-builds-and-write-jobs-be-separated)
4. [How Do Publishing and Signing Get Their Own Boundaries?](#how-do-publishing-and-signing-get-their-own-boundaries)
5. [How Does OIDC Create a Temporary Cloud Identity?](#how-does-oidc-create-a-temporary-cloud-identity)
6. [How Do Environments and Reusable Workflows Affect Trust?](#how-do-environments-and-reusable-workflows-affect-trust)
7. [How Do You Verify Effective Permissions and Token Use?](#how-do-you-verify-effective-permissions-and-token-use)
8. [What Does a Least-Authority Delivery Pipeline Look Like?](#what-does-a-least-authority-delivery-pipeline-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Start with a tiny job:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
```

The job appears to read source, install dependencies, and run tests. Behind that recipe, the CI platform creates an identity context and usually supplies a job token. The token may let automation read repository content, upload results, write pull-request comments, publish packages, or modify releases depending on configuration.

A token is **delegated authority**. The platform is saying, “For this bounded execution, treat whoever presents this credential as job J from repository R under these permissions.” Anyone or any code able to use the token can exercise the granted actions until it expires or is revoked.

Authentication and authorization are different. Authentication establishes which identity is presenting the token. Authorization determines what that identity may do. A valid CI token can authenticate successfully and still be denied package publishing because its policy lacks that action.

Keep these questions in view as you work through the lesson:

1. **Why Is a Pipeline Token Delegated Authority?**
2. **How Do You Measure and Minimize a Job's Authority?**
3. **Why Must Pull Requests, Builds, and Write Jobs Be Separated?**
4. **How Do Publishing and Signing Get Their Own Boundaries?**
5. **How Does OIDC Create a Temporary Cloud Identity?**
6. **How Do Environments and Reusable Workflows Affect Trust?**
7. **How Do You Verify Effective Permissions and Token Use?**
8. **What Does a Least-Authority Delivery Pipeline Look Like?**

## Why Is a Pipeline Token Delegated Authority?
<!-- section-summary: A pipeline token lets one automated job act as a platform or cloud identity, so its presence represents specific delegated power rather than mere configuration data. -->

```text
token proves job identity -> authentication
policy permits one action -> authorization
```

This distinction matters during troubleshooting. A `403` does not necessarily mean the token is invalid. It can be useful evidence that the intended permission boundary worked.

Authority has several dimensions:

- **Capability:** read source, comment, publish, sign, deploy, change infrastructure.
- **Resource scope:** one repository, one package, one service, one cloud project.
- **Identity scope:** which repository, workflow, branch, actor, or environment can receive it.
- **Audience:** which service should accept the token.
- **Lifetime:** how long the authority remains valid.
- **Context:** which event and trust state caused issuance.

A token with one small action for one package during a ten-minute job is materially different from a permanent administrator key accepted by many services.

The dangerous default is **ambient authority**: permission that is available merely because code runs in the job. If every workflow starts with a broad repository token and permanent cloud secret, then a formatting step, package installer, test script, or compromised third-party action inherits more power than its task requires.

Code execution plus token access equals token authority. A malicious dependency does not need to “steal” a token and use it later. It can invoke the package API or deployment command while the legitimate job runs. Masking the value in logs reduces accidental disclosure but does not isolate it from executed code.

The first design rule follows directly:

```text
Give each job only the authority required for its current task,
only after the input has reached the necessary trust level.
```

Privilege should not precede trust. Unreviewed code should not begin with production deployment authority merely because the same workflow eventually deploys an approved release.

Platform-issued tokens improve several properties over one shared static token. Issuance occurs for a specific run, the platform can bind the credential to a job, expiry follows the job lifetime, and audit records can attribute use to repository and workflow context. They also reduce manual key distribution. Those benefits do not automatically make the token least-privileged. Defaults, organization settings, event types, and explicit workflow permissions still determine what it can do.

The event that starts the job is part of the trust context. A scheduled workflow on a protected branch, a release tag, a manual dispatch, a same-repository pull request, and a fork pull request do not represent the same level of review. Token and secret availability should follow those differences. Treat reruns, privileged approval of fork jobs, and workflow events that execute target-branch code with special care because they can change which revision runs beside which authority.

Authority can cross process boundaries inside one job. A package manager executes install hooks, a build tool launches plugins, and a test runner loads repository code. Any of them may inherit environment variables, filesystem credentials, network reach, or command-line tokens. Reviewing only the visible deployment script misses earlier code that can act while the credential exists.

## How Do You Measure and Minimize a Job's Authority?
<!-- section-summary: Effective authority is the union of platform-token permissions, secrets, federated roles, runner identity, network reach, inherited workflow access, and callable services. -->

Default permissions should be small. If a job only checks out code, its repository token normally needs content read access and nothing more. Job-level configuration should make the requirement visible:

```yaml
permissions:
  contents: read
```

A later job that reports a result may need a different narrow grant. Do not give the entire workflow the union of every later permission when separate jobs can express separate boundaries.

Think in capability, space, and time. For a package publishing job:

```text
capability: publish package
space: ParcelPulse package namespace only
time: this approved release job
identity: protected release workflow
audience: package registry
```

The same short-lived token with broad repository administration is still dangerous. The same narrow package permission in a five-year credential creates a theft window. Each dimension contributes to the boundary.

Platform settings and workflow YAML are not the whole authority set. A job may also receive:

- Repository, organization, or environment secrets.
- OIDC permission to request an identity assertion.
- A cloud role obtained from that assertion.
- Runner-attached instance credentials.
- Network access to internal services.
- Credentials generated by a previous step.
- Reusable-workflow secrets and permissions.
- Artifacts or caches containing sensitive data.

The true model is:

```text
job authority = platform token
              + explicit secrets
              + federated roles
              + runner identity
              + network-reachable authority
              + delegated workflow authority
```

This is why an apparently read-only job can be powerful. Its declared token may read only source, while the self-hosted runner has a cloud instance profile, access to an internal deployment API, a writable shared workspace, and a Docker socket. Review effective capability, not only the most visible token block.

Job-level permissions reduce blast radius and make review easier. A test job can declare read-only access. A reporting job can write checks. A publishing job can write one package. A deploy job can request an environment-specific identity. Each job becomes a small trust boundary with an explainable purpose.

Unused permissions should be removed. Audit logs and job behavior can reveal that a grant is never exercised. Before deleting it, confirm it is not a rare recovery or release operation; then narrow the policy and verify that required paths still work.

Negative permissions deserve tests. A read job should fail when it attempts a repository write. A staging deploy identity should fail against production. A package publisher should fail against another namespace. These denials demonstrate the boundary more directly than configuration review alone.

Start design from the smallest operation, not from a convenient administrator role. List the exact API calls a successful job makes. Map each call to its resource and environment. Grant that set, run the job, and investigate denials individually. If a new capability is required, add it at the narrowest job rather than broadening the workflow default.

Separate the job identity from the runner identity conceptually. The platform job token describes the workflow execution. The machine may also have an operating-system account, cloud instance profile, Kubernetes service account, local credential helper, or network position. Removing a workflow permission does not remove machine-level authority. A sound review places both identities in the same matrix and eliminates runner-attached power where the job should obtain temporary authority explicitly.

Audience boundaries are easy to overlook. A token accepted by several services can be replayed beyond its intended use even when its repository claims are narrow. External services should validate the issuer, audience, time, and relevant subject claims. A token intended for cloud federation should not automatically authenticate to a package service, and a package token should not act as a general repository credential.

## Why Must Pull Requests, Builds, and Write Jobs Be Separated?
<!-- section-summary: Unreviewed pull-request code should remain read-heavy, while publishing and deployment authority appears only in later jobs that consume identified, approved outputs. -->

Pipelines form a possible privilege-escalation ladder:

```text
proposed source
      |
      v
test and analysis
      |
      v
trusted branch build
      |
      v
publish or sign artifact
      |
      v
deploy environment
```

Each transition should increase authority only after relevant evidence exists.

Pull requests are special because their code is proposed rather than trusted. The job executes repository-controlled scripts, build hooks, package install logic, tests, and workflow-dependent tools. A contributor can change some of that code in the same proposal. If the job also holds a write token or production secret, the proposal can turn code execution into platform or cloud authority.

External forks make the boundary obvious, but internal pull requests are not automatically safe. Employee accounts can be compromised, malicious insiders exist, and dependencies or generated code can be altered. Repository membership is not the same as production deployment authorization.

A pull-request job should usually be read-heavy:

```text
read source
install inside an isolated environment
run tests and scanners
produce non-authoritative reports
```

Avoid source writes, package publication, release changes, cloud deployment, or long-lived secrets. If a result must be posted, isolate that action so the code under test cannot freely reuse the reporting authority.

Separate testing from deployment. The test job consumes proposed code and produces evidence. The deployment job should not rerun arbitrary scripts from the proposal under production authority. It should consume a trusted, identified artifact or release record after protected review and environment authorization.

```text
low-trust test job
  input: proposed revision
  authority: read and test

high-trust deploy job
  input: approved artifact digest
  authority: one environment deployment
```

The boundary is architectural rather than cosmetic. Moving a secret to the last step of one job does not necessarily prevent earlier code in that process from reading the environment, filesystem, process state, or generated command. Separate jobs and runners make authority appear in a different execution context.

Read jobs and write jobs should feel different to reviewers. A change that adds `issues: write`, `packages: write`, `id-token: write`, or deployment access deserves scrutiny because it expands the job's effect. The workflow should make those expansions local and obvious.

Platform behavior around pull requests from forks, same-repository branches, bots, and privileged reruns can differ. Review every event path. A maintainer rerun with secrets or a target-branch context that executes code from the proposal can make an otherwise safe fork workflow dangerous.

One useful pattern is to make untrusted jobs produce data, not authority-bearing side effects. They can emit test logs, coverage files, scan reports, and an artifact that is treated as untrusted input. A later trusted job may parse or display that data only through a safe interface. It should not execute a script copied from the untrusted artifact under a write token.

Artifact handoff does not automatically cleanse trust. A binary or archive built from proposed code remains attacker-controlled until the policy decides otherwise. Do not feed it to a privileged installer merely because it crossed a job boundary. The later job should perform only the bounded transition intended by policy, and promotion should normally begin from reviewed source and a controlled build.

Pull-request comments illustrate capability separation. The analysis job can write a report file without token write access. A small reporting job can consume sanitized structured output and post one check result. That reduces the amount of proposed code running beside `checks: write` or `pull-requests: write`.

## How Do Publishing and Signing Get Their Own Boundaries?
<!-- section-summary: Building, publishing, signing, and source modification are distinct powers that should use separate identities and exact artifact subjects. -->

Building a package and publishing a package answer different questions. The build job needs source and dependencies. The publishing job needs permission to create or update one package namespace. Combining them gives every build script registry-write authority.

Use a boundary:

```text
trusted build -> artifact digest and evidence
                     |
                     v
approved publish job -> one package namespace
```

Scope authority to the package. A job that publishes `parcelpulse-api` should not modify every organization package. Package write should not imply repository source write, branch administration, or release approval.

Publishing credentials should not reach earlier stages. A malicious test or dependency can invoke the registry API during its execution even if the official publish command appears later. Pass only the identified build output into a separate job whose steps are intentionally small.

Token lifetime is another boundary. Platform-issued job tokens normally expire with the job and improve attribution because audit records can name the workflow execution. That is preferable to a shared personal token stored indefinitely. Short life does not compensate for broad permission, however; a ten-minute organization administrator token can cause serious damage immediately.

Signing may deserve a separate identity from publishing. Publication controls who can place an object in a registry. Signing controls who can make a trust claim about that object. If one compromised job can build arbitrary bytes, publish them, and sign them as trusted, the controls collapse into one authority.

Bind each operation to the artifact digest. A publisher should promote the build output already tested. A signer should sign the intended digest, not a mutable tag. A deployment should consume the same subject. Rebuilding during publish or signing breaks the evidence chain.

The same reasoning applies to source releases. A release-creation token should not necessarily push arbitrary commits. A changelog job does not need package administration. Separate capability boundaries prevent one compromised extension from reaching every supply-chain surface.

Publishing should verify inputs before using its authority. Check the artifact digest, expected repository and release metadata, provenance or build record, target package name, and version. Reject a request to publish a different namespace or mutable unverified object. The job can remain deliberately boring: verify, authenticate, upload the identified object, and record the registry result.

Signing policy should decide which evidence is required before the signing identity acts. The signing step should not accept an arbitrary digest supplied by any workflow. Bind authorization to the trusted builder, source revision, repository, and release context defined by the policy. A valid signature only proves that the signing key or identity made a claim; the policy determines whether that claim is meaningful.

If one system must perform several operations, use separately obtained credentials even when the runner remains the same. Do not expose signing authority during compilation or package write authority during tests. The code that can access each token should be as small and reviewable as the platform allows.


_The artifact moves forward by immutable identity while each job receives only the authority needed for its single transition._

Enforce that boundary outside the script wherever possible. Repository settings, protected environments, cloud trust policies, registry roles, and separate job identities should prevent one step from silently inheriting another step's authority even when proposed workflow code is malicious.

## How Does OIDC Create a Temporary Cloud Identity?
<!-- section-summary: OIDC lets a CI workload present signed context to a cloud trust policy and receive a temporary role whose permission policy remains separately narrow. -->

Traditional cloud automation often stores a permanent access key in CI. The key exists when no deployment is occurring, must be rotated, and can be copied from its storage boundary. Workload identity federation replaces that standing credential with a contextual exchange.

```text
approved job starts
      |
      v
CI platform issues signed OIDC assertion
      |
      v
cloud validates issuer, audience, and claims
      |
      v
cloud trust policy admits this workload
      |
      v
temporary role credentials
      |
      v
bounded deployment action, then expiry
```

An OIDC token is an assertion about the workload, not magical permission. It can state repository, branch or ref, workflow, actor, and environment context. The cloud decides whether those claims may become a role.

Two policies answer different questions:

- The **trust policy** says which external workload may assume the role.
- The **permission policy** says what the resulting role may do.

Narrow trust with broad permissions is still dangerous. A production workflow may be the only caller, but an administrator role lets a compromise affect unrelated services. Broad trust with narrow permissions can still let an unintended repository alter the protected service. Both sides need review.

The token's **audience** limits which recipient should accept it. Validate the expected audience so an assertion intended for one service cannot be replayed to another. Validate the issuer and signature, then match precise workload claims.

Trust conditions might require the ParcelPulse organization and repository, protected release workflow, main branch or signed tag, and production environment. A feature branch, fork, unrelated repository, or staging workflow should not satisfy them.

```text
trust: exact repository + approved workflow + prod environment
permission: deploy parcelpulse production service only
lifetime: short role session
```

Environment should be part of identity. Staging and production can use separate roles, resources, and trust conditions. Compromise of a staging workflow then does not automatically provide a path to production.

Environment approval can join the authorization path. The job reaches the protected environment, required reviewers authorize it, the platform exposes environment-scoped identity context, and only then does the trust policy admit the production role. A name such as `environment: production` is not enough if anybody can create or select that name; protect who configures the environment and its reviewers.

Protect whatever defines identity claims. Workflow files, repository settings, environments, reusable workflows, and branch protections can influence which claims appear. If an attacker can modify the authorized workflow without review, they can run arbitrary commands while the legitimate identity holds its temporary role.

OIDC reduces stored-secret risk, not the need for incident response. Audit every role session, record the workload claims, and alert on unexpected repositories, branches, workflows, audiences, resources, or session times. If trust policy was overly broad, an attacker may use a perfectly valid temporary session. The issue is unauthorized admission, not token forgery.

Session duration should fit the operation. A deployment that normally takes five minutes does not need an eight-hour role session. Keep enough time for reliable completion but reduce the period in which compromised job code can act. Avoid automatic renewal paths that silently turn temporary access into near-permanent authority.

Trust rules should prefer exact, stable claims over broad string patterns. A wildcard matching every branch or repository is convenient but increases lateral movement. Review how pull requests, tags, reusable workflows, and environment claims are encoded by the platform so the policy matches the intended event rather than an easily reproduced label.


_Federation removes a permanent CI cloud key, but trust conditions and role permissions still determine the real authority._

## How Do Environments and Reusable Workflows Affect Trust?
<!-- section-summary: Environment controls, reusable workflows, cross-repository calls, and cross-project job tokens create delegation chains whose callers, claims, secrets, and resulting authority must be explicit. -->

An environment is a security boundary when it controls reviewers, secrets, deployment identity, and protection rules. Use distinct identities for development, staging, and production rather than one cloud role with conditional behavior hidden inside a script.

Environment-bound identities reduce lateral movement. A compromised staging token should reach staging resources only. The production role should require production context and, where policy demands it, a human or automated approval that staging cannot create.

Reusable workflows create delegation chains:

```text
calling repository
      |
      v
shared workflow definition
      |
      v
called jobs, secrets, permissions, and external roles
```

Review who can call the workflow, which ref identifies the shared code, what inputs affect execution, what permissions pass from caller to callee, which secrets are inherited, and which environment or cloud roles the callee can obtain. A centrally maintained workflow can improve consistency, but it also concentrates trust.

Cross-repository access deserves particular caution. A job token permitted to read another private repository or publish into another project creates a trust relationship between their workflows and owners. Scope both the source and destination. Ask whether any branch in the caller can use the relationship or only a protected workflow.

GitLab-style CI job tokens follow the same principle as GitHub platform tokens: the platform issues a job-bound identity and projects configure which operations and cross-project relationships it may use. An allowlist is still a trust grant. If project A may call project B under job identity, changes to A's pipeline can affect B within the permitted scope.

Avoid powerful personal tokens in automation. They couple a person's broad authority and employment lifecycle to a machine path, weaken attribution, and often remain valid outside jobs. A dedicated static service account is clearer, but it still creates standing authority and rotation work. Prefer platform-issued job tokens for platform actions and federation for external cloud roles where those mechanisms fit.

Do not keep a permanent cloud secret “as fallback” after adding OIDC. The old path preserves the original theft risk and may bypass the new trust conditions. A migration is complete when consumers use federation, the static key is revoked, and monitoring confirms no legitimate job still depends on it.

Repository membership alone should not grant deployment. Many contributors need to propose code without being authorized to assume a production role. Protected branches, environment reviewers, workflow ownership, and cloud trust policy form separate layers.

Reusable workflows should request only the permissions they need and document what callers must grant. The caller should not be able to increase the callee's external authority merely by supplying an input string. Validate environment and artifact identifiers, restrict secret inheritance, and pin the called workflow to an approved ref. Audit changes in the shared repository because one update can affect many consumers.

Cross-project job-token access should be reviewed from both sides. The caller owns code capable of presenting the token. The destination owns the resource that accepts it. An allowlist decision therefore delegates some destination authority to the caller's workflow governance. Remove relationships when repositories are archived, responsibilities move, or the integration is replaced.

If a static service account remains necessary, narrow it using the same dimensions: one purpose, one resource set, short or rotated credentials, restricted storage, and attributable use. Do not treat “service account” as proof of least privilege. It is simply a non-human identity whose lifecycle still needs ownership.

## How Do You Verify Effective Permissions and Token Use?
<!-- section-summary: Verification compares declared policy with successful and denied behavior, platform and cloud audit records, unused grants, and every trust relationship that can issue or accept authority. -->

Review intended permissions, then test effective permissions. For every job, inventory platform-token grants, secrets, OIDC access, federated roles, runner identities, network targets, reusable-workflow delegation, caches, and artifacts. This total authority set is what malicious code can attempt to use.

A useful matrix is:

| Job | Input trust | Platform token | External role | Environment | Expected writes |
|---|---|---|---|---|---|
| Pull-request test | Proposed code | Source read | None | None | Test artifacts only |
| Trusted build | Protected revision | Source read, artifact write | None | Build | Identified artifact |
| Package publish | Approved artifact | Package write | None | Release | One package namespace |
| Staging deploy | Approved artifact | Minimal read | Staging deploy role | Staging | One service |
| Production deploy | Approved artifact and gate | Minimal read | Production deploy role | Production | One service |

Test allowed actions and negative cases. A pull-request job should fail to write repository content or request the production role. A publisher should fail to update an unrelated package. A staging role should fail against production. The denied event is useful evidence that policy is enforced rather than merely documented.

Audit token use. Platform logs should identify workflow, job, repository, actor, operation, and time. Cloud records should name the federated role session and affected resources. Registry logs should show which job published which package version or digest. Correlation across those systems supports both review and incident response.

Review unused permissions. If ninety days of legitimate jobs never use `contents: write`, investigate and remove it. Review trust relationships too: obsolete repositories, renamed workflows, broad wildcard claims, retired environments, and cross-project allowlists can preserve access after the original use disappears.

Token masking is not isolation. Confirm that untrusted steps never receive the value or the surrounding authority in the first place. Inspect workflow debug output, artifacts, caches, and command arguments for accidental exposure, but do not assume redaction prevents in-process abuse.

Common design failures include:

- One broad token shared across the entire pipeline.
- One cloud role for every environment.
- OIDC trust that accepts every repository or branch.
- Write permission on pull-request jobs.
- A permanent secret retained beside federation.
- An environment name with no protected environment authorization.
- Personal tokens used for automation.
- Reusable workflows that inherit all secrets and permissions by default.

Review after platform changes because default token behavior can change. Make the required grants explicit and keep test cases that prove important denials.

Verification should cover failure paths. What happens if the package registry is unavailable, the OIDC exchange fails, the environment approval times out, or deployment partially succeeds? A fallback must not introduce a broader personal token or unrecorded manual path. The safe result is a failed transition with preserved evidence and a controlled recovery procedure.

Compare configured permissions with actual API events. An apparently unused permission may hide use through a third-party action, while a declared operation may be performed through runner-attached credentials instead of the intended job identity. Correlate platform, cloud, registry, and deployment logs around the same run ID and artifact digest.

Review who can change authorization as well as who can use it. Repository administrators, environment maintainers, cloud-policy editors, reusable-workflow owners, and runner administrators can each expand effective authority. Their changes should require appropriate review and produce audit evidence.

Denied actions are also useful detection signals. Repeated attempts by a test job to write releases or contact production can indicate a misconfigured script, compromised dependency, or probing. Do not automatically grant the missing permission to make the pipeline green; first decide whether the attempted action belongs to the job at all.

## What Does a Least-Authority Delivery Pipeline Look Like?
<!-- section-summary: A secure pipeline makes authority increase only after trust increases, derives short-lived identities from protected context, and never passes one job's power farther than necessary. -->

ParcelPulse can now model delivery as a sequence of authority transitions.

An unreviewed pull request enters a hosted or isolated test job. The platform token reads source and uploads ordinary test evidence. It has no package, source-write, environment, cloud, or production secret authority. Proposed code can fail the tests, but it cannot turn that code execution into a release.

After protected merge, a trusted build job creates one artifact, records its digest, and produces tests and provenance. It still has no production role. A separate publishing job consumes that identified output and can write only the ParcelPulse package or image namespace.

If signing policy requires an independent identity, a signing job evaluates the approved digest and makes the trust claim without rebuilding it. Staging deployment uses a staging-specific OIDC trust relationship and role. Production deployment waits for its environment gate, requests a production assertion, receives a short role session, and updates only the ParcelPulse production service with the already identified artifact.

```text
proposed code
   |
   v
read-only test job
   |
   v
protected revision
   |
   v
build once -> digest + evidence
   |
   +---------> package publisher
   |
   +---------> signer
   |
   v
staging identity -> staging
   |
   v
production gate
   |
   v
production identity -> one production service
```


_The pipeline does not carry one credential forward; each protected transition obtains a new authority derived from its current context._

Three principles organize the design.

First, privilege should not precede trust. Proposed code receives read-heavy analysis authority. Publication and deployment appear only after review, identified artifacts, and environment policy.

Second, derive tokens from context where possible. Platform job tokens and OIDC role sessions bind authority to repository, workflow, environment, audience, and time instead of storing a permanent shared secret.

Third, do not pass authority farther than necessary. Build authority differs from publish authority. Publish authority differs from signing authority. Staging differs from production. One service differs from an entire cloud account.

A practical review asks:

1. Which code can execute in each job?
2. What exact platform and external authority can it use?
3. Which resources, environments, and audiences accept that identity?
4. How long does it remain valid?
5. Who can modify the workflow, environment, trust policy, or reusable dependency?
6. Which negative operations prove the boundary?
7. Which logs connect token use to the job and resulting change?
8. Which permissions or trust relationships are no longer needed?

The deepest rule is simple: a token should carry no more authority than the current job requires and should not survive or travel beyond that job's trust boundary.

The design also improves incident containment. If a dependency compromises the pull-request job, responders know it had no environment token, package write, or cloud role. If a publisher is compromised, its reach is one namespace and one short run rather than source administration and production. If the production deployment job is compromised, audit records identify the exact role session and service changes. Narrow boundaries turn “CI was compromised” from an unbounded statement into a traceable set of possible actions.

Review the pipeline as a graph rather than a list of YAML steps. Nodes are jobs and identities. Edges pass source, artifacts, claims, secrets, or approval. Mark where trust increases and where authority increases. Any edge that carries high authority backward into a lower-trust node, or carries unverified code forward into a privileged executor, deserves redesign.

## Check Your Answers

:::expand[Why Is a Pipeline Token Delegated Authority?]{kind="recap"}
A token lets job code act as an identity, so its capabilities, scope, audience, context, and lifetime are executable power.
:::

:::expand[How Do You Measure and Minimize a Job's Authority?]{kind="recap"}
Count platform permissions, secrets, federated roles, runner identity, network reach, and delegated workflows, then remove everything outside the job's task.
:::

:::expand[Why Must Pull Requests, Builds, and Write Jobs Be Separated?]{kind="recap"}
Keep proposed code on a read-heavy path and introduce write or deployment authority only in separate jobs after trust has increased.
:::

:::expand[How Do Publishing and Signing Get Their Own Boundaries?]{kind="recap"}
Use distinct, narrowly scoped identities for building, publishing, signing, and source changes, all bound to the same artifact digest.
:::

:::expand[How Does OIDC Create a Temporary Cloud Identity?]{kind="recap"}
The CI assertion proves workload context; cloud trust policy decides who may become the role, and permission policy limits what that role can do.
:::

:::expand[How Do Environments and Reusable Workflows Affect Trust?]{kind="recap"}
Protect environment authorization and audit every caller, ref, input, inherited secret, permission, and cross-repository relationship in delegation chains.
:::

:::expand[How Do You Verify Effective Permissions and Token Use?]{kind="recap"}
Inventory total authority, test expected denials, correlate audit records, remove unused grants, and review trust relationships as well as permissions.
:::

:::expand[What Does a Least-Authority Delivery Pipeline Look Like?]{kind="recap"}
Increase authority only after trust increases, derive short-lived identities from protected context, and never pass power beyond the task that needs it.
:::

## References

- [GitHub Actions workflow permissions](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#permissions) - Documents default and explicit `GITHUB_TOKEN` scopes.
- [GitHub automatic token authentication](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication) - Describes job token use and permission modification.
- [GitHub OIDC security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect) - Explains CI workload federation and claims.
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/deployments-and-environments) - Documents reviewers, secrets, and environment protection rules.
- [GitHub reusable workflow security](https://docs.github.com/en/actions/sharing-automations/reusing-workflows) - Documents caller, permissions, and secret behavior.
- [GitLab CI job tokens](https://docs.gitlab.com/ci/jobs/ci_job_token/) - Describes job-bound tokens and cross-project allowlists.
