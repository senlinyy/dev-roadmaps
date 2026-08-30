---
title: "Secrets And Credentials In ML Pipelines"
description: "Identity names an actor, permission defines allowed actions, a credential proves identity, and a secret is any confidential value whose exposure creates risk; ML pipelines multiply all four across long workflows."
overview: "Identity names an actor, permission defines allowed actions, a credential proves identity, and a secret is any confidential value whose exposure creates risk; ML pipelines multiply all four across long workflows. Credential architecture supports Responsible AI by making least authority, separation of duties, traceability, revocation, and protection of data and artifacts enforceable."
tags: ["MLOps", "production", "security"]
order: 3
id: "article-mlops-governance-and-responsible-ai-secrets-credentials-in-ml-pipelines"
aliases:
  - roadmaps/mlops/modules/governance-and-responsible-ai/security/02-secrets-credentials-in-ml-pipelines.md
  - child-security-02-secrets-credentials-in-ml-pipelines
---

## Table of Contents

1. [How Do Identity, Permission, Credentials, and Secrets Differ in an ML Pipeline?](#how-do-identity-permission-credentials-and-secrets-differ-in-an-ml-pipeline)
2. [How Do Workload Identity, Federation, Audience Binding, and Stage-Specific Roles Remove Static Credentials?](#how-do-workload-identity-federation-audience-binding-and-stage-specific-roles-remove-static-credentials)
3. [How Should Unavoidable Secrets Be Stored, Delivered, Scoped, and Replaced with Dynamic Credentials?](#how-should-unavoidable-secrets-be-stored-delivered-scoped-and-replaced-with-dynamic-credentials)
4. [How Do Keys, Certificates, Encryption, Local Development, and Third-Party APIs Require Different Boundaries?](#how-do-keys-certificates-encryption-local-development-and-third-party-apis-require-different-boundaries)
5. [How Should Rotation, Expiration, Revocation, Break-Glass Access, Migration, and Verification Work?](#how-should-rotation-expiration-revocation-break-glass-access-migration-and-verification-work)
6. [How Do Telemetry and Credential Incidents Reveal the Authority an Attacker Inherited?](#how-do-telemetry-and-credential-incidents-reveal-the-authority-an-attacker-inherited)
7. [What Does an End-to-End Pipeline and Governance Review Verify?](#what-does-an-end-to-end-pipeline-and-governance-review-verify)
8. [How Does Credential Design Support Responsible AI and Least Authority?](#how-does-credential-design-support-responsible-ai-and-least-authority)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A training pipeline stores one long-lived cloud key in CI and shares it across data download, training, registry upload, and deployment. Compromising any stage gives an attacker the combined authority of the entire pipeline, and rotating the key can break every workload at once.

An **identity** names a person or workload, a **permission** states what it may do, a **credential** proves identity, and a **secret** is confidential material whose exposure creates risk. Separating those concepts makes it possible to replace shared static keys with bounded workload authority.

These questions follow credentials from federation and stage-specific identity through unavoidable secrets, rotation, telemetry, incident response, governance, and the full pipeline:

1. **How Do Identity, Permission, Credentials, and Secrets Differ in an ML Pipeline?**
2. **How Do Workload Identity, Federation, Audience Binding, and Stage-Specific Roles Remove Static Credentials?**
3. **How Should Unavoidable Secrets Be Stored, Delivered, Scoped, and Replaced with Dynamic Credentials?**
4. **How Do Keys, Certificates, Encryption, Local Development, and Third-Party APIs Require Different Boundaries?**
5. **How Should Rotation, Expiration, Revocation, Break-Glass Access, Migration, and Verification Work?**
6. **How Do Telemetry and Credential Incidents Reveal the Authority an Attacker Inherited?**
7. **What Does an End-to-End Pipeline and Governance Review Verify?**
8. **How Does Credential Design Support Responsible AI and Least Authority?**

## How Do Identity, Permission, Credentials, and Secrets Differ in an ML Pipeline?
<!-- section-summary: Identity names an actor, permission defines allowed actions, a credential proves identity, and a secret is any confidential value whose exposure creates risk; ML pipelines multiply all four across long workflows. -->

Identity names an actor, permission defines allowed actions, a credential proves identity, and a secret is any confidential value whose exposure creates risk; ML pipelines multiply all four across long workflows.

The easiest way to understand secrets and credentials in ML pipelines is to begin with one question:

**How does a machine prove who it is, and how much authority should that proof give it?**

An ML pipeline contains many machines acting on behalf of the organization:

$$
\text{Data Ingestion}
\rightarrow
\text{Training}
\rightarrow
\text{Evaluation}
\rightarrow
\text{Model Registry}
\rightarrow
\text{Release}
\rightarrow
\text{Serving}
$$

Each stage needs access to something valuable. Training may need private datasets. Evaluation may need candidate models. Release may need permission to approve artifacts. Serving may need permission to read production models and customer data. The dangerous design is:

$$
\boxed{\text{One permanent credential that can do everything}}
$$

The safer design is:

$$
\boxed{
\text{one identity per workload}
+
\text{minimum permissions}
+
\text{short-lived proof}
+
\text{limited places where that proof works}
}
$$

That is the central idea behind credential security in modern ML systems. These concepts are often mixed together, which makes security architecture confusing. Suppose a training job accesses an object-storage bucket. There are really four separate questions.

| Concept        | Question                                          |
| -------------- | ------------------------------------------------- |
| **Identity**   | Who or what is making the request                |
| **Permission** | What is that identity allowed to do              |
| **Credential** | How does it prove its identity                   |
| **Secret**     | What sensitive information must not be disclosed |

Imagine:

$$
Identity =
\text{training-job-42}
$$

The identity might have:

$$
Permissions =
\{
Read(TrainingData),
Write(CandidateModels)
\}
$$

To authenticate, it might temporarily possess:

$$
Credential =
\text{short-lived access token}
$$

The credential is evidence supporting the claim:

“I am training-job-42.”

These should not be confused. Consider an employee badge. The employee is the **identity**. The badge is the **credential** used to prove the identity. The doors the employee may enter are the **permissions**. The badge's encoded authentication material may need protection. Likewise:

$$
\text{Identity}
\neq
\text{Credential}
\neq
\text{Permission}
$$

If a credential is stolen:

$$
\text{Attacker}
+
\text{Credential}
\rightarrow
\text{Impersonates Identity}
$$

The identity itself did not change. This distinction matters during incident response because sometimes you revoke a particular credential while preserving the underlying identity. A password is usually both:

$$
\text{Secret}
+
\text{Credential}
$$

An API key is often both as well. But an encryption key might be:

$$
\text{Secret}
$$

without being the identity credential used to authenticate to a service. Likewise, a database password is a credential, while a proprietary encryption key might exist solely to encrypt model artifacts. So:

$$
\boxed{
\text{Some credentials are secrets, but not every secret is a credential.}
}
$$

This matters when deciding which system should manage each object. Consider a traditional small application:

$$
App
\rightarrow
Database
$$

Perhaps it needs one credential. An ML environment can involve:

$$
\text{Notebook}
\rightarrow
\text{Object Storage}
$$

$$
\text{Training Job}
\rightarrow
\text{Feature Store}
$$

$$
\text{Training Job}
\rightarrow
\text{Experiment Tracker}
$$

$$
\text{Evaluation}
\rightarrow
\text{Model Registry}
$$

$$
\text{CI/CD}
\rightarrow
\text{Cloud Platform}
$$

$$
\text{Serving}
\rightarrow
\text{Database}
$$

$$
\text{Model}
\rightarrow
\text{External API}
$$

Now imagine using one permanent cloud key everywhere. It might appear in a notebook, CI secret store, environment variable, configuration file, developer laptop, container runtime, shell history or debugging output. Every copy creates another opportunity for compromise. A useful conceptual model is:

$$
\boxed{
\text{Credential Risk}
\propto
\text{Privilege}
\times
\text{Lifetime}
\times
\text{Number of Copies}
\times
\text{Acceptance Surface}
}
$$

This is not a formal risk equation, but it captures the architecture surprisingly well. To reduce risk, reduce all four. Suppose we create:

```text
CLOUD_ACCESS_KEY=...
CLOUD_SECRET_KEY=...
```

and place them in the training pipeline. They work today. They work tomorrow. Perhaps they work next year. If copied by an attacker:

$$
\text{Credential stolen at }t_0
$$

then unless someone notices and revokes it:

$$
\text{Credential still useful at }t_0 + 30\text{ days}
$$

or:

$$
t_0 + 300\text{ days}
$$

The security team therefore has two problems:

$$
\text{detect compromise}
$$

and:

$$
\text{remember to revoke credential}
$$

Temporary credentials change the economics. Suppose the credential lasts one hour:

$$
Lifetime(C)=1h
$$

Even if copied:

$$
t > t_{issue}+1h
\Rightarrow
C \text{ becomes useless}
$$

AWS's current IAM guidance explicitly recommends temporary credentials for workloads rather than long-lived access keys wherever possible. ([AWS Documentation][1]) The principle is platform-independent:

$$
\boxed{\text{Credentials should usually live approximately as long as the work that needs them.}}
$$

## How Do Workload Identity, Federation, Audience Binding, and Stage-Specific Roles Remove Static Credentials?
<!-- section-summary: Workload identity and federation exchange trusted runtime claims for short-lived credentials, bind tokens to a specific audience, and give each pipeline stage only the role it requires. -->

Workload identity and federation exchange trusted runtime claims for short-lived credentials, bind tokens to a specific audience, and give each pipeline stage only the role it requires.

Instead of asking:

“Which secret should we give this container?”

ask:

**“Can the platform already establish which workload this container is?”**

For example, cloud systems can often establish:

$$
\text{This VM}
$$

or:

$$
\text{this Kubernetes ServiceAccount}
$$

or:

$$
\text{this CI job}
$$

or:

$$
\text{this managed workload identity}
$$

Then the workload can exchange evidence of that identity for temporary access.

Conceptually:

$$
\text{Workload}
\rightarrow
\text{Identity Assertion}
\rightarrow
\text{Security Token Service}
$$

The service verifies:

$$
Issuer
$$

$$
Subject
$$

$$
Audience
$$

$$
Policy Conditions
$$

Then issues:

$$
\text{Short-Lived Credential}
$$

with:

$$
\text{Limited Permissions}
$$

Now there is no permanent cloud password sitting inside the pipeline. This architecture is usually called **identity federation** or **workload identity federation**. Suppose system A knows the workload's identity. Cloud B trusts system A to make certain identity statements.

Then:

$$
A:
\text{“This is workload X.”}
$$

followed by:

$$
B:
\text{“I trust A about X under these conditions.”}
$$

allows B to issue temporary credentials. So:

$$
\boxed{
\text{Federation}
=
\text{Trust identity assertion}
\rightarrow
\text{issue temporary authority}
}
$$

But notice what happened. We eliminated a permanent secret. We did **not** eliminate security configuration. The trust policy is now extremely important. If the cloud says:

“Trust anything coming from CI.”

that might still be dangerous. A better trust policy says something closer to:

$$
Issuer = GitHub
$$

and:

$$
Repository = X
$$

and:

$$
Branch/Environment = production
$$

and perhaps:

$$
Workflow = approved\ deployment\ workflow
$$

Therefore:

$$
\boxed{
\text{No static secret}
\not\Rightarrow
\text{secure authentication}
}
$$

Trust conditions must still be narrow. The old pattern looks like:

$$
\text{GitHub Secret}
=
\text{Permanent Cloud Key}
$$

Then:

$$
\text{Workflow}
\rightarrow
\text{reads permanent key}
\rightarrow
\text{accesses cloud}
$$

If that stored credential leaks, it may remain useful long after the workflow finishes. With GitHub Actions OIDC, the flow becomes:

$$
\text{Workflow}
\rightarrow
\text{GitHub OIDC token}
$$

then:

$$
\text{Cloud verifies token claims}
$$

then:

$$
\text{Cloud issues temporary credential}
$$

then:

$$
\text{Workflow performs deployment}
$$

then the credential expires. GitHub's current documentation describes exactly this model: Actions can authenticate to cloud providers through OIDC without storing long-lived cloud credentials, and GitHub emphasizes putting conditions on the trust relationship so that unexpected repositories cannot obtain the cloud token. ([GitHub Docs][2]) An important detail is:

```text
id-token: write
```

does not itself mean:

“This workflow may modify the cloud account.”

It means the workflow can request an OIDC identity token. The cloud's authorization policy determines what happens after that identity is accepted. ([GitHub Docs][2]) Again:

$$
\text{Authentication}
\neq
\text{Authorization}
$$

Suppose the trust rule says:

$$
Issuer = GitHub
$$

That's much too broad. Millions of workflows could satisfy that. Instead, you want progressively narrower claims.

Conceptually:

$$
Issuer
\land
Organization
\land
Repository
\land
Environment
\land
Workflow
$$

The cloud should issue privileged deployment credentials only when all relevant conditions hold. Current GitHub documentation also supports subject claims tied to repository and owner identity; GitHub's newer immutable subject format uses stable repository and owner IDs, helping avoid problems where names are renamed or reused. ([GitHub Docs][3]) The broad principle is:

$$
\boxed{
\text{Federated trust should identify the smallest legitimate set of workloads.}
}
$$

Suppose a Kubernetes training Pod needs access to an external secrets service. The old design might place a permanent token into a Kubernetes Secret:

$$
Pod
\rightarrow
StaticToken
$$

If stolen, it may continue working indefinitely. Modern Kubernetes instead supports projected ServiceAccount tokens. These can be:

$$
\text{time-bound}
$$

$$
\text{Pod-bound}
$$

$$
\text{automatically rotated}
$$

and:

$$
\text{audience-bound}
$$

Kubernetes currently recommends projected ServiceAccount tokens over old non-expiring ServiceAccount-token Secrets. ([Kubernetes][4]) Suppose a training Pod needs to authenticate to:

$$
Vault
$$

You can issue a token whose intended audience is:

$$
aud = vault
$$

The receiver should verify:

$$
aud(token)=vault
$$

If someone steals the token and tries to use it against an unrelated service, that service should reject it because:

$$
aud(token)\neq service
$$

Kubernetes projected ServiceAccount tokens allow an audience to be specified explicitly and are issued with limited lifetimes. ([Kubernetes][5]) This gives another blast-radius principle:

$$
\boxed{\text{A credential should work only where it was intended to work.}}
$$

But there is an important subtlety:

$$
\boxed{\text{Audience} \neq \text{Permission}}
$$

Audience determines:

“Which service should accept this credential?”

Authorization/RBAC determines:

“What may this identity do after authentication?”

You want both. Consider this pipeline:

$$
Training
\rightarrow
Evaluation
\rightarrow
Approval
\rightarrow
Deployment
\rightarrow
Serving
$$

The simplest implementation gives everything:

```text
ml-pipeline-admin
```

Now compromise of the training job could potentially deploy arbitrary models to production. That's unnecessary. Instead, reason from required capabilities.

### Training

Training needs:

$$
Read(ApprovedTrainingData)
$$

and:

$$
Write(CandidateModels)
$$

But:

$$
\neg ApproveModels
$$

and:

$$
\neg DeployProduction
$$

### Evaluation

Evaluation may need:

$$
Read(CandidateModels)
$$

$$
Read(EvaluationData)
$$

$$
Write(EvaluationResults)
$$

But:

$$
\neg ModifyTrainingData
$$

and ideally:

$$
\neg DeployProduction
$$

### Release

The release process might:

$$
Read(EvaluationEvidence)
$$

and:

$$
Promote(ApprovedArtifact)
$$

but should not necessarily be capable of silently modifying the training dataset.

### Serving

Production inference might only require:

$$
Read(ApprovedModel)
$$

plus narrowly scoped access to production resources necessary for serving. This is separation of duties implemented through identities. Suppose a training workload is compromised. If it can:

$$
\text{Train Model}
+
\text{Approve Model}
+
\text{Deploy Model}
$$

an attacker can create:

$$
M_{malicious}
$$

approve it:

$$
Approved(M_{malicious})
$$

and deploy it:

$$
Production(M_{malicious})
$$

without crossing another trust boundary. That can turn a cybersecurity incident directly into:

$$
\text{Safety Harm}
$$

or:

$$
\text{Fairness Harm}
$$

or:

$$
\text{Privacy Harm}
$$

Separation of identity and authority forces the attacker through several independent controls.

$$
\boxed{
\text{Compromise of one ML stage should not imply compromise of the entire ML lifecycle.}
}
$$

![A reusable cloud key spreads into notebooks, CI logs, image caches, runtime processes, and telemetry, while federated workload access exchanges a signed OIDC assertion for a scoped credential that expires.](/content-assets/articles/article-mlops-governance-and-responsible-ai-secrets-credentials-in-ml-pipelines/static-key-vs-federation.png)

*Static credentials can outlive the job in many copied surfaces; federation avoids storing the reusable cloud key and narrows access through trust claims, scope, and expiry.*

## How Should Unavoidable Secrets Be Stored, Delivered, Scoped, and Replaced with Dynamic Credentials?
<!-- section-summary: Unavoidable secrets remain in a managed store, arrive as late as possible to the smallest process, and give way to scoped dynamic credentials that limit shared fate. -->

Unavoidable secrets remain in a managed store, arrive as late as possible to the smallest process, and give way to scoped dynamic credentials that limit shared fate.

Not every system supports workload federation. Suppose your training job calls a third-party API requiring:

```text
API_KEY=...
```

Now a stored secret really is necessary. The appropriate response is not:

“Put it in the YAML.”

Use a dedicated secret-management system.

Conceptually:

$$
\text{Secret Manager}
$$

stores the secret centrally. The workload authenticates to the secret manager using its workload identity:

$$
WorkloadIdentity
\rightarrow
SecretManager
$$

The secret manager checks:

$$
MayRead(APIKey_X)
$$

Only then is the value delivered. Current Azure Key Vault guidance, for example, recommends storing application credentials, passwords and access keys in a dedicated secrets store, while using managed identities where possible rather than embedding credentials in applications. ([Microsoft Learn][6]) Imagine this policy:

$$
TrainingJob
\rightarrow
Read(AllSecrets)
$$

The secrets are now neatly stored in a vault. But compromising that training job still reveals everything. So:

$$
\boxed{
\text{Centralized storage}
\neq
\text{least privilege}
}
$$

A stronger policy might be:

$$
TrainingJob_X
\rightarrow
Read(APIKey_X)
$$

but:

$$
\neg Read(DatabaseAdminPassword)
$$

and:

$$
\neg Read(ProductionSigningKey)
$$

Secret managers improve storage, rotation, access control and auditing. They do not eliminate the need for careful authorization. Suppose a Docker build requires no production secret. But someone writes:

```dockerfile
ENV PROD_API_KEY=...
```

Now the secret may become part of the image or build history. Every machine that pulls the image may receive it. This violates an important principle:

$$
\boxed{\text{Do not give a secret to a component before that component actually needs it.}}
$$

A better sequence is:

$$
\text{Build Image}
$$

then much later:

$$
\text{Start Authorized Runtime}
$$

then:

$$
\text{Authenticate Workload}
$$

then:

$$
\text{Retrieve Secret}
$$

then:

$$
\text{Use Secret}
$$

This is sometimes called **late binding** or runtime secret injection. It reduces the number of places where the secret exists. Suppose one machine contains:

$$
\text{Training Process}
+
\text{Logging Agent}
+
\text{Debug Tools}
+
\text{Sidecars}
$$

If you expose a credential globally, several components may be able to read it. The desired relationship is:

$$
Secret_X
\rightarrow
Process_X
$$

not:

$$
Secret_X
\rightarrow
EverythingOnMachine
$$

This requires careful consideration of filesystem permissions, environment inheritance, process isolation, containers, sidecars and debugging interfaces. The general principle is:

$$
\boxed{
\text{Secret visibility should approximate actual need.}
}
$$

You will often see:

```text
DATABASE_PASSWORD=...
```

This is easy for applications. But environment variables can accidentally appear in debugging output, crash diagnostics, child processes or poorly designed logging. That does not mean environment variables are always forbidden. It means:

$$
\boxed{
\text{“It's an environment variable” does not answer who can read it.}
}
$$

The important questions remain:

$$
\text{Which process receives it?}
$$

$$
\text{How long does it exist?}
$$

$$
\text{Can it leak into telemetry?}
$$

$$
\text{Can another process inspect it?}
$$

$$
\text{Is it automatically refreshed?}
$$

Imagine 50 training jobs all use:

```text
db_ml_user
password = X
```

If suspicious activity appears, you know:

$$
db\_ml\_user
$$

performed it. But which training job Unknown. Now imagine every job receives a unique temporary database account:

$$
Job_{101}
\rightarrow
db\_cred_{101}
$$

$$
Job_{102}
\rightarrow
db\_cred_{102}
$$

Each credential has:

$$
TTL=1h
$$

and:

$$
Permissions=ReadOnly
$$

Now suspicious activity from:

$$
db\_cred_{101}
$$

maps directly to:

$$
Job_{101}
$$

Dynamic-secret systems such as HashiCorp Vault can generate unique database credentials with leases, automatically expire them and revoke individual credentials when necessary. ([HashiCorp Developer][7]) This improves both security and attribution. With a shared password:

$$
Compromise(User_A)
\rightarrow
RotateSharedPassword
\rightarrow
User_B,\ User_C,\ User_D
\text{ all affected}
$$

With unique dynamic credentials:

$$
Compromise(Credential_A)
\rightarrow
Revoke(Credential_A)
$$

while:

$$
Credential_B,\ Credential_C,\ Credential_D
$$

remain valid. This property is extremely valuable during incidents. The principle is:

$$
\boxed{\text{One compromised workload should ideally require revoking only that workload's authority.}}
$$

## How Do Keys, Certificates, Encryption, Local Development, and Third-Party APIs Require Different Boundaries?
<!-- section-summary: Signing keys, certificates, access credentials, and encryption keys serve different purposes, while development and supplier APIs retain the same boundary and least-authority requirements. -->

Signing keys, certificates, access credentials, and encryption keys serve different purposes, while development and supplier APIs retain the same boundary and least-authority requirements.

These concepts are often casually called “keys.” That creates confusion. Consider four objects.

| Object                    | Main job                               |
| ------------------------- | -------------------------------------- |
| API key                   | Authenticate/identify access to an API |
| Private cryptographic key | Prove possession, sign, or decrypt     |
| Certificate               | Bind an identity/name to a public key  |
| Encryption key            | Protect confidentiality of data        |

An X.509 certificate, for example, is generally not itself the secret. The corresponding:

$$
PrivateKey
$$

is sensitive. The certificate lets others reason:

“This public key belongs to identity X because a trusted CA signed that statement.”

So:

$$
\text{Certificate}
+
\text{Private-Key Possession}
$$

can be used for authentication. But certificates and encryption keys should not simply be dumped into one undifferentiated “secrets” category. Their lifecycle and controls differ. Suppose training data is encrypted. Excellent. But someone still needs permission to decrypt it. So:

$$
\text{Possess Ciphertext}
$$

should not imply:

$$
\text{Can Decrypt}
$$

A key-management service can keep the high-value encryption key centrally protected while workloads receive permission to request cryptographic operations. This separates:

$$
\text{storage access}
$$

from:

$$
\text{key-use authority}
$$

An attacker may then need to compromise both. Suppose we have a giant dataset:

$$
D
$$

Rather than send the entire dataset through a centralized KMS, we can generate a **data encryption key**:

$$
DEK
$$

and encrypt:

$$
C=Encrypt(DEK,D)
$$

Then use a more protected **key encryption key**:

$$
KEK
$$

to encrypt the DEK:

$$
WrappedDEK=Encrypt(KEK,DEK)
$$

Store:

$$
C + WrappedDEK
$$

To decrypt, an authorized workload asks the KMS to unwrap the DEK. Google Cloud's current envelope-encryption documentation describes this DEK/KEK architecture and recommends keeping the KEK centrally controlled. ([Google Cloud Documentation][8]) The useful security property is:

$$
\boxed{
\text{The highly trusted KEK does not need to leave the key-management boundary.}
}
$$

A common anti-pattern is:

“Production uses workload identity, but developers need convenience, so we'll give them the production key.”

Now:

$$
\text{Developer Laptop}
$$

becomes part of the production credential boundary. That laptop may contain browsers, extensions, development tools, experimental packages, notebooks and local files. Instead, developers should usually receive:

$$
\text{Developer Identity}
$$

through federation or interactive authentication, with access to:

$$
\text{Development Resources}
$$

rather than:

$$
\text{Production Resources}
$$

The environment separation should look like:

$$
DevIdentity
\rightarrow
DevData
$$

and:

$$
ProdWorkloadIdentity
\rightarrow
ProdData
$$

not:

$$
DeveloperCredential
\rightarrow
Everything
$$

Sometimes a vendor gives you only:

```text
sk-xxxxxxxx
```

There may be no OIDC or workload federation. Then treat the API key as a high-value credential. Ideally:

$$
\text{one credential per workload/environment}
$$

rather than:

$$
\text{one company-wide credential}
$$

Use vendor-provided scoping, quotas, IP restrictions or endpoint restrictions where available. Store it in the secret manager. Rotate it. Monitor usage. For especially sensitive cases, you can introduce an internal broker:

$$
TrainingJob
\rightarrow
InternalProxy
\rightarrow
ExternalAPI
$$

The training job authenticates using its internal workload identity. The proxy possesses the third-party credential. Now:

$$
\text{ExternalAPIKey}
$$

does not need to exist inside every training container.

## How Should Rotation, Expiration, Revocation, Break-Glass Access, Migration, and Verification Work?
<!-- section-summary: Expiration ends validity, rotation changes material, revocation removes authority, break-glass access is exceptional, and migration is incomplete until old static paths are removed and the new path is tested. -->

Expiration ends validity, rotation changes material, revocation removes authority, break-glass access is exceptional, and migration is incomplete until old static paths are removed and the new path is tested.

Consider a temporary token. It expires automatically:

$$
t>t_{exp}
\Rightarrow
Invalid
$$

A static API key may require **rotation**:

$$
K_1
\rightarrow
K_2
$$

Then:

$$
Disable(K_1)
$$

Rotation sounds simple until you discover 34 unknown jobs still depend on $$K_1$$. So a mature credential-management system needs to know:

$$
\text{Which workloads consume this credential?}
$$

That is credential lineage. Without it:

“Rotate this secret.”

can become:

“Break several production systems and find out who was using it.”

If the first time you test credential rotation is during an active breach, the process is not mature. A routine exercise should verify:

$$
\text{issue new credential}
$$

$$
\downarrow
$$

$$
\text{authorized workloads obtain it}
$$

$$
\downarrow
$$

$$
\text{old credential is revoked}
$$

$$
\downarrow
$$

$$
\text{service continues}
$$

This proves two things simultaneously:

$$
\text{Security control works}
$$

and:

$$
\text{operational dependency is understood}
$$

Suppose:

$$
K_1
$$

is compromised. Rotation produces:

$$
K_2
$$

But unless you also disable:

$$
K_1
$$

the attacker may continue using it. Therefore incident handling often requires:

$$
\boxed{\text{Issue replacement + revoke compromised authority}}
$$

For temporary credentials, expiration helps. But if the underlying identity or federation trust relationship is compromised, simply waiting for the current token to expire may be insufficient because the attacker could request another one. You must distinguish:

$$
\text{Credential compromised}
$$

from:

$$
\text{Identity compromised}
$$

and:

$$
\text{Trust relationship compromised}
$$

Those require different containment actions. Imagine all normal identity systems fail during a critical incident. You may need emergency administrative access. That is often called **break-glass access**. But a break-glass mechanism should not quietly become:

“The password everyone uses when IAM is annoying.”

Conceptually:

$$
BreakGlass
=
\text{High Authority}
+
\text{Rare Use}
+
\text{Strong Protection}
+
\text{Strong Monitoring}
+
\text{Post-use Review}
$$

Because it has high privilege, its use should itself be treated as a security event. Imagine migration proceeds like this:

$$
GitHubOIDC
\rightarrow
Cloud
$$

Excellent. But somebody keeps:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

in the repository's secret store:

“just in case.”

Now an attacker has two paths:

$$
\text{OIDC path}
$$

or:

$$
\text{old permanent key}
$$

Security tends to be determined by the easier path. So:

$$
\boxed{
\text{Strong new path}
+
\text{weak legacy fallback}
\approx
\text{weak system}
}
$$

This is why migration must include removal of static fallback credentials. After migrating to workload identity, deliberately remove the old secret. Then run the pipeline. If it breaks, something was still using static authentication. A useful governance test is:

$$
Delete(StaticCredential)
$$

followed by:

$$
PipelineStillWorks
$$

If yes, good evidence exists that federation is actually being used. You can go further and prohibit creation of unnecessary long-lived credentials through organizational policy. The desired architecture becomes:

$$
\boxed{
\text{Long-lived keys are difficult to create, not merely discouraged in documentation.}
}
$$

![Training, evaluation, release, and serving identities have distinct allowed and denied actions and pass immutable candidate, evidence, and release references between stages.](/content-assets/articles/article-mlops-governance-and-responsible-ai-secrets-credentials-in-ml-pipelines/pipeline-stage-identities.png)

*Separate stage identities prevent a compromised training or evaluation workload from granting production trust to its own output.*

## How Do Telemetry and Credential Incidents Reveal the Authority an Attacker Inherited?
<!-- section-summary: Logs preserve safe identity and decision evidence without credential material, and incident response determines the compromised secret, inherited authority, affected artifacts, releases, and serving actions. -->

Logs preserve safe identity and decision evidence without credential material, and incident response determines the compromised secret, inherited authority, affected artifacts, releases, and serving actions.

Suppose an API request fails and the program logs:

```text
Request failed:
Authorization: Bearer eyJhbGci...
```

Congratulations: your monitoring platform now stores a copy of the credential. The same can happen with:

```text
https://example.com?api_key=SECRET
```

environment dumps, stack traces, notebook output or debug messages. So:

$$
\text{Observability}
\rightarrow
\text{potential credential replication}
$$

The solution is not:

“Stop logging everything.”

Logs are essential for incident investigation. We instead want:

$$
\boxed{\text{Redact credential material while preserving security context.}}
$$

You generally want to know:

$$
\text{Who acted?}
$$

$$
\text{Which workload/job?}
$$

$$
\text{Which role?}
$$

$$
\text{Which resource?}
$$

$$
\text{Which action?}
$$

$$
\text{When?}
$$

$$
\text{Was it allowed or denied?}
$$

$$
\text{Which deployment/training run?}
$$

But you generally do not need:

$$
\text{raw bearer token}
$$

or:

$$
\text{password}
$$

or:

$$
\text{private key}
$$

So:

$$
\boxed{
\text{Security evidence}
\neq
\text{secret contents}
}
$$

Good telemetry preserves attribution without reproducing the credential. ML systems generate unusually large amounts of telemetry. Training might emit:

$$
10^6
\text{ log events}
$$

from hundreds of workers. If every worker logs an environment dump containing a secret, suddenly:

$$
1\text{ secret}
\rightarrow
1000\text{ copies}
$$

possibly across analytics systems, support exports, debugging tools and long-term archives. This brings us back to the original exposure model:

$$
Risk
\propto
\text{Number of Copies}
$$

Redaction must therefore happen as early as practical, not only in the final log viewer. Suppose investigators discover a leaked token. First ask:

$$
\boxed{\text{What exactly is it?}}
$$

Is it a short-lived access token?

A permanent API key A service-account private key A database password A signing key A CI OIDC trust configuration The containment response differs. For a single static API key:

$$
Revoke(K)
\rightarrow
Issue(K')
$$

For a workload identity compromise:

$$
Disable/Restrict(Identity)
$$

For a federation-policy compromise:

$$
Modify(TrustPolicy)
$$

For a private signing-key compromise:

$$
Revoke/ReplaceKey
\rightarrow
PossiblyReplaceCertificates
$$

Classification comes first. Possession of credential $$C$$ matters because of:

$$
Permissions(C)
$$

Suppose the leaked training credential could:

$$
Read(TrainingData)
$$

and:

$$
Write(CandidateModels)
$$

Now the incident has at least two dimensions. A possible confidentiality incident:

$$
TrainingData
\rightarrow
\text{possible exfiltration}
$$

and an integrity incident:

$$
CandidateArtifacts
\rightarrow
\text{possible tampering}
$$

So investigation must follow the credential's permissions. The crucial question is:

**What could someone possessing this credential actually have done?**

Suppose:

$$
TrainingIdentity
$$

was compromised between:

$$
10{:}00
$$

and:

$$
12{:}00
$$

During that time the pipeline generated:

$$
M_{31},M_{32},M_{33}
$$

Even if those artifacts appear to work normally, they may no longer have trustworthy provenance. Therefore:

$$
\text{Identity Compromise}
\rightarrow
\text{Artifact Trust Question}
$$

A sensible response may quarantine artifacts created during the affected period until they can be reconstructed or independently verified. This is where identity security connects directly to model governance. Suppose an attacker compromises:

$$
ReleaseIdentity
$$

which can promote candidate models into production. Now the critical questions become:

$$
\text{Which artifacts were approved?}
$$

$$
\text{Which deployments occurred?}
$$

$$
\text{Do deployed digests match legitimate approvals?}
$$

You may temporarily suspend release authority:

$$
Disable(ReleaseIdentity)
$$

while production continues using the last known-good model. This is one reason training, release and serving identities should be separate. Suppose the model-serving workload credential is stolen. Maybe it can read:

$$
\text{customer database}
$$

but cannot:

$$
\text{modify model registry}
$$

Then the primary risk may be confidentiality rather than model supply-chain integrity. Again:

$$
\boxed{
\text{Different workload}
\Rightarrow
\text{different permissions}
\Rightarrow
\text{different incident blast radius}
}
$$

Good identity design makes incident analysis much easier.

## What Does an End-to-End Pipeline and Governance Review Verify?
<!-- section-summary: The complete example assigns separate identities across data, training, registry, promotion, and serving, then tests what governance must verify before release and after compromise. -->

The complete example assigns separate identities across data, training, registry, promotion, and serving, then tests what governance must verify before release and after compromise.

Imagine this production pipeline:

$$
GitHub
\rightarrow
Training
\rightarrow
Evaluation
\rightarrow
Registry
\rightarrow
Release
\rightarrow
Serving
$$

### Source/CI identity

The approved GitHub workflow requests an OIDC assertion:

$$
GitHubOIDC
$$

The cloud verifies repository and environment conditions. It issues:

$$
TemporaryTrainingCredential
$$

No permanent cloud access key exists in GitHub. This follows the current GitHub OIDC model for obtaining temporary cloud access through federation. ([GitHub Docs][2])

### Training identity

The training workload obtains:

$$
Identity=training-job-518
$$

Its permissions are:

$$
Read(Dataset_{27})
$$

$$
Write(CandidateRegistry)
$$

but:

$$
\neg Approve
$$

and:

$$
\neg Deploy
$$

### Third-party dataset API

The vendor does not support federation. So:

$$
VendorAPIKey
$$

lives in the organization's secret manager. Only the data-ingestion identity can retrieve it. Training cannot.

### Evaluation identity

Evaluation receives another identity:

$$
evaluation-job-92
$$

which can read candidate artifacts and evaluation data but cannot modify training inputs.

### Release identity

After governance checks succeed:

$$
ReleaseService
$$

can promote the exact approved artifact digest. It cannot modify the source dataset.

### Serving identity

Production serving gets:

$$
ServingIdentity
$$

with:

$$
Read(ApprovedModels)
$$

and only the production data permissions required for inference. It cannot retrain or approve models. The result is:

$$
\boxed{
\text{Different authority at every stage}
}
$$

The attacker obtains its temporary credential. They can:

$$
Read(Dataset_{27})
$$

and perhaps:

$$
Write(CandidateArtifact)
$$

But the credential expires. The attacker cannot:

$$
ApproveArtifact
$$

cannot:

$$
DeployProduction
$$

and cannot:

$$
ReadProductionSecrets
$$

The compromise is still serious. But its **blast radius is bounded**. Compare that with:

```text
ML_ADMIN_KEY
```

stored everywhere. With that design:

$$
Compromise(Training)
\Rightarrow
Compromise(Everything)
$$

This difference is the entire reason identity architecture matters. The governance review should not merely contain a checkbox saying:

☑ Secrets are managed securely.

That tells us almost nothing. Instead, the evidence should establish relationships like these:

| Governance question                               | Evidence                             |
| ------------------------------------------------- | ------------------------------------ |
| What identity runs training                      | Workload identity configuration      |
| What can it access                               | IAM/RBAC policy                      |
| How does it authenticate                         | Federation/credential architecture   |
| Are permanent cloud keys required                | Credential inventory                 |
| How long do issued credentials last              | Token/role configuration             |
| Where are they accepted                          | Audience/trust conditions            |
| Can training deploy models                       | Negative permission test             |
| Can evaluation modify training data              | IAM test                             |
| Can serving approve artifacts                    | IAM test                             |
| Where are unavoidable secrets kept               | Secret-manager policy                |
| Which workload can retrieve each one             | Secret ACL                           |
| Are dynamic credentials available                | Database/API credential architecture |
| Can compromised credentials be revoked           | Revocation exercise                  |
| Does rotation actually work                      | Rotation test                        |
| Do logs expose credentials                       | Telemetry/redaction testing          |
| Does the federated path work without static keys | Static-fallback removal test         |
| Are emergency credentials controlled             | Break-glass procedure                |

Notice the emphasis on **evidence**. Responsible governance asks:

$$
\text{“Can we demonstrate the control?”}
$$

not merely:

$$
\text{“Did someone write the policy?”}
$$

## How Does Credential Design Support Responsible AI and Least Authority?
<!-- section-summary: Credential architecture supports Responsible AI by making least authority, separation of duties, traceability, revocation, and protection of data and artifacts enforceable. -->

Credential architecture supports Responsible AI by making least authority, separation of duties, traceability, revocation, and protection of data and artifacts enforceable.

Why is this a Responsible AI topic rather than simply IAM?

Because identity compromise can change the properties we normally call Responsible AI.

For example:

$$
\text{Training Credential Compromise}
\rightarrow
\text{Training Data Exfiltration}
\rightarrow
\boxed{\text{Privacy Harm}}
$$

or:

$$
\text{Training Credential Compromise}
\rightarrow
\text{Poisoned Data}
\rightarrow
\boxed{\text{Fairness/Safety Harm}}
$$

or:

$$
\text{Release Credential Compromise}
\rightarrow
\text{Unauthorized Model}
\rightarrow
\boxed{\text{Safety/Integrity Harm}}
$$

or:

$$
\text{Serving Credential Compromise}
\rightarrow
\text{Customer Records Exposed}
\rightarrow
\boxed{\text{Privacy Harm}}
$$

So:

$$
\boxed{
\text{Responsible AI assurance depends on trustworthy identities and authorization.}
}
$$

You cannot confidently claim:

“This is the approved fair model.”

if an unauthorized workload could replace it. Recall:

$$
\text{Credential Risk}
\propto
\text{Privilege}
\times
\text{Lifetime}
\times
\text{Distribution}
\times
\text{Acceptance Surface}
$$

Nearly every best practice follows naturally. To reduce **privilege**:

$$
\text{least privilege}
+
\text{separate training/evaluation/release identities}
$$

To reduce **lifetime**:

$$
\text{temporary tokens}
+
\text{dynamic credentials}
$$

To reduce **distribution**:

$$
\text{federation}
+
\text{secret manager}
+
\text{late delivery}
+
\text{no credentials baked into artifacts}
$$

To reduce **acceptance surface**:

$$
\text{audience binding}
+
\text{narrow trust conditions}
+
\text{network restrictions}
$$

And because no control is perfect:

$$
\text{rotation}
+
\text{revocation}
+
\text{telemetry}
+
\text{incident response}
$$

complete the system. The deepest mistake in ML credential management is thinking:

**“Our pipeline needs access, therefore we need to give it a secret.”**

Usually the better reasoning is:

$$
\boxed{
\text{Workload exists}
\rightarrow
\text{give it an identity}
}
$$

then:

$$
\boxed{
\text{Identity has a job}
\rightarrow
\text{give it minimum permissions}
}
$$

then:

$$
\boxed{
\text{Identity needs to authenticate}
\rightarrow
\text{give it short-lived proof}
}
$$

and only when some external system cannot support that architecture:

$$
\boxed{
\text{use a stored secret}
\rightarrow
\text{centralize}
\rightarrow
\text{scope}
\rightarrow
\text{deliver late}
\rightarrow
\text{rotate}
\rightarrow
\text{audit}
}
$$

The full mental model is:

$$
\boxed{
\begin{aligned}
\text{Workload Identity}\\
\downarrow\\
\text{Narrow Authorization}\\
\downarrow\\
\text{Short-Lived / Audience-Bound Credential}\\
\downarrow\\
\text{Minimum Resource Access}\\
\downarrow\\
\text{Auditable Action}\\
\downarrow\\
\text{Expiration or Revocation}
\end{aligned}
}
$$

And across an ML lifecycle:

$$
\boxed{
\text{Training Authority}
\neq
\text{Evaluation Authority}
\neq
\text{Release Authority}
\neq
\text{Serving Authority}
}
$$

The most useful principle to remember is therefore:

**A workload should not carry a permanent secret proving broad authority. It should prove what it is at the moment it needs access, receive only the authority required for that job, for as little time and in as few places as possible, and leave enough evidence behind for the organization to revoke, investigate, and recover if that authority is abused.**

That is the connection between **secrets and credentials, ML security, governance, and Responsible AI**.

![Six credential-path evidence gates verify fallback removal, federation claims, static-key prevention, allowed and denied authorization, audit evidence, and rotation, revocation, and recovery before release, with a separate incident-response path.](/content-assets/articles/article-mlops-governance-and-responsible-ai-secrets-credentials-in-ml-pipelines/credential-path-release-summary.png)

*A credential path is ready only when live federation works, forbidden access fails, static fallbacks are closed, audit evidence is present, and the team has rehearsed rotation, revocation, and recovery.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[How Do Identity, Permission, Credentials, and Secrets Differ in an ML Pipeline?]{kind="recap"}
Identity names an actor, permission defines allowed actions, a credential proves identity, and a secret is any confidential value whose exposure creates risk; ML pipelines multiply all four across long workflows.
:::

:::expand[How Do Workload Identity, Federation, Audience Binding, and Stage-Specific Roles Remove Static Credentials?]{kind="recap"}
Workload identity and federation exchange trusted runtime claims for short-lived credentials, bind tokens to a specific audience, and give each pipeline stage only the role it requires.
:::

:::expand[How Should Unavoidable Secrets Be Stored, Delivered, Scoped, and Replaced with Dynamic Credentials?]{kind="recap"}
Unavoidable secrets remain in a managed store, arrive as late as possible to the smallest process, and give way to scoped dynamic credentials that limit shared fate.
:::

:::expand[How Do Keys, Certificates, Encryption, Local Development, and Third-Party APIs Require Different Boundaries?]{kind="recap"}
Signing keys, certificates, access credentials, and encryption keys serve different purposes, while development and supplier APIs retain the same boundary and least-authority requirements.
:::

:::expand[How Should Rotation, Expiration, Revocation, Break-Glass Access, Migration, and Verification Work?]{kind="recap"}
Expiration ends validity, rotation changes material, revocation removes authority, break-glass access is exceptional, and migration is incomplete until old static paths are removed and the new path is tested.
:::

:::expand[How Do Telemetry and Credential Incidents Reveal the Authority an Attacker Inherited?]{kind="recap"}
Logs preserve safe identity and decision evidence without credential material, and incident response determines the compromised secret, inherited authority, affected artifacts, releases, and serving actions.
:::

:::expand[What Does an End-to-End Pipeline and Governance Review Verify?]{kind="recap"}
The complete example assigns separate identities across data, training, registry, promotion, and serving, then tests what governance must verify before release and after compromise.
:::

:::expand[How Does Credential Design Support Responsible AI and Least Authority?]{kind="recap"}
Credential architecture supports Responsible AI by making least authority, separation of duties, traceability, revocation, and protection of data and artifacts enforceable.
:::

## References

[1]: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html "Security best practices in IAM - AWS Identity and Access Management"
[2]: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers "Configuring OpenID Connect in cloud providers - GitHub Docs"
[3]: https://docs.github.com/en/actions/reference/security/oidc "OpenID Connect reference - GitHub Docs"
[4]: https://kubernetes.io/docs/concepts/security/service-accounts/ "Service Accounts | Kubernetes"
[5]: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/?source=post_page-----abdd748c8ad6-------------------------------- "Configure Service Accounts for Pods | Kubernetes"
[6]: https://learn.microsoft.com/en-us/azure/key-vault/secrets/secure-secrets "Secure your Azure Key Vault secrets | Microsoft Learn"
[7]: https://developer.hashicorp.com/vault/docs/secrets/databases "Database secrets engine | Vault | HashiCorp Developer"
[8]: https://docs.cloud.google.com/kms/docs/envelope-encryption "Envelope encryption  |  Cloud Key Management Service  |  Google Cloud Documentation"
