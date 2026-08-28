---
title: "Authentication and Credentials"
description: "Learn how Terraform obtains identities for providers and backends without putting long-lived secrets in configuration."
overview: "Terraform Core plans infrastructure, but provider and backend APIs still need an authenticated identity. This article separates identity, credentials, authentication, and authorization; then applies that model to local development, CI with OIDC, modules, environment separation, and deployment evidence."
tags: ["terraform", "authentication", "credentials", "oidc", "least-privilege"]
order: 1
id: article-iac-terraform-foundations-authentication
aliases:
  - infrastructure-as-code/terraform/foundations/authentication-and-credentials.md
---

## Table of Contents

1. [Why Does a Terraform Run Need an Identity?](#why-does-a-terraform-run-need-an-identity)
2. [Why Should Credentials Stay Outside Configuration?](#why-should-credentials-stay-outside-configuration)
3. [How Does Local Authentication Reach a Provider?](#how-does-local-authentication-reach-a-provider)
4. [Why Is Backend Authentication a Separate Concern?](#why-is-backend-authentication-a-separate-concern)
5. [How Does OIDC Authenticate a CI Job?](#how-does-oidc-authenticate-a-ci-job)
6. [How Do Least Privilege and Environment Separation Work?](#how-do-least-privilege-and-environment-separation-work)
7. [What Should Modules Know About Credentials?](#what-should-modules-know-about-credentials)
8. [What Evidence Makes an Authenticated Run Trustworthy?](#what-evidence-makes-an-authenticated-run-trustworthy)
9. [Check Your Answers](#check-your-answers)

Terraform Core builds a dependency graph, reads and writes state, calculates a plan, and asks provider plugins to perform operations. The providers are the components that call cloud or SaaS APIs. Those APIs do not accept “Terraform” as sufficient authority; every call must arrive through an identity the platform recognizes and permits.

Consider a resource:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = "myapp-prod-logs"
}
```

Terraform Core can parse the block and decide that the plan needs to create a bucket. The AWS provider turns that decision into an S3 API request. AWS then needs answers to two questions:

```text
Who is making this request?
Is that identity allowed to create this bucket?
```

An **identity** is the principal the platform recognizes, such as an IAM role session. A **credential** is evidence used to establish that identity: for example, temporary access keys and a session token. **Authentication** verifies who the caller is. **Authorization** evaluates whether that authenticated caller may perform the requested action on the requested resource.

Keep these questions in view as you work through the lesson:

1. **Why Does a Terraform Run Need an Identity?**
2. **Why Should Credentials Stay Outside Configuration?**
3. **How Does Local Authentication Reach a Provider?**
4. **Why Is Backend Authentication a Separate Concern?**
5. **How Does OIDC Authenticate a CI Job?**
6. **How Do Least Privilege and Environment Separation Work?**
7. **What Should Modules Know About Credentials?**
8. **What Evidence Makes an Authenticated Run Trustworthy?**

## Why Does a Terraform Run Need an Identity?
<!-- section-summary: Provider APIs need an authenticated caller, and authorization decides which requested infrastructure operations that caller may perform. -->

These terms are related but not interchangeable:

```text
credential
    proves or helps obtain an identity

authentication
    validates that proof

identity
    names the resulting principal

authorization
    allows or denies a particular operation
```

An AWS role ARN such as `arn:aws:iam::123456789012:role/terraform-prod` names a role, but a running process normally uses a temporary role session with time-limited credentials. A successful login proves the caller; policy then decides whether that caller can create S3 buckets, update a network, or read state.

Terraform configuration answers “what infrastructure is desired?” It does not, by itself, answer “who is requesting it?” The execution environment supplies that identity. On a developer workstation, the environment may begin with an organizational login. In CI, it may begin with a workload identity token. In both cases, the provider discovers credentials and uses them for remote calls.

The identity should be visible in operational evidence. A production apply performed through a named deployment role is easier to audit than one performed through an individual's permanent administrator key. Cloud audit logs can connect the role session, repository workflow, commit, approval, and API operations.

Authentication and authorization can fail independently. Valid credentials can authenticate a role whose policy does not permit `s3:CreateBucket`. Conversely, an intended policy is useless if the process cannot authenticate as the role. Diagnosing provider errors starts by asking which stage failed rather than calling every access problem “bad credentials.”

## Why Should Credentials Stay Outside Configuration?
<!-- section-summary: Infrastructure configuration and secret material have different sharing, rotation, and exposure lifecycles. -->

It is technically possible to place credentials in some provider blocks:

```hcl
provider "aws" {
  region     = "eu-west-2"
  access_key = "..."
  secret_key = "..."
}
```

That design is dangerous. Terraform files are reviewed, copied, cached, committed, rendered in logs, passed through automation, and often shared across a team. Credentials rotate on a different schedule, require narrower access, and should expire or be revoked independently. Putting both in the same file couples two lifecycles that should remain separate.

```text
configuration
    durable, reviewable, reproducible, broadly shared

credentials
    confidential, revocable, short-lived where possible, narrowly distributed
```

A provider block can describe non-secret connection settings without storing authentication material:

```hcl
provider "aws" {
  region = "eu-west-2"
}
```

The AWS provider can then use its supported credential-discovery chain. This keeps the same configuration usable by a developer profile, an OIDC-assumed CI role, or another approved execution identity.

There are three different kinds of values people often call “Terraform secrets,” and they should be separated:

1. **Provider credentials** authenticate API calls made by providers.
2. **Terraform input values** may configure resources with sensitive application data.
3. **Backend credentials** authenticate access to remote state.

Marking an input variable `sensitive = true` reduces routine display, but it does not turn the value into a provider credential system or guarantee that the value is absent from state. It is a presentation control. Likewise, moving an access key into a variable does not solve the underlying design if the value still passes through Terraform configuration and artifacts.

Environment variables are a delivery mechanism, not a security property. A long-lived key in an environment variable is still a long-lived key. It can leak through process inspection, shell history, debug output, or a misconfigured CI step. The stronger improvement is to change the credential's source and lifetime: use an organizational session, instance or workload identity, or OIDC exchange that produces short-lived credentials.

Credentials should generally belong to the execution environment because that environment knows who or what is running. Code should declare provider requirements and safe connection settings. The surrounding workstation, runner, or managed execution service should establish the authenticated session.

This direction of flow is safer:

```text
trusted identity system
        |
        v
temporary execution credentials
        |
        v
Terraform provider or backend
        |
        v
remote API
```

It avoids asking reusable Terraform code to create or store the very authority it needs in order to begin operating.

## How Does Local Authentication Reach a Provider?
<!-- section-summary: A developer authenticates through normal organizational tooling, and the provider discovers the selected session from the execution environment. -->

Local development contains a human who can complete an interactive login. A typical flow is:

```text
developer authenticates with the organization
        |
        v
CLI or credential helper stores a session
        |
        v
developer selects an approved profile or context
        |
        v
Terraform provider discovers temporary credentials
```

For AWS, the shell might select a profile after the developer signs in:

```bash
export AWS_PROFILE=development
terraform plan
```

The provider block can remain environment-independent:

```hcl
provider "aws" {
  region = "eu-west-2"
}
```

The profile name tells the AWS credential chain which local session to use. The Terraform code does not need to know the access key, secret key, or session token. When the organizational session expires, the developer authenticates again instead of distributing a permanent Terraform-specific secret.

This model also improves offboarding and rotation. Identity administrators can revoke the person's access or role membership centrally. The repository does not need a credential-editing commit, and every developer does not own a separately copied production key.

Provider discovery can draw from supported profiles, environment variables, workload roles, shared configuration, and other documented mechanisms. The exact chain is provider-specific, so teams should standardize one supported local path and document how to verify it. A flexible discovery chain is useful, but invisible fallback can also make a run use an unintended identity.

Before planning, verify the active caller using the platform's identity command. For AWS:

```bash
aws sts get-caller-identity
```

The output reveals the account and principal actually represented by the current credentials. That is stronger evidence than a profile name because a profile is only local configuration; its resulting role and account are what determine authority.

An environment variable such as `AWS_PROFILE=development` is therefore a selector, not a guarantee of safety. The selected profile must resolve to the expected account and role. Shell prompts, directory tools, or wrappers can reduce mistakes, but a CI or policy guard that checks the real identity is stronger.

Local credentials should be less privileged than production automation when practical. Developers may need read access and permission to plan against development, while production writes remain limited to an approved deployment role. A local plan should not require every engineer to carry a permanent secret capable of changing production.

## Why Is Backend Authentication a Separate Concern?
<!-- section-summary: Terraform initializes and authenticates its backend before providers manage application resources, so state access has its own identity and privilege model. -->

A remote backend may look like this:

```hcl
terraform {
  backend "s3" {
    bucket = "company-terraform-state"
    key    = "prod/app.tfstate"
    region = "eu-west-2"
  }
}

provider "aws" {
  region = "eu-west-2"
}
```

The backend and provider both use AWS in this example, but they serve different purposes. Backend initialization needs permission to locate, read, write, and lock state. Provider operations need permission to manage the application infrastructure. Those phases may happen to use the same credential source, but the security questions are distinct.

Backend authentication happens early. `terraform init` must configure the backend and obtain state before Terraform can produce a meaningful plan for the managed resources. Terraform therefore cannot depend on an application resource it is about to create in order to obtain its initial backend access.

This creates a bootstrap requirement. The state bucket, locking mechanism, trust relationship, and baseline execution identities often need to exist before the application stack can run. Organizations manage that bootstrap layer through a separately controlled root configuration, platform process, or one-time administrative setup.

State access is privileged because state can reveal resource identifiers, relationships, outputs, and sometimes sensitive values. A role that cannot modify production resources but can freely download production state may still gain confidential information. Conversely, a role with provider permissions but no backend access cannot safely participate in the normal Terraform workflow.

Separate the permissions conceptually:

```text
backend authority
    read selected state
    acquire and release its lock
    write the updated state

provider authority
    read and change the selected infrastructure resources
```

The scopes can be granted to one deployment role, but both must be reviewed. A plan-only role might read state and remote resources without holding all write permissions. The approved apply role can have the additional operations necessary for the reviewed stack.

Backend configuration should avoid embedded secrets just as provider configuration does. Use supported credential discovery or a managed execution identity. Partial backend configuration can keep environment-specific addresses outside reusable code while the pipeline supplies non-secret backend parameters during initialization.

The bootstrap identity is special because it establishes the trust path used by later automation. It should be narrowly controlled, documented, and changed deliberately. Terraform authentication works best when authority flows down from an existing trust system rather than being assembled from secrets inside the configuration that needs the authority.

## How Does OIDC Authenticate a CI Job?
<!-- section-summary: OIDC lets a workflow exchange a signed, scoped identity token for short-lived cloud credentials without storing a permanent cloud key. -->

A CI runner has no human present to complete an interactive login. The weak design stores a long-lived cloud access key in repository secrets and injects it into every deployment. That key exists even when no job is running, must be rotated, and can be copied if the secret store or workflow is compromised.

OpenID Connect changes the model. A platform such as GitHub Actions can issue a signed token describing the workflow identity. The cloud trusts the platform's OIDC issuer under explicit conditions and exchanges an accepted token for temporary role credentials.

```text
GitHub Actions job
        |
        v
requests signed OIDC token
        |
        v
cloud validates issuer, audience, and subject claims
        |
        v
cloud permits assumption of terraform-prod role
        |
        v
temporary credentials reach the provider
```

OIDC is not magic authentication. Several independent trust decisions must succeed. The workflow platform must issue a valid token. The cloud must trust that issuer. The token audience must match the expected token exchange. The subject must identify an approved repository, branch, tag, or protected environment. The role trust policy must allow those claims to assume the role.

The token is better understood as a signed set of claims than as a cloud credential. A cloud identity service validates the signature against the issuer's published keys and evaluates the claims against its trust policy. Only after that evaluation does it issue its own access key, secret key, and session token for the role. The workflow never turns a GitHub token directly into an S3 request.

A trust relationship can therefore be reasoned about as a sequence:

```text
token signature valid?
    -> token issued by the configured GitHub issuer?
    -> audience intended for AWS STS?
    -> subject identifies the approved repository and context?
    -> requested role permits this identity?
    -> issue a bounded AWS role session
```

If the subject condition is broad, a valid token from an unrelated repository may satisfy the trust policy. If a workflow can run unreviewed code on the permitted branch or environment, an attacker may be able to request the same role. Repository protections, environment approvals, and trust claims are therefore part of one security boundary.

There are then two permission layers:

```text
role trust policy
    Who may become this role?

role permission policy
    What may a valid role session do?
```

A narrow permission policy cannot compensate for a trust policy that lets every repository become the role. A narrow trust policy cannot compensate for an administrator-level role. Both are required.

In GitHub Actions, `id-token: write` permits the job to request an OIDC token. It does not directly grant AWS write access. Cloud access begins only after AWS validates the token and returns AWS credentials under the selected role's policies.

A schematic workflow is:

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - uses: actions/checkout@v4

  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/terraform-prod
      aws-region: eu-west-2

  - run: terraform init
  - run: terraform plan -out=tfplan
```

The trust policy should constrain the `sub` claim to the intended repository and deployment context. Protected GitHub environments can add reviewers and branch restrictions. The audience condition should match AWS STS. These claims connect the short-lived cloud role session to an identifiable workflow.

Temporary credentials should match the job lifetime. A plan job and an apply job can obtain separate sessions, possibly under separate roles. When the job ends, its credentials expire. No permanent AWS password needs to sit in the repository secret store.

The CI platform still needs normal secret hygiene. OIDC removes the stored cloud key; it does not make every workflow input safe. Terraform variables, backend parameters, plan artifacts, and application secrets still need appropriate handling. The security gain is precise: the cloud credential is created just in time, is tied to a workflow identity, and expires after a short session instead of existing indefinitely as copied secret material.

## How Do Least Privilege and Environment Separation Work?
<!-- section-summary: Trust, permissions, duration, resources, operations, and environments all contribute to least privilege. -->

Least privilege is not one small policy. It has several dimensions:

```text
WHO may obtain the identity?
WHAT operations may it perform?
WHICH resources may it affect?
WHERE, meaning which account or project, may it act?
WHEN and for how long is the session valid?
UNDER WHICH workflow, branch, or approval conditions?
```

OIDC improves the “who” and “when” dimensions by binding a temporary session to workflow claims. Permission policies still need to limit actions and resources. Separate state and provider roles can limit which stacks the session reaches.

Environment separation should usually include identity separation. Development and production are not distinguished merely by `environment = "prod"` inside Terraform. Strong separation aligns several independent controls:

```text
development state -> development account -> development role
production state  -> production account  -> production deployment role
```

Provider aliases do not create those identities. An alias names another configured provider instance:

```hcl
provider "aws" {
  alias  = "prod"
  region = "eu-west-2"
}
```

Unless separate credentials or role assumption are configured in the execution context, an alias may still use the same underlying caller. Names such as `prod` and `dev` are not security boundaries by themselves.

For example, two aliases can select two regions while both calls remain inside one account. Alternatively, two provider configurations can assume roles in separate accounts. The alias only lets configuration refer to a provider instance; the provider's discovered or assumed identity determines the real destination and authority. Reviewers should inspect both the alias routing and the identity behind every configuration.

Least privilege also changes across Terraform phases. Formatting and validation need no cloud identity. Initialization may need backend read and lock access. Planning needs state plus provider reads and can sometimes use restricted write authority. Applying requires the exact operations in the approved plan. Giving every phase the strongest apply role loses an easy containment boundary.

Separate plan and apply roles introduce a compatibility obligation. A plan made with broad read access may contain changes the apply role cannot execute. More dangerously, credentials can point at different accounts while using identical resource names. The pipeline should display caller identity, backend key, region, and other target facts in both phases, then reject a mismatch rather than assuming the word `prod` proves equivalence.

For CI, a planning identity may have broad read permissions and only the minimal writes required to create a saved plan, while an apply identity holds deployment permissions and is reachable only after approval. Terraform cannot automatically prove that two different credentials target the same account and resources. The pipeline should verify both identities and ensure that the saved plan's target context matches the apply context.

Credential lifetime also limits risk. A session valid only for the deployment window is safer than a key valid indefinitely. Resource scope limits the blast radius further: an application-stack role should not automatically modify unrelated organization-wide identity or networking resources.

Authentication should not rely on something the same run is about to create. The OIDC provider, trust role, backend, and core account boundaries are bootstrap infrastructure. Keeping them outside the application state's normal change path prevents a stack from destroying the route it needs to authenticate or recover itself.

## What Should Modules Know About Credentials?
<!-- section-summary: Reusable modules declare provider requirements and accept provider configurations from callers instead of owning credentials. -->

A reusable child module should describe resources, inputs, outputs, and provider compatibility. It should not contain long-lived keys, environment-specific profiles, or an assumption that every caller authenticates the same way.

The module can declare its provider requirement:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
```

This says which provider plugin and compatible versions the module uses. It does not authenticate the provider. The root module owns provider configuration because the root represents a concrete deployment context.

When a child needs a non-default configuration, the caller passes it explicitly:

```hcl
module "application" {
  source = "../../modules/application"

  providers = {
    aws = aws.prod
  }
}
```

The module consumes the selected API context without learning how its credentials were obtained. A developer session, OIDC role, or managed runner identity can all satisfy the same root provider configuration.

Avoid provider blocks inside shared child modules unless there is a specific supported reason. Embedded configuration makes aliases, `for_each`, `count`, environment routing, and caller control harder. More importantly, embedding credentials makes reusable source code a secret-distribution mechanism.

The ownership direction should remain:

```text
execution environment establishes identity
        |
        v
root module configures or selects providers
        |
        v
caller passes provider configurations
        |
        v
child module declares requirements and manages resources
```

This separation makes module tests and reuse easier. The same module can be instantiated in development and production under different roles without editing its source. Reviewers can inspect the root to see which provider aliases and environments are involved.

Input variables marked sensitive still belong to the module's data contract, not its provider-authentication model. If an application secret must pass through Terraform, manage its exposure deliberately. Do not use that pattern to smuggle provider or backend credentials into a module.

## What Evidence Makes an Authenticated Run Trustworthy?
<!-- section-summary: A trustworthy run records and verifies its identity, target, approved plan, and protected artifacts before infrastructure changes. -->

Before changing infrastructure, verify the real identity. For AWS:

```bash
aws sts get-caller-identity
terraform plan -out=tfplan
```

The identity output should match the expected account and role. Terraform can add another guardrail by querying caller information through a data source and asserting an expected account, but an external pipeline check remains valuable because it runs before a destructive plan can proceed.

When approval matters, save the plan. A saved plan connects the reviewed decision to the later apply:

```bash
terraform plan -out=tfplan
terraform show -no-color tfplan
terraform apply tfplan
```

The plan is meaningful only in its context: configuration commit, state, variables, provider selections, backend, and authenticated target. The evidence record should include those facts plus the plan summary, reviewer, workflow run, and post-apply verification.

An identity guard can also live in configuration. A data source can read the current cloud account, and a precondition can compare it with an expected account ID supplied through the trusted deployment context. This does not replace external verification because Terraform must already authenticate to evaluate the data source, but it can stop a plan whose provider points at the wrong account.

The evidence should distinguish an identity's friendly name from its effective session. Record the account or project, role ARN, session identity, and workflow run that obtained it. The cloud audit record may then show the same session performing the provider calls. Together, those details answer who requested the change, who approved it, which authority executed it, and which remote boundary received it.

Plan files are security-sensitive artifacts. They can contain configuration and values in forms that should not be published, even when normal terminal output marks a value sensitive. Restrict artifact access and retention, and never treat a binary plan as harmless because it is not plain text. State deserves at least the same care because it can contain secrets and detailed infrastructure inventory.

Reproducibility adds one more condition. A saved plan is intended for a compatible execution environment with the same configuration and provider packages. Store the lock file with the code, keep the apply runner compatible with the plan runner, and prevent an approval from silently turning into a newly calculated plan. Authentication proves the caller; it does not prove that the caller is applying the decision reviewers inspected.

After apply, verification should check the resulting infrastructure through the appropriate API or service signal and retain a concise outcome. An authenticated and approved command can still produce a partial failure. The record is complete only when it connects the intended target, actual identity, exact plan, provider results, final state write, and operational verification.

Credential failures should be investigated without printing secrets. Confirm the selected profile or workload context, query the caller identity, inspect role trust and permission denials, and check token or session expiration. Debug logs can expose headers or environment values, so enable them only in a protected setting, retain them briefly, and redact them before sharing diagnostic evidence.

A local development flow should look like:

```text
human authenticates through organization
    -> selects development context
    -> verifies account and role
    -> initializes the intended state
    -> creates a speculative plan
    -> does not carry a permanent production key
```

A production CI flow should look like:

```text
approved workflow identity
    -> signed OIDC token
    -> narrowly trusted production role
    -> short-lived credentials
    -> verify caller and target
    -> initialize protected backend
    -> produce and review saved plan
    -> apply exact approved plan under controlled authority
    -> retain audit and verification evidence
```

The deepest model is that credentials should flow downward from established trust, not upward from Terraform code. Configuration states the desired infrastructure. The execution environment supplies an authenticated principal. Trust policy decides who may become it; permission policy limits what it can do; backend and provider boundaries constrain where it operates; and evidence lets another person prove which identity performed the change.

Authentication proves which identity the provider presents; authorization determines which reads and mutations that identity may perform. Design CI credentials around the resources, environments, and duration required for one run, and keep long-lived keys out of configuration and state. A successful initialization proves plugin setup, not that the identity has correct permissions. Planning exercises read access, while apply exercises mutation, so preflight both boundaries with an approved canary or sandbox and interpret access failures at the operation that triggered them.

Authentication also has a data consequence. Provider responses can place credential-adjacent or sensitive values in a plan and in state even when the credential itself came from an environment variable or workload identity. Commands in the `terraform state` family therefore belong inside the same protected operator boundary as backend access: restrict who can run them, where their output can be stored, and which logs may capture it.

## Check Your Answers

:::expand[Why Does a Terraform Run Need an Identity?]{kind="recap"}
Providers call protected APIs. Credentials authenticate a recognized identity, and authorization determines whether that identity may perform each requested operation.
:::

:::expand[Why Should Credentials Stay Outside Configuration?]{kind="recap"}
Configuration is durable and shareable, while credentials should be confidential, revocable, and short-lived. Provider discovery keeps those lifecycles separate.
:::

:::expand[How Does Local Authentication Reach a Provider?]{kind="recap"}
A developer signs in through organizational tooling, selects an approved context, verifies the real caller, and lets the provider discover the resulting session.
:::

:::expand[Why Is Backend Authentication a Separate Concern?]{kind="recap"}
Backend access is needed before normal planning and protects sensitive state. Review its read, write, and lock permissions separately from provider permissions.
:::

:::expand[How Does OIDC Authenticate a CI Job?]{kind="recap"}
A workflow exchanges a signed, scoped OIDC token for temporary cloud credentials. Issuer, audience, subject, trust policy, and role permissions must all be correct.
:::

:::expand[How Do Least Privilege and Environment Separation Work?]{kind="recap"}
Limit who, what, where, when, and under which workflow conditions a session can act. Align production state with separate accounts, roles, and approvals.
:::

:::expand[What Should Modules Know About Credentials?]{kind="recap"}
Children declare provider requirements and receive configured providers from roots. They should not own credentials or environment-specific authentication.
:::

:::expand[What Evidence Makes an Authenticated Run Trustworthy?]{kind="recap"}
Verify the caller and target, bind approval to the saved plan, protect plans and state, and record the commit, identity, context, approval, apply, and outcome.
:::

---

**References**

- [Terraform: Providers](https://developer.hashicorp.com/terraform/language/providers)
- [Terraform: Provider configuration](https://developer.hashicorp.com/terraform/language/providers/configuration)
- [Terraform: Sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)
- [Terraform: Backend configuration](https://developer.hashicorp.com/terraform/language/backend)
- [Terraform: Running in automation](https://developer.hashicorp.com/terraform/tutorials/automation/automate-terraform)
- [GitHub: OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect)
- [GitHub: Configuring OIDC in AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [AWS: IAM OIDC federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)
- [Terraform: Provider requirements in modules](https://developer.hashicorp.com/terraform/language/modules/develop/providers)
