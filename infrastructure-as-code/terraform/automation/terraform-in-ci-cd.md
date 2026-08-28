---
title: "Terraform in CI/CD"
description: "Build a Terraform pipeline that gathers evidence, verifies its target, applies an approved saved plan, serializes state writers, and preserves an audit trail."
overview: "Shared infrastructure should change through a reviewed, reproducible process rather than hidden laptop context. This article derives a CI/CD pipeline from progressively stronger evidence: formatting, validation, testing, target verification, an exact saved plan, policy, approval, protected apply, locking, and operational verification."
tags: ["terraform", "ci-cd", "automation", "saved-plan", "state-locking"]
order: 2
id: article-iac-terraform-automation-cicd
---

## Table of Contents

1. [Why Are Laptop Applies Risky for Shared Infrastructure?](#why-are-laptop-applies-risky-for-shared-infrastructure)
2. [How Does a Pipeline Build Stronger Evidence?](#how-does-a-pipeline-build-stronger-evidence)
3. [Why Must a Plan Include Its Target Context?](#why-must-a-plan-include-its-target-context)
4. [How Does a Saved Plan Connect Review to Apply?](#how-does-a-saved-plan-connect-review-to-apply)
5. [Where Do Approval and Credentials Create a Boundary?](#where-do-approval-and-credentials-create-a-boundary)
6. [How Do State Locking and Concurrency Protect Applies?](#how-do-state-locking-and-concurrency-protect-applies)
7. [What Evidence and Rollback Information Should Remain?](#what-evidence-and-rollback-information-should-remain)
8. [What Does a Complete Terraform Pipeline Look Like?](#what-does-a-complete-terraform-pipeline-look-like)
9. [Check Your Answers](#check-your-answers)

The guiding principle is that shared infrastructure should change because a reviewed, reproducible process authorized a specific transition—not because one laptop happened to contain a particular directory, state selection, credential, plugin cache, and set of environment variables.

A developer can run:

```bash
terraform init
terraform plan
terraform apply
```

Those commands are useful for learning and for appropriately controlled local work. For shared production infrastructure, many facts sit outside the source diff:

```text
working directory
selected backend and workspace
local state or remote state credentials
variable files and environment variables
provider plugin versions
cloud account and role
uncommitted local changes
who reviewed the plan
whether another apply is running
what happened after completion
```

Two people can run the same command from the same commit and target different infrastructure because their credentials, backend selection, or variables differ. A local plugin cache or uncommitted file can also change behavior that reviewers never saw.

Keep these questions in view as you work through the lesson:

1. **Why Are Laptop Applies Risky for Shared Infrastructure?**
2. **How Does a Pipeline Build Stronger Evidence?**
3. **Why Must a Plan Include Its Target Context?**
4. **How Does a Saved Plan Connect Review to Apply?**
5. **Where Do Approval and Credentials Create a Boundary?**
6. **How Do State Locking and Concurrency Protect Applies?**
7. **What Evidence and Rollback Information Should Remain?**
8. **What Does a Complete Terraform Pipeline Look Like?**

## Why Are Laptop Applies Risky for Shared Infrastructure?
<!-- section-summary: A laptop apply depends on invisible local context and can bypass shared review, evidence, identity, and concurrency controls. -->

The ideal infrastructure change has a traceable statement:

```text
Commit:          reviewed revision
Root:            payments production stack
Cloud account:   production
Region:          intended region
State:           payments production state
Variables:       production set
Plan:            exact reviewed actions
Policy:          passed
Reviewer:        approved
Apply identity:  production deployment role
Result:          verified
```

CI/CD is valuable because it assembles that context in a repeatable environment and places authorization gates between evidence and mutation. It does not make Terraform intrinsically safer; a poorly protected pipeline can automate mistakes faster. The pipeline itself becomes production infrastructure whose workflow code, runners, identities, artifacts, and environment settings need review.

The goal is not to ban every local plan. Developers should get fast feedback before opening a pull request. The high-risk boundary is production write authority. A local machine can format, validate, test, and often create a speculative plan under restricted credentials, while an approved pipeline owns production apply.

## How Does a Pipeline Build Stronger Evidence?
<!-- section-summary: Pipeline stages move from cheap source checks to target-aware planning, policy, approval, exact execution, and runtime verification. -->

A good pipeline orders checks by cost, authority, and evidentiary strength:

```text
source
  -> formatting
  -> initialization without unnecessary backend access
  -> validation
  -> static analysis and tests
  -> initialize intended backend
  -> verify target identity
  -> plan against intended state
  -> policy evaluation
  -> human approval
  -> apply exact plan
  -> verify outcome
```

Cheap failures should happen before production credentials or locks are acquired. Formatting answers whether files follow Terraform's canonical style. Validation answers whether configuration is syntactically and internally consistent. Module tests and linters answer additional contract and provider-awareness questions.

These layers do not replace the plan. A formatted, valid configuration can still delete a production database. A plan is the first stage that combines the root configuration, variables, provider schemas, selected state, and current remote information into proposed actions for a particular target.

Pull-request pipelines should mostly gather evidence. They can run:

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
terraform test
```

For a deployable root, the pipeline then initializes the intended backend and produces a speculative or saved plan as appropriate. Pull requests should not gain production write authority merely to show what a change would do. Plan credentials can often use read access plus narrowly required operations.

Evidence becomes progressively stronger but more expensive:

| Stage | Main proposition |
|---|---|
| `fmt` | Source follows canonical formatting |
| `validate` | Configuration is structurally valid |
| tests and lint | Module contracts and known rules hold |
| plan | Terraform proposes these actions for this target now |
| policy | Proposed actions satisfy organizational rules |
| approval | An authorized reviewer accepts the evidence |
| apply | The approved actions are attempted |
| verification | The resulting system meets operational expectations |

The sequence avoids asking a weak check to answer a stronger question. Formatting should not discover a database deletion, and a plan should not be presented as proof that the application will serve traffic correctly.

Pull-request evidence should be reproducible by another reviewer. Pin the Terraform version, install providers from the committed lock file, and run from a clean checkout. If the repository contains several roots, detect which deployable stacks a change can affect and plan each under its declared target rather than running one command from the repository root.

Module changes may affect several callers. A source-only validation of the module proves its internal consistency, while representative root plans show how existing states would react to the new module code. The pipeline can limit the matrix to known consumers or publish a dependency map, but it should not imply that one module test proves every deployment plan.

Tests and policy have different roles. A Terraform test can assert the module's intended output for supplied inputs. A policy can reject a prohibited outcome across many repositories. Both run before apply, and neither makes the selected state or provider account irrelevant. They strengthen the evidence chain without replacing target verification.

Fast feedback also belongs on developer machines. A pre-commit hook can run formatting and validation, while CI repeats them in a trusted environment. Repetition is intentional: local checks shorten feedback, and the protected pipeline creates evidence that does not depend on one person's workstation.

## Why Must a Plan Include Its Target Context?
<!-- section-summary: A Terraform plan is meaningful only with the state, variables, credentials, provider context, configuration, and dependency versions that produced it. -->

Suppose a plan says one bucket will be created. Is it development or production? Which account? Which state key? Which region? Which variable set? The resource name alone cannot answer reliably.

The pipeline should print a target record beside the plan:

```text
Environment: production
Stack:       payments-api
Account:     expected production account ID
Region:      eu-west-2
State:       payments-api/prod
Root:        live/prod/eu-west-2/payments-api
Commit:      reviewed SHA
```

The general equation is:

```text
plan meaning = configuration
             + selected state
             + variables
             + provider and module code
             + authenticated API context
             + current remote observations
```

Setting `environment = "prod"` is not proof of target. It may only change tags and names. The provider could still be authenticated to a development account. Mature pipelines query and verify the real account or project identifier before planning and again before applying.

Terraform cannot verify every identity relationship automatically. If planning and applying use different credentials, they could point at different accounts that contain similarly named resources. The pipeline must enforce that plan and apply contexts agree.

Backend identity matters separately. A production provider role combined with development state can create development-addressed resources inside production. Display the backend key or workspace, and bind it to the same stack definition that supplies the expected account and root directory.

One declared target mapping is safer than separately typed values in each job. A stack record can map `payments-prod` to its root, backend key, region, variable set, plan role, apply role, and expected account. Both jobs resolve that record and reject mismatches.

The plan should also identify dependency inputs: Terraform CLI version, `.terraform.lock.hcl`, installed providers, and remote module revisions. These are executable code that affects proposed actions. A clean runner reduces dependence on a developer's cached packages.

Target verification should fail closed. If the identity command returns an unexpected account, the job must stop before plan or apply. If the backend key cannot be derived from the declared stack, the job should not guess. If a required variable set is missing, using Terraform defaults may be more dangerous than failing.

The plan summary should be paired with the full rendered diff. Counts compress meaning: one deletion can be more important than hundreds of tag updates. Automation can highlight action categories without hiding the underlying plan. Reviewers should be able to follow resource addresses, replacement reasons, unknown values, and output changes.

Unknown values deserve special treatment. A plan can contain attributes that will be known only after apply. That is normal, but policy and reviewers must not silently treat unknown as compliant. A critical rule may need to reject or defer the proposal until the value can be established, while a lower-risk rule may allow it with explicit review.

Target context should travel with the artifact, not only appear in a transient log. Store a small manifest containing the commit, root, state identifier, workspace, account, region, Terraform version, provider lock checksum, plan checksum, and creation time. The apply job verifies the manifest before obtaining write credentials.

## How Does a Saved Plan Connect Review to Apply?
<!-- section-summary: Saving a plan creates an executable artifact so approval can attach to the exact Terraform decision later applied. -->

Consider this sequence:

```text
10:00 terraform plan
10:05 reviewer approves the displayed output
10:06 terraform apply
```

Plain `terraform apply` calculates a new plan. The configuration, state, remote infrastructure, variables, credentials, or provider environment may have changed between review and execution. The newly calculated decision is not necessarily the artifact the reviewer accepted.

Save the plan instead:

```bash
terraform plan -out=tfplan
terraform show -no-color tfplan > tfplan.txt
```

After approval, execute it directly:

```bash
terraform apply tfplan
```

This establishes a strong invariant:

> The artifact approved is the artifact executed.

The binary plan contains more than pretty terminal output. It represents proposed operations based on configuration, state, variable values, provider selections, and planning results. The text rendering is for review; the binary artifact is the input to apply.

Saved plans have operational constraints. Plan and apply runners should use compatible Terraform versions, operating system and CPU architecture, configuration, and identical provider packages. Commit the dependency lock file and preserve the plan's execution environment rather than recreating it loosely.

The artifact is sensitive. A plan can contain values that terminal output redacts, and JSON or machine-readable rendering can expose them. Restrict access, encrypt storage and transport, use short retention, and avoid posting unfiltered plan JSON to public logs or pull-request comments.

State may change after planning. Locking during the plan does not normally reserve the state until a later approval. Another apply can update the state or remote infrastructure. Terraform checks the saved plan at apply and may reject stale assumptions, but the pipeline should minimize the delay and decide whether production needs a fresh post-merge plan.

Planning after merge is often valuable because it uses the exact revision on the protected branch and the latest target state. The pull-request plan supplies review evidence; the post-merge saved plan becomes the deployment decision, which can receive a final approval.

There are two legitimate plan types. A speculative plan answers what the current configuration appears likely to do and is useful during pull-request review. A saved plan created with `-out` is intended for later execution. Calling both “the plan” without distinguishing their purpose can make reviewers believe a PR preview is the exact deployment artifact when the release job will calculate another decision.

If a final plan is recalculated after merge, show the difference from the pull-request evidence. The protected branch may contain intervening commits or newer state. Approval should attach to the final saved plan, not to a stale preview. For low-risk automated changes, policy may provide the authorization; for production changes, a human gate can review the final risk summary.

Applying a saved plan avoids a new planning decision, but remote APIs can still reject operations. Quotas, eventual consistency, permissions, and concurrent non-Terraform changes can produce failures. Exact-plan execution means Terraform attempts the approved operations; it is not a guarantee that every provider call succeeds.

Plans should expire operationally. A plan waiting for days is increasingly likely to be stale and to carry credentials, assumptions, or dependencies no longer acceptable. Set an approval window, delete expired artifacts, and require a fresh plan when the window closes.

## Where Do Approval and Credentials Create a Boundary?
<!-- section-summary: Approval belongs after a complete target-aware plan, and the apply identity should be available only inside the protected deployment stage. -->

Approval is meaningful only when reviewers can see what they are approving. It should sit after formatting, tests, target verification, the saved plan, and policy checks, but before production write authority is used.

Reviewers should look beyond action counts. A plan with “1 to add, 1 to destroy” might represent a routine replacement or destruction of a critical database. Highlight deletes, replacements, identity-policy changes, networking changes, and blast-radius increases.

A protected apply is an authorization boundary:

```text
untrusted or ordinary PR job
    no production write credentials
        |
        v
evidence and saved plan
        |
        v
protected environment approval
        |
        v
short-lived production apply role
        |
        v
apply exact plan
```

CI credentials should belong to the pipeline identity, not to a person's laptop or a shared permanent key. OIDC can exchange a signed workflow token for short-lived cloud credentials. Trust conditions narrow which repository, branch, or protected environment may assume the role; permission policies narrow what the resulting session may do.

Plan and apply can use separate roles. A planning role may read state and remote resources. The apply role adds the write operations required by that stack and becomes available only after approval. Both jobs must verify they target the same account and state context.

Protect more than the approval button. Workflow files, reusable actions, runner images, environment secrets, role trust policies, branch protections, artifact storage, and who can modify them all influence the deployment boundary. A user who can alter the workflow before approval may be able to exfiltrate credentials or replace the reviewed plan.

Least privilege should be per stack where practical. A payments deployment role does not automatically need organization-wide identity, network, and database administration. Short-lived credentials reduce exposure time; narrow action and resource policies reduce blast radius.

Approval should record which risk was accepted. A reviewer may approve a normal in-place tag update but reject a replacement or deletion. If the plan changes, the old approval no longer applies. A cryptographic checksum or artifact identity helps connect the human decision to the binary later executed.

Production environments can require multiple controls: protected branch, protected deployment environment, required reviewers, a narrow OIDC trust subject, and an apply role unavailable to pull requests from forks. No single control should be presented as the whole boundary.

The plan job should not persist credentials inside the saved artifact or workspace. Remove temporary tokens and local backend files after use, and avoid uploading the `.terraform/` directory as a convenience cache. Cache provider packages carefully if needed, but treat executable cache poisoning as a supply-chain risk.

Runner trust matters as much as cloud trust. A self-hosted runner with broad network and filesystem access can retain artifacts or credentials after the job. Ephemeral runners reduce cross-job residue. Hosted or self-hosted, the runner image and actions used before credentials are issued should be pinned and reviewed.

## How Do State Locking and Concurrency Protect Applies?
<!-- section-summary: Backend locking protects one state from concurrent writers, while pipeline concurrency coordinates the broader workflow for that state boundary. -->

Terraform state makes concurrent applies dangerous. Two runs can read the same starting state, calculate separate changes, and race to update remote objects and write a new state snapshot.

A backend lock is the first defense:

```text
run A acquires state lock
run B attempts same state and waits or fails
run A applies and writes state
run A releases lock
run B can refresh and calculate from the new state
```

Use a remote backend that supports collaboration and locking. Do not disable locking to make a blocked job pass. The lock is evidence that another writer may be changing the ownership record; bypassing it can corrupt coordination.

Locking is not the entire deployment scheduler. A lock usually exists for active Terraform operations, not for the hours between planning, approval, and apply. It does not serialize non-Terraform changes, external deployment controllers, or two different states that affect a shared platform constraint.

Pipeline concurrency can allow only one deployment workflow per state boundary:

```text
concurrency key = environment + stack or state identifier
```

The key should not be global unless every stack truly must wait. Independent states can usually deploy concurrently. Two workflows targeting the same state should serialize even if they came from different branches or repositories.

Avoid canceling an apply midway merely because a newer commit arrived. Provider operations may already have happened, and abrupt cancellation does not provide transactional rollback. Let the current writer reach a known outcome, then plan the next change against the resulting state.

Remote state is therefore a team coordination primitive: it centralizes ownership, locking, and recovery. Pipeline concurrency surrounds that primitive with job-level sequencing. Cloud APIs and runtime controllers still have their own concurrency behavior, so operations must remain idempotent and observable.

State locks should have bounded waiting and an escalation process. A job can use `-lock-timeout` to wait for an ordinary concurrent operation. If the lock remains, inspect the backend and the run that owns it. Force-unlocking without proving the owner is gone risks admitting a second writer while the first is still active.

Pipeline concurrency and backend locking protect different time windows. A concurrency group can cover planning, approval, and applying so a newer deployment does not overtake an older approved plan. The backend lock then protects actual state operations. If approvals may remain open for a long time, teams may instead allow concurrent planning and require a fresh serialized final plan after approval.

“One at a time” should be scoped by state. A network state and an unrelated documentation-site state need not block each other. However, two states can still share a deployment constraint such as an organization policy or global DNS name. Add a broader concurrency key only when that external relationship truly requires serialization.

After a failed apply, leave the lock workflow intact. Terraform normally releases its lock when it exits cleanly, but a crashed runner may leave recovery work. Inspect current state, cloud operations, and lock ownership before retrying. A blind rerun can repeat non-idempotent provider behavior or calculate from misunderstood partial results.

## What Evidence and Rollback Information Should Remain?
<!-- section-summary: Preserve enough evidence to reconstruct the decision and outcome, while recognizing that evidence does not itself reverse a failed infrastructure change. -->

A deployment record should retain:

```text
configuration commit and pull request
root directory and target stack
backend key or workspace
cloud account, region, and execution role
Terraform and provider versions
variable-set identity, without exposing secrets
saved-plan checksum and review rendering
plan summary and highlighted risky actions
policy results and approved exceptions
reviewer and approval time
apply logs and final result
post-apply verification
```

Retention must balance audit needs with artifact sensitivity. Binary plans, JSON plans, state-derived output, and provider logs can contain confidential data. Store them under restricted access and delete them according to policy rather than keeping every artifact publicly forever.

Evidence is not rollback. Terraform apply is not a transaction that automatically reverses completed remote operations when a later step fails. Returning source code to an earlier commit creates another desired-state proposal; it does not restore deleted data or necessarily reverse an incompatible provider change.

An infrastructure rollback normally means making a deliberate follow-up change, planning it against current state, reviewing its consequences, and applying it. Critical systems also need backups, provider-native recovery, and tested runbooks.

Application rollback may be separate. If infrastructure supports blue/green routing, the fastest response to a bad release can be moving traffic back to the healthy generation while Terraform is reconciled afterward. Database migrations require their own compatibility and recovery plan.

The pipeline should record a rollback note before production apply: previous version or values, quickest safe traffic action, data-recovery dependency, person authorized to act, and how Terraform state will be reconciled after users are safe.

Post-apply verification should be specific to the change. A storage policy change can query the resulting policy, a fleet rollout can inspect health and version convergence, and a network change can run connectivity checks from an appropriate boundary. “Apply succeeded” is one fact; service correctness is a different fact.

Evidence should include failed runs too. A partial apply may have changed resources and written an updated state before returning an error. Preserve the error, refresh current state, identify completed operations, and create the recovery plan from reality. Deleting the failed run's logs removes exactly the information needed during an incident.

Rollback notes should avoid promising reversibility that the platform cannot provide. Deleting a database, rotating a key, shrinking retention, or applying an incompatible schema can lose information. For those changes, prevention, backups, restore tests, and forward-compatible migration matter more than reverting a variable.

## What Does a Complete Terraform Pipeline Look Like?
<!-- section-summary: A complete pipeline separates evidence gathering from protected execution and maintains target, artifact, and state invariants throughout. -->

A generic pull-request phase is:

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
terraform test

# For the intended deployable root under read-oriented identity:
terraform init -backend-config="$BACKEND_CONFIG"
terraform plan -out=tfplan
terraform show -no-color tfplan
```

The job verifies account and state context, evaluates policy, highlights risk, protects the plan artifact, and publishes review evidence without production apply credentials.

After merge or in a protected deployment job, create or select the final plan from the exact protected revision, then place approval before apply:

```bash
terraform init -backend-config="$BACKEND_CONFIG"
terraform plan -out=tfplan
terraform show -no-color tfplan

# Protected approval happens outside Terraform.

terraform apply tfplan
```

After apply, query relevant cloud and application signals and save the result. A successful Terraform exit proves the provider operations completed according to Terraform; it does not prove the service is healthy.

Protect these invariants:

```text
The reviewed commit is the planned commit.
The displayed target is the actual backend and provider target.
The approved plan is the applied plan.
Plan and apply environments are compatible.
Only the protected stage obtains production write authority.
Only one writer operates per state boundary.
Locks are never bypassed to force progress.
Plan and state artifacts remain confidential.
The outcome is verified after apply.
Failures create a new recovery decision, not an assumed transaction rollback.
```

CI/CD is ultimately an authorization and evidence system around Terraform. Terraform supplies declarative planning, state coordination, and provider operations. The pipeline decides which source is trusted, which target is intended, which identity may act, which plan was approved, when concurrent work is safe, and whether the result is acceptable.

Bind approval to an immutable plan artifact and the exact commit, backend, workspace, runtime, provider lock, variables, and short-lived identity that produced it. If any of those inputs change, regenerate the plan rather than applying stale evidence. Separate pull-request validation from protected mutation authority, serialize deployments per state boundary, censor plan artifacts that may contain sensitive values, and verify service behavior after apply. CI improves safety only when it makes scope and authorization explicit rather than automating a broad apply command.

## Check Your Answers

:::expand[Why Are Laptop Applies Risky for Shared Infrastructure?]{kind="recap"}
A laptop carries hidden directory, state, variable, credential, dependency, and concurrency context that shared reviewers and audit systems may never see.
:::

:::expand[How Does a Pipeline Build Stronger Evidence?]{kind="recap"}
Run cheap source checks first, then target-aware plan, policy, approval, exact apply, and runtime verification. Each layer answers a stronger question.
:::

:::expand[Why Must a Plan Include Its Target Context?]{kind="recap"}
A plan only has meaning with its root, state, variables, dependencies, authenticated account, provider context, configuration, and current remote observations.
:::

:::expand[How Does a Saved Plan Connect Review to Apply?]{kind="recap"}
The binary saved plan is executable input. Protect it and apply it directly so the reviewed Terraform decision is the one executed.
:::

:::expand[Where Do Approval and Credentials Create a Boundary?]{kind="recap"}
Approval follows complete evidence, and only the protected apply stage receives a short-lived, narrowly trusted production identity.
:::

:::expand[How Do State Locking and Concurrency Protect Applies?]{kind="recap"}
Backend locks serialize Terraform writers for one state; pipeline concurrency coordinates the longer workflow around that same state boundary.
:::

:::expand[What Evidence and Rollback Information Should Remain?]{kind="recap"}
Record target, identity, plan, approval, apply, and verification while protecting sensitive artifacts. Recovery requires a new decision because apply is not transactional rollback.
:::

:::expand[What Does a Complete Terraform Pipeline Look Like?]{kind="recap"}
Separate evidence from write authority and preserve commit, target, exact-plan, environment, state-writer, confidentiality, and post-apply verification invariants.
:::

---

**References**

- [Terraform CLI: plan](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Terraform CLI: apply](https://developer.hashicorp.com/terraform/cli/commands/apply)
- [Terraform: Running in automation](https://developer.hashicorp.com/terraform/tutorials/automation/automate-terraform)
- [Terraform: State locking](https://developer.hashicorp.com/terraform/language/state/locking)
- [Terraform: Remote state](https://developer.hashicorp.com/terraform/language/state/remote)
- [Terraform: Dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock)
- [Terraform: Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)
