---
title: "What Is Terraform State?"
description: "Why Terraform keeps a state file, what it stores, and why it is the most important file in your infrastructure project."
overview: "Terraform state connects resource blocks in your .tf files to real infrastructure objects. This article starts with one bucket, then follows how Terraform remembers it, compares it during the next plan, and protects the record that makes future changes safe."
tags: ["state", "terraform.tfstate", "terraform", "infrastructure"]
order: 1
id: article-iac-terraform-state-what-is-state
aliases:
  - infrastructure-as-code/terraform/state-and-plans/what-is-state.md
---

## Table of Contents

1. [What Problem Does Terraform State Solve?](#what-problem-does-terraform-state-solve)
2. [How Do Configuration, State, Reality, and Plan Differ?](#how-do-configuration-state-reality-and-plan-differ)
3. [What Does State Store?](#what-does-state-store)
4. [How Does a Plan Use State and Refresh Reality?](#how-does-a-plan-use-state-and-refresh-reality)
5. [How Do Import, State Removal, and Destroy Use Bindings?](#how-do-import-state-removal-and-destroy-use-bindings)
6. [Why Do Teams Need Remote State and Locking?](#why-do-teams-need-remote-state-and-locking)
7. [How Should You Inspect and Protect State?](#how-should-you-inspect-and-protect-state)
8. [How Does State Follow a Resource Through Its Lifecycle?](#how-does-state-follow-a-resource-through-its-lifecycle)
9. [Check Your Answers](#check-your-answers)

Terraform state is the durable record that binds logical resource instances in configuration to real remote objects.

Suppose configuration declares:

```hcl
resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
}
```

After apply, AWS returns an identity such as `i-0abc123`. Terraform must remember that the logical address `aws_instance.web` means that exact remote server.

```text
aws_instance.web
       │ state binding
       ▼
i-0abc123
```

Without the binding, the next run sees HCL and thousands of EC2 instances but cannot reliably infer which one belongs to this address. Display names may be absent, duplicated, changed manually, or unsupported. Re-querying every object cannot recreate the missing intent.

State solves more than identity lookup. It records provider-returned attributes, metadata used by planning, module and instance addresses, outputs, and enough historical information to compare desired configuration with the object Terraform already manages.

Keep these questions in view as you work through the lesson:

1. **What Problem Does Terraform State Solve?**
2. **How Do Configuration, State, Reality, and Plan Differ?**
3. **What Does State Store?**
4. **How Does a Plan Use State and Refresh Reality?**
5. **How Do Import, State Removal, and Destroy Use Bindings?**
6. **Why Do Teams Need Remote State and Locking?**
7. **How Should You Inspect and Protect State?**
8. **How Does State Follow a Resource Through Its Lifecycle?**

## What Problem Does Terraform State Solve?

![State maps Terraform's logical address to one real remote identity](/content-assets/articles/article-iac-terraform-state-what-is-state/state-snapshot-map.png)

Think of state as Terraform's operational database rather than a disposable cache. The default local representation is often `terraform.tfstate`, but the underlying concept can live in a remote backend rather than a file you manage directly.

The primary purpose remains one-to-one identity mapping. Terraform expects one configured resource instance to bind to one remote object. Duplicate bindings or a missing identity record make lifecycle decisions ambiguous or unsafe.

## How Do Configuration, State, Reality, and Plan Differ?

Keep four worlds separate:

```text
configuration
└── what should exist

state
└── what Terraform remembers and manages

remote reality
└── what the provider can observe now

plan
└── the proposed transition after comparison
```

State is not desired configuration. A JSON record that says the instance was `t3.micro` does not declare that it should stay that size; the HCL does. State is also not guaranteed current reality. Someone can resize the server in AWS after the last apply, leaving state's previous snapshot stale until refresh.

The planning model is:

```text
configuration + prior state + refreshed reality
                     │
                     ▼
             proposed operations
```

The provider is necessary because state alone cannot prove what exists now. Conversely, the provider's remote API cannot know that `i-0abc123` belongs to the logical address `aws_instance.web`. State connects the naming systems, configuration supplies the goal, and refresh supplies the current observation.

Deleting configuration, deleting state, and deleting a cloud object therefore have different meanings. Each changes one world. Terraform reasons about the resulting differences rather than treating any one layer as the complete truth.

## What Does State Store?

A simplified state representation can contain:

```json
{
  "resources": [
    {
      "type": "aws_instance",
      "name": "web",
      "instances": [
        {
          "attributes": {
            "id": "i-0abc123",
            "instance_type": "t3.micro",
            "private_ip": "10.0.1.27"
          }
        }
      ]
    }
  ]
}
```

The exact internal format is Terraform-managed and not a public editing interface, but its categories explain planning.

**Resource identity** connects an address and provider ID. Addresses include module paths and instance keys:

```text
aws_instance.web
aws_instance.web[0]
aws_instance.web["api"]
module.application.aws_instance.web
```

**Resource attributes** include configured and provider-computed values such as IDs, ARNs, IP addresses, regions, and tags. Terraform can compare or expose them later.

**Dependency and lifecycle metadata** helps Terraform retain relationships, provider ownership, and replacement information. A replacement may temporarily leave a deposed old instance while the new instance takes the primary address.

**Provider information** identifies which provider configuration and schema interpret the stored object.

**Outputs and other metadata** preserve root results for later `terraform output` queries and record state bookkeeping such as serial or lineage information.

State can contain passwords, tokens, private material, connection strings, and other values returned or accepted by providers. `sensitive = true` normally redacts presentation; it does not guarantee absence from state. Saved plan files can also contain sensitive planned data.

The file is not meant for manual edits. Terraform state commands and backend operations preserve metadata and safety rules that a text editor can easily break.

With the default local backend, the project may contain `terraform.tfstate` and sometimes a backup file. The JSON is intended for Terraform, so its internal shape can evolve. Do not build automation that depends on hand-parsing undocumented internals when the CLI, machine-readable show output, backend APIs, or Terraform interfaces provide an appropriate route.

The database analogy helps explain why several categories live together. A database table might store a primary key, columns, relationships, and transaction metadata. State stores the logical primary key—the resource instance address—plus remote identity, known attributes, provider ownership, dependencies, and output records needed for future operations. The provider can then read the remote row, in effect, and reconcile its current values.

Collection instances show why a block name alone is insufficient. `aws_instance.web` may denote a resource block, while `aws_instance.web[0]` and `aws_instance.web[1]` are distinct instances under `count`. With `for_each`, keys such as `aws_instance.web["api"]` identify individual bindings. Changing indexes or keys can change identity even when the resource block remains.

Module paths extend the same namespace. `module.network.aws_vpc.main` and `module.application.aws_instance.web` belong to separate encapsulated configurations but remain globally distinguishable in the root state. Moving a resource across module boundaries changes its address and must preserve identity deliberately.

Outputs illustrate persistence without remote object identity. A root output is not an AWS resource, yet its applied value is stored so `terraform output` can retrieve it later. This is another reason state contains more than a cache of resource IDs.

## How Does a Plan Use State and Refresh Reality?

A normal plan follows four conceptual steps.

First, load configuration:

```text
aws_instance.web should exist
instance_type should be t3.large
```

Second, load state:

```text
aws_instance.web is bound to i-0abc123
previously recorded type was t3.micro
```

Third, ask the provider to read `i-0abc123` from the remote API. Suppose reality still reports `t3.micro`.

Fourth, compare the refreshed managed object with configuration and propose the appropriate update or replacement.

![A plan connects configuration, prior state, provider refresh, and the proposed transition](/content-assets/articles/article-iac-terraform-state-what-is-state/plan-state-refresh-loop.png)

If someone manually changes AWS to `t3.large`, state may remain stale until the next refresh. The plan can then observe drift and determine whether configuration wants to keep the manual change or restore the declared value.

Unknown or stale state is not automatically authoritative over reality. Terraform uses the binding to locate the remote object, refreshes current attributes where normal planning permits, and updates its reasoning from that observation.

A refresh-only plan or apply is available when you deliberately want to update Terraform's recorded state and outputs to match out-of-band remote changes without modifying infrastructure:

```bash
terraform plan -refresh-only
terraform apply -refresh-only
```

Review it carefully. Refresh-only accepts reality into Terraform's memory; it does not make configuration the new source of desired values by itself.

Resource addresses are central throughout. Renaming `aws_instance.web` to `aws_instance.frontend` changes logical identity even if the remote ID stays the same. A `moved` block can tell Terraform that the address moved rather than that one object disappeared and another should be created.

Consider configuration deletion in detail. Yesterday, configuration and state both contained `aws_instance.web`, and state bound it to `i-0abc123`. Today the block is removed. Refresh can still inspect the remote object because state remembers the ID. Terraform compares “managed object present” with “desired declaration absent” and proposes destroy. The action is not inferred by scanning AWS for unused servers; it comes from the binding that survived the source edit.

Now consider remote deletion. Configuration and state still contain the address, but the provider reports that `i-0abc123` no longer exists. Terraform can propose recreation because desired configuration says the logical instance should be present. Again, state identifies which object was expected and refresh reveals that reality diverged.

If only an attribute drifts, the plan can show the externally changed value and the configured target. The team then chooses whether to restore configuration through apply or update HCL to accept the new desired value. State enables detection, but configuration remains the declared intent.

Refresh-only is appropriate when the organization intentionally changed remote infrastructure outside Terraform and wants state and outputs to acknowledge that current reality without asking Terraform to alter it. It should not become a habit for silently accepting unexplained drift. Review what changed, why it changed, and whether configuration also needs an update.

This four-way comparison explains why a state snapshot can be both essential and stale. Essential: it contains the identity map. Stale: remote attributes can change after it was written. Normal planning combines the durable binding with a current provider read rather than trusting every cached attribute forever.

## How Do Import, State Removal, and Destroy Use Bindings?

Import establishes a state binding for an existing remote object. Configuration may declare `aws_instance.web`, but Terraform does not safely guess which existing server should occupy that address. Import explicitly connects the address to a provider identity:

```text
configured address + chosen remote ID -> state binding
```

After import, a plan compares the actual object with the resource configuration. Importing identity does not guarantee the HCL already describes every remote setting; review the first plan before applying.

Removing a binding from state is not the same as destroying the remote object. A deliberate state removal tells Terraform to forget management ownership while leaving the cloud object in place:

```text
state removal
└── binding disappears, remote object remains

destroy
└── provider deletes remote object, state binding is removed
```

This distinction is powerful and dangerous. If configuration still declares the resource after its state binding is removed, the next plan can propose creating another object because Terraform now treats the address as unmanaged and absent.

Destroy also relies on identity. `terraform destroy` or a destroy plan uses state to find exactly which remote objects the configuration manages. Dependencies normally reverse so consumers and contained objects are removed before their prerequisites.

Deleting a resource block demonstrates state reconciliation. State says the object exists and is managed, while configuration no longer desires it. Terraform can therefore propose destruction. If state were missing, Terraform would not know that the old object belonged to the removed address.

State lets Terraform distinguish new from existing. A declaration with no binding is normally a requested new managed instance; a declaration with a binding is compared with the existing object. Import, moves, and state commands deliberately alter that classification and therefore require plan review.

## Why Do Teams Need Remote State and Locking?

Local state is adequate for an isolated learning project. It is weak shared memory for a team:

```text
Alice has one terraform.tfstate
Bob has another copy
CI has a third copy
```

No participant reliably knows which record is current. A remote backend provides one shared authoritative state location for the stack. Depending on platform, that can be HCP Terraform or a supported object-storage or cloud backend.

Remote storage should provide or be configured with protected transport, encryption at rest, restricted access, version history or backups, and auditability. It solves the shared-location problem, but several clients can still attempt to write simultaneously.

State locking prevents competing writers. Imagine Alice and CI both read serial 20, plan different changes, and each tries to write serial 21. Without coordination, the later write can overwrite knowledge from the earlier apply.

```text
acquire lock
      │
read and plan against state
      │
apply and write new state
      │
release lock
```

Locking behaves like a transaction guard around the critical state update. It does not make every infrastructure API atomic, but it prevents two cooperative Terraform writers from concurrently mutating the same state record.

Never casually force-unlock a state. A lock can indicate a genuinely active apply. First identify the lock owner, backend key, operation, and whether the process is still running. Force unlock only through an approved recovery procedure after proving the lock is stale; otherwise two writers can overlap.

Remote state and locking are covered in greater depth in the next article. The first-principles point is that state is shared operational memory, and one writer at a time protects its integrity.

Local state creates a practical coordination problem even if everyone uses Git correctly. Terraform source can merge cleanly while state copies diverge after separate applies. Alice may know about a newly created subnet, while Bob's old file does not. Bob's next plan is then based on incomplete ownership information. A single backend ensures both clients address the same record.

Remote does not automatically mean safe. A backend key or workspace chooses which state record the configuration uses. Pointing production HCL at a development key can make every expected production object look absent and every development object look unexpected. Treat backend configuration and migration as high-impact changes and verify account, region, container, key, and workspace before planning.

Locking protects cooperative Terraform processes, not arbitrary manual modification of remote infrastructure. A person can still change AWS while a state lock exists. The lock serializes reads and writes to the Terraform state transaction, reducing lost updates between Terraform clients.

The transaction analogy has boundaries. An apply can perform several provider operations before one fails. Terraform writes updated state as operations complete where possible, and a later plan reconciles the partial result. The state lock prevents another Terraform writer from racing that process; it cannot roll back all external APIs as one database transaction.

If a process crashes and leaves a stale lock, evidence comes first. Check the operation type, lock ID, owner, timestamp, backend path, and whether the job is still running. Coordinate with the owner. Only then use the backend-supported unlock mechanism with the exact lock ID. Forcing an active lock open can allow overlapping applies and corrupt operational memory.

## How Should You Inspect and Protect State?

Use read-only commands before reaching for mutation:

```bash
terraform state list
terraform state show aws_instance.web
terraform show
terraform output
```

`state list` shows managed addresses. `state show` displays one recorded object in Terraform form. `terraform show` renders the current state or a supplied plan, and `terraform output` reads applied root outputs from state.

`terraform state pull` retrieves raw state for controlled backup or inspection:

```bash
terraform state pull > state-backup.json
```

The resulting file may expose the full topology and sensitive values. Store it only in a restricted recovery location and remove the temporary copy after the approved work.

Do not commit `terraform.tfstate` to Git. Git is designed for distributing durable history, which conflicts with secret-bearing, rapidly changing operational state. Removing a state file from the latest commit does not remove it from repository history.

Protect three properties:

- **Confidentiality:** only authorized people and automation can read infrastructure and secret data.
- **Integrity:** unauthorized or concurrent writers cannot corrupt identity bindings and attributes.
- **Availability:** backups and backend versioning allow recovery when state is lost or damaged.

If state disappears while infrastructure remains, Terraform loses its ownership map. A plan may propose duplicate creation, fail on globally unique names, or omit changes to real objects that are no longer bound. Recovery should pause applies, verify the exact backend and environment, locate a trusted version, restore through the backend or approved state process, and review a no-apply plan before resuming.

Never paste state into tickets or logs merely to diagnose one attribute. Prefer scoped command output and redact carefully, remembering that display redaction is not proof of absence in the underlying state or plan.

Confidentiality concerns extend beyond obvious passwords. Resource names, account IDs, network ranges, endpoints, policy documents, and service topology can help an attacker map an environment. Encrypting the backend protects stored media, while IAM or equivalent access control limits who can request the decrypted state. TLS protects transfers between clients and backend.

Integrity means a reader can trust the binding and attributes during planning. Backend versioning or snapshots provide a recovery trail when an authorized or faulty process writes a bad state. Audit logs help identify which principal changed the record. State locking addresses one source of integrity loss—concurrent writers—but backups and least privilege address others.

Availability matters because losing state can halt safe changes even when all cloud services still run. Maintain tested recovery access and retention for important stacks. A backup that cannot be located, decrypted, or matched to the correct backend lineage is not an effective recovery mechanism.

If raw state must be copied during an incident, name the source backend and time, restrict file permissions, record its purpose, and dispose of it after reconciliation. Do not turn an emergency snapshot into a permanent untracked secret store. Verify restored state with read-only inspection and a plan before allowing apply.

Saved plans deserve comparable handling. They may include the prior state, proposed values, and sensitive information needed for exact apply. Keep them inside controlled pipeline storage for only the required lifetime, and never treat a binary plan as harmless build output.

## How Does State Follow a Resource Through Its Lifecycle?

Follow one address through time.

1. Configuration introduces `aws_instance.web`, but no binding exists. The plan proposes creation.
2. Apply asks the provider to create the server. The provider returns `i-0abc123`, and Terraform writes the binding plus attributes.
3. The next plan uses state to locate and refresh that exact server. If desired and actual values match, no action is required.
4. Configuration changes the instance type. The plan compares the new desire with refreshed reality and provider semantics.
5. Apply updates or replaces the remote object, then records the resulting identity and attributes.
6. Someone changes AWS manually. State remains the previous snapshot until refresh.
7. The next plan discovers drift and proposes reconciliation or records it through a refresh-only workflow.
8. Configuration removes the resource block. State still identifies a managed object that is no longer desired, so the plan proposes destroy.
9. Apply deletes the remote object and removes its binding.

This lifecycle shows why Terraform is not merely an API wrapper. It preserves identity and history between invocations so each run can reason about the same managed object.

![State is the identity and memory layer throughout plan, apply, drift, and destroy](/content-assets/articles/article-iac-terraform-state-what-is-state/state-summary.png)

State is usually one-to-one: one configured resource instance maps to one remote object. Terraform Core, provider configuration, resource schemas, and state metadata work together to maintain that relationship. State may be a local file, a remote object, or a service-managed record; the storage form does not change its role.

A concise four-world model is:

```text
configuration says what should exist
state says what Terraform manages
provider refresh says what exists now
plan says how to reconcile them
```

State is therefore Terraform's durable memory of managed identity and prior attributes. Protecting it is what makes future plans, drift detection, import, address moves, output queries, safe destruction, and team collaboration possible.

The lifecycle can include replacement as well as in-place update. If the provider cannot change a required property on `i-0abc123`, Terraform may create or select a new remote identity and update the same logical address's binding. State can temporarily track old and new instances so the planned create and destroy operations remain distinguishable. After completion, the address points at the surviving remote object.

The address itself can also move without remote replacement. A `moved` block records that `aws_instance.web` is now `aws_instance.frontend`. The desired source name changes, but Terraform carries the existing binding forward. That is different from deleting the old block and introducing an unrelated new address without a move.

Import runs the relationship in the opposite direction from creation: instead of Terraform creating a remote object and learning its ID, the operator supplies an existing ID and asks Terraform to establish the binding. The first plan after import is essential because it reveals whether the written configuration matches the remote object's current attributes.

State removal deliberately ends Terraform ownership without changing the object. Destroy deliberately changes the remote object and then ends the binding. Remote deletion breaks reality while configuration and binding still expect the object. Configuration deletion removes desire while binding and reality still contain it. These four cases look similar only if state, configuration, and reality are incorrectly collapsed into one idea.

The shortest useful definition is therefore not “the JSON file Terraform writes.” State is the identity and metadata database that lets separate Terraform invocations reason about the same managed infrastructure over time. Whether stored locally or remotely, it is part of the system's control plane and deserves database-grade care.

State accuracy is also why normal changes should flow through Terraform. A manual cloud edit does not update configuration and may not update state until refresh. A direct state edit changes Terraform's memory without changing the cloud. A normal plan and apply coordinate the desired declaration, provider observation, remote operation, and resulting state write in one controlled workflow.

When reviewing any surprising plan, inspect the four worlds in order. Confirm the configuration and variable inputs. Confirm the backend, workspace, and managed address list. Refresh or read the provider's current object through the normal planning path. Then examine why the proposed action follows. This method separates a genuine resource drift from a wrong-state selection, missing binding, address rename, or changed desired value.

State does not remove the need for provider APIs. Terraform cannot manage an object solely from an old snapshot, because remote reality may have changed or disappeared. Provider refresh does not remove the need for state, because the remote platform does not understand Terraform addresses or module paths. Both are required for reliable reconciliation.

Finally, state is not a collaboration afterthought. The moment more than one human or automation job can apply the same stack, storage location, access control, locking, backups, audit trail, and environment isolation become part of the infrastructure architecture. Protecting the cloud resources while leaving their control-plane memory unprotected is an incomplete security design.

Use the same caution for state-changing maintenance. An import, move, remove, push, migration, or unlock can alter what Terraform believes it owns even when the HCL diff is small. Take or verify a recoverable backend version, resolve the exact address and remote ID, perform the narrow operation, and immediately review a plan. Success means the resulting ownership map and proposed actions match the intended infrastructure—not merely that a command exited with zero.

This evidence-based habit is the final state principle: identify the backend, identity binding, current remote object, desired declaration, and proposed transition before authorizing change. It keeps Terraform's memory aligned with the systems it controls.

That alignment is what makes repeated Terraform runs trustworthy. The state record must describe the same ownership relationship the configuration intends and the provider can observe. If any part differs, pause before applying, identify whether the cause is drift, a changed address, a wrong backend, a missing import, or an intentional configuration change, and correct the relationship through the narrowest supported operation. A clean command exit is useful evidence, but the resulting plan is the stronger proof that Terraform's memory and intended responsibility agree.

State is both coordination data and potentially sensitive operational data. It maps addresses to remote identities, stores provider-returned attributes, and lets Terraform compare configuration with observed objects. Protect backend read and write access, use locking where supported, retain recoverable versions, and avoid sharing local state through ad hoc files. A plan is the safest routine view of how configuration, refreshed remote state, and recorded state interact; direct state manipulation should remain a narrow, backed-up, immediately verified operation.

A lock should be released by the run that acquired it. If a crashed process leaves a stale lock, first prove that no writer is still active and identify the exact backend and lock record. `terraform force-unlock LOCK_ID` is a recovery command, not a routine way to bypass contention; using it while another apply is alive can let two writers race over the same state.

## Check Your Answers

:::expand[What Problem Does Terraform State Solve?]{kind="recap"}
State binds each logical Terraform resource instance to one real provider object. Without that identity map, Terraform cannot reliably distinguish an existing managed object from one it should create.
:::

:::expand[How Do Configuration, State, Reality, and Plan Differ?]{kind="recap"}
Configuration is desired state, state is Terraform's memory, remote reality is the provider's current observation, and the plan is the proposed transition after comparing them.
:::

:::expand[What Does State Store?]{kind="recap"}
State stores identities, attributes, module and instance addresses, provider and dependency metadata, replacement information, and outputs. It may also contain sensitive values.
:::

:::expand[How Does a Plan Use State and Refresh Reality?]{kind="recap"}
The plan loads configuration and state, uses the binding to refresh the remote object, detects drift, and proposes changes. Refresh-only updates Terraform's memory without changing infrastructure.
:::

:::expand[How Do Import, State Removal, and Destroy Use Bindings?]{kind="recap"}
Import creates a binding, state removal forgets one without deleting the object, and destroy uses the binding to delete the owned remote object. These are different lifecycle operations.
:::

:::expand[Why Do Teams Need Remote State and Locking?]{kind="recap"}
A remote backend gives all writers one shared record, while locking prevents cooperative runs from overwriting one another. Force-unlock only after proving a lock is stale.
:::

:::expand[How Should You Inspect and Protect State?]{kind="recap"}
Prefer read-only inspection, keep state out of Git and tickets, protect confidentiality, integrity, and availability, and recover from a trusted backend version before resuming applies.
:::

:::expand[How Does State Follow a Resource Through Its Lifecycle?]{kind="recap"}
State records identity after create, guides later refresh and updates, reveals drift, and identifies the object to destroy when configuration removes it. It is Terraform's durable operational memory.
:::

### References

- [Terraform state](https://developer.hashicorp.com/terraform/language/state)
- [Purpose of Terraform state](https://developer.hashicorp.com/terraform/language/state/purpose)
- [Refresh-only mode](https://developer.hashicorp.com/terraform/cli/commands/plan#refresh-only-mode)
- [Terraform import](https://developer.hashicorp.com/terraform/language/import)
- [Terraform state commands](https://developer.hashicorp.com/terraform/cli/commands/state)
- [State locking](https://developer.hashicorp.com/terraform/language/state/locking)
- [Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)
