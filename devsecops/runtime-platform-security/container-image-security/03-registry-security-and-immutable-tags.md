---
title: "Registry Security and Immutable Tags"
description: "Protect the image warehouse with private registries, scoped identities, immutable tags, digest deploys, promotion, retention, quarantine, and audit logs."
overview: "Start with the registry as the warehouse where built payments-api images wait for deployment. Then learn private registries, repositories, tags, digests, push versus pull identity, digest capture after push, immutable tags, digest-based Kubernetes deploys, promotion without rebuilding, retention, quarantine, rollback records, private connectivity, and audit logs."
tags: ["devsecops", "registries", "immutable-tags", "image-digests"]
order: 3
id: article-devsecops-container-image-security-registry-security-immutable-tags
---

## Table of Contents

1. [What Does a Container Registry Actually Store?](#what-does-a-container-registry-actually-store)
2. [Why Are Digests Stronger Identities Than Tags?](#why-are-digests-stronger-identities-than-tags)
3. [How Should Push and Pull Authority Be Separated?](#how-should-push-and-pull-authority-be-separated)
4. [Why Should a Pipeline Build Once and Capture the Digest?](#why-should-a-pipeline-build-once-and-capture-the-digest)
5. [How Does Promotion Work Without Rebuilding?](#how-does-promotion-work-without-rebuilding)
6. [How Do Quarantine, Retention, and Rollback Preserve Trust?](#how-do-quarantine-retention-and-rollback-preserve-trust)
7. [How Do Private Access, Logs, Signatures, and Provenance Fit Together?](#how-do-private-access-logs-signatures-and-provenance-fit-together)
8. [What Does a Complete Secure Registry Release Look Like?](#what-does-a-complete-secure-registry-release-look-like)
9. [Check Your Answers](#check-your-answers)

A container registry is not merely a folder of compressed files. It is a supply-chain service that accepts, stores, names, distributes, and often retains metadata for executable artifacts. A consumer that pulls an image is obtaining the filesystem and execution description that will become a process.

That makes the registry a security boundary between producers and consumers:

```text
source and build system
  -> registry
  -> deployment system and runtime
```

If an attacker can replace the artifact in the middle, application source controls can be bypassed. If a consumer can upload arbitrary content, a runtime identity can become a producer. If old releases disappear, investigation and deterministic rollback become harder.

The vocabulary matters:

- A **registry** is the service endpoint that hosts artifacts and related metadata.
- A **repository** is a named collection, such as `team/payments-api`.
- A **tag** is a human-readable reference in that repository, such as `1.7`, `candidate`, or `production`.
- A **digest** is a content-derived identity, such as `sha256:ABC`.

Keep these questions in view as you work through the lesson:

1. **What Does a Container Registry Actually Store?**
2. **Why Are Digests Stronger Identities Than Tags?**
3. **How Should Push and Pull Authority Be Separated?**
4. **Why Should a Pipeline Build Once and Capture the Digest?**
5. **How Does Promotion Work Without Rebuilding?**
6. **How Do Quarantine, Retention, and Rollback Preserve Trust?**
7. **How Do Private Access, Logs, Signatures, and Provenance Fit Together?**
8. **What Does a Complete Secure Registry Release Look Like?**

## What Does a Container Registry Actually Store?
<!-- section-summary: A registry is a distribution service for executable artifacts and metadata; repositories organize related images, while tags label manifests and digests identify their exact content. -->

An image can include manifests, configuration objects, and filesystem layers. A multi-platform image can use an index that refers to separate manifests for different architectures. Registry authorization and evidence should account for the object consumers actually retrieve, not only the friendly repository name.

The first useful distinction is location versus trust. Presence in an organizational registry does not automatically mean an artifact is approved. A build may have pushed an untested candidate. A vulnerability response may have quarantined a previously approved digest. A compromised producer may have uploaded malicious content. The registry stores artifacts; policy determines which stored artifacts can progress.

Private registries reduce public exposure and give the organization control over identity, network paths, retention, immutability, and logs. They do not make every artifact safe. Image contents, build provenance, signing, and vulnerability decisions remain separate controls.

![Registry release checkpoint infographic showing a CI push role sending payments-api into a private registry, audit logs recording the action, and a Kubernetes pull role receiving the approved digest](/content-assets/articles/article-devsecops-container-image-security-registry-security-immutable-tags/registry-release-checkpoint.png)

Treat a registry repository as a release history. Its access policy and mutation rules should make it possible to answer which artifacts entered, who produced them, which names referred to them, which evidence accompanied them, and which deployment systems pulled them.

Repository boundaries should follow ownership closely enough that permissions remain understandable. Putting unrelated teams and trust levels behind one shared wildcard makes a narrow role difficult to express. At the other extreme, creating arbitrary repositories without lifecycle ownership produces ungoverned storage. Establish who may create repositories, which release policy each inherits, and who responds to findings on their contents.

Because layers can be shared between images, authorization must still be evaluated through an allowed manifest or repository relationship. Knowing a blob digest should not become a shortcut around repository access. The registry implementation, caches, and mirrors all participate in the distribution boundary and need consistent authentication and transport protection.

## Why Are Digests Stronger Identities Than Tags?
<!-- section-summary: Tags are convenient names that can move, whereas digests identify exact content; immutable tags reduce name reuse, and digest-based deployment guarantees which artifact a consumer requests. -->

Tags and digests solve different problems. A tag helps a person say “version 4.2.1” or “the production release.” A digest lets a machine say “these exact contents.”

By default, many registries allow a tag to be changed:

```text
payments-api:4.2.1 -> sha256:AAA

later

payments-api:4.2.1 -> sha256:BBB
```

The label looks unchanged while the artifact changes. A scanner may have approved `AAA`, staging may have tested `AAA`, and production may later pull `BBB`. The visible name hides a broken evidence chain.

An immutable-tag rule prevents an existing tag from being reassigned. Once `4.2.1` points to `sha256:AAA`, a second push attempting to make it point to `sha256:BBB` fails. This protects release names from silent reuse and catches accidental rebuilds of an already published version.

Digest-based deployment is related but not identical. A workload specification can request:

```text
registry.example/team/payments-api@sha256:AAA
```

Now the runtime itself asks for exact content. Even if some tag moves, this deployment remains tied to `AAA`.

Immutable tags protect the mapping from human name to digest. Digest references protect the consumer's artifact choice. A strong release uses both: stable version labels for operators and exact digests for evidence and execution.

Tags still have useful jobs. They can represent versions, candidate states, channel names, or environment promotion. They support discovery and familiar commands. The problem begins when a mutable label is treated as if it were cryptographic identity.

`latest` is especially troublesome because it communicates neither version nor approval state. Different environments can cache or resolve it at different times, and a rollback request such as “go back to latest” is meaningless. If a floating development tag is retained for convenience, do not let production trust depend on it.

A helpful analogy is:

```text
registry repository  -> place to look
tag                  -> changeable name
digest               -> content fingerprint
```

The digest should appear in scan results, SBOMs, signatures, provenance, deployment records, pull logs, incident notes, and rollback decisions. That shared identity prevents evidence from drifting away from the artifact it describes.

## How Should Push and Pull Authority Be Separated?
<!-- section-summary: Producing and consuming software are different capabilities, so build identities should push narrowly while runtime identities pull approved repositories without gaining mutation authority. -->

Creating software and executing software are different powers. A CI pipeline needs permission to push artifacts and perhaps attach evidence. A Kubernetes node or workload needs permission to pull an artifact. Giving both identities the same broad registry role violates capability separation.

Suppose a runtime pull credential can also push. Compromise of one application or node could then upload a malicious replacement, create deceptive tags, or alter evidence for future deployments. The consumer has become a producer.

Use distinct identities:

```text
CI build identity
  -> push to one owned repository
  -> attach approved evidence
  -> cannot administer registry policy

runtime pull identity
  -> read required repositories
  -> cannot push, delete, retag, or change policy
```

Scope each identity by repository, operation, environment, and lifetime. One team's build should not push another team's image. A development builder should not automatically modify production release labels. A pull identity for one cluster should not require registry administration.

Temporary authentication is preferable to long-lived credentials. A protected workflow can exchange its workload identity for a short registry session. A node or platform component can obtain pull authority from its runtime identity. Rotation and revocation then operate on workload trust rather than secrets copied across projects.

Separate other capabilities as well. Deleting retained artifacts, changing immutable-tag policy, moving quarantine state, editing retention rules, and administering signing trust are not normal build actions. Place them behind distinct operational or security roles with audit evidence.

Capability separation does not require a unique account for every command. It requires that compromise of one role does not automatically grant an unrelated power. Review effective permissions, including groups, inherited roles, repository wildcards, service-account impersonation, and administrative APIs.

Test the boundary negatively. Use the pull identity to attempt a push and delete. Use the normal build identity to alter immutability or another repository. Use an untrusted pull request to request production push authority. Each action should fail before a release relies on the boundary.

## Why Should a Pipeline Build Once and Capture the Digest?
<!-- section-summary: One controlled build creates one artifact; after push, the registry-returned digest becomes the subject for tests, evidence, promotion, deployment, and rollback. -->

The central release invariant is:

> The exact artifact tested and approved is the exact artifact production runs.

Build the image once. After the registry accepts it, capture the digest it exposes for the pushed object. A simplified flow is:

```text
build payments-api:commit-8421
  -> push candidate
  -> resolve registry digest sha256:ABC
  -> scan, attest, and test sha256:ABC
  -> promote sha256:ABC
  -> deploy sha256:ABC
```

Why capture after push? A local image identifier and the registry manifest digest can refer to different levels of an image's representation. Registry processing and multi-platform publishing can also determine the final subject consumers use. Query the authoritative stored object and carry that digest forward.

Do not reconstruct the identity from log text or assume the tag still points to the object pushed moments ago. Capture a machine-readable output from the push or registry and verify it before creating evidence.

For a multi-platform release, capture the index digest and each platform manifest required by policy. Tests may exercise only one architecture while production uses another. The evidence model should show which common source and build produced each platform object and which exact manifest a given runtime consumed. A single friendly tag can otherwise hide different untested binaries.

Every later operation should state the digest explicitly. The SBOM describes `ABC`. The scan evaluates `ABC`. A signature or provenance attestation names `ABC`. Staging pulls `ABC`. The production manifest requests `ABC`. Audit and rollback records mention `ABC`.

This model turns a release from a sequence of similar labels into a chain around one object:

```text
reviewed source
  -> controlled build
  -> stored digest
  -> evidence and tests for that digest
  -> authorized consumers of that digest
```

If a step discovers a different digest, stop. Do not copy the approval from the expected artifact to the unexpected one. Investigate whether the pipeline rebuilt, published a different platform, resolved a changed tag, or was modified.

Build identity and promotion identity can also be separated. The builder creates a candidate in a controlled repository. A later release workflow, after evidence checks and approvals, changes promotion state or writes the digest to deployment configuration. The release workflow does not need to rebuild or alter the artifact bytes.

## How Does Promotion Work Without Rebuilding?
<!-- section-summary: Promotion is a change in release state or authorized reference for an existing digest, not another compilation; rebuilding breaks the transfer of tests and evidence. -->

Rebuilding for each environment is dangerous because build inputs can change without source changes. A base tag may move, a package repository may publish a new dependency, a build tool may update, or the environment may be compromised differently. Staging and production can receive different bytes even when both builds use the same commit.

Promotion should therefore be a state transition over an existing artifact:

```text
sha256:ABC
  candidate -> tested -> approved -> production
```

The state can be represented by controlled metadata, an environment release record, or an immutable promotion tag. Whatever mechanism is used, it should point to the same digest and preserve who authorized the transition.

A production tag can be helpful for discovery, but it is not the evidence itself. If the workflow moves `production` from `AAA` to `ABC`, it should record the old and new digests, approval, time, policy result, and deployment target. Production manifests can still use the immutable digest.

![Tag digest promotion infographic showing a production tag, an immutable digest lock, promotion to Kubernetes, rollback, and known-good digest selection](/content-assets/articles/article-devsecops-container-image-security-registry-security-immutable-tags/tag-digest-promotion.png)

Promotion without rebuilding transfers test results. Integration and security tests that exercised `ABC` remain relevant because production receives `ABC`. Environmental differences still matter—credentials, network, configuration, and load can change behavior—but artifact identity is no longer another variable.

This pattern also keeps source and artifact release separate. A commit can produce an image that is never promoted. A previously built digest can advance after a delayed approval. A rollback can select a previous known-good digest without attempting to recreate old bytes from source and historical package repositories.

Immutable version tags and digest deployments reinforce the model. A version name never silently changes, and the workload states the exact object. A mutable environment label, if used, expresses current state rather than artifact identity and is governed by a promotion role.

Treat copying between registries as promotion only when the copied content identity and evidence are verified. If a transfer rewrites or loses the subject relationship, create a traceable mapping and verify the destination digest before deployment.

Promotion should also be concurrency-safe. Two release workflows must not race to move the same environment label after reviewing different candidates. Require the expected previous digest, serialize the protected transition, and record the result that deployment configuration actually consumed. This turns promotion into an auditable comparison-and-set operation rather than a last-writer-wins tag update.

## How Do Quarantine, Retention, and Rollback Preserve Trust?
<!-- section-summary: Registries need explicit trust states, append-oriented history, and protected retention so unsafe artifacts can be blocked while old release evidence remains available for rollback and investigation. -->

Registry security is not the same as image security. A well-configured registry can safely store a vulnerable image. A hardened image can be mishandled by mutable names and broad permissions. The release system needs trust states in addition to storage.

Quarantine follows naturally from that separation. A newly pushed artifact can exist but remain ineligible for production until required evidence and tests pass. A later disclosure or compromised signer can move an existing digest back to a blocked state without deleting the historical object immediately.

Policy should answer whether a consumer may pull or deploy from each state. Development scanners may need read access to quarantined artifacts. Production deployers should not. The authority that moves an artifact out of quarantine should be distinct from the untrusted producer where feasible.

Retention is a security property because releases create evidence. Deleting an older digest too early can break rollback, erase the subject of an incident, remove the artifact needed to reproduce a scan, or make an attestation impossible to inspect. Unlimited retention has cost and data-governance consequences, so define rules by release and investigation need.

Release history should be append-oriented. Publishing version `4.2.1` should create a durable mapping to one digest. A repair should become `4.2.2` or another new release, not silently rewrite history. Promotion records should add transitions rather than erase the previous production digest.

Immutability makes rollback deterministic. If `4.2.0` always means `sha256:OLD` and the artifact is retained, rollback selects a known object. If a tag was overwritten, the name no longer tells responders which bytes previously worked.

A rollback record should include the selected digest, reason, approver, target environment, previous digest, and evidence status. A historically valid artifact may now have a known vulnerability or revoked signature. Emergency rollback policy should balance service recovery with current security knowledge and document compensating controls.

Garbage collection must respect retained manifests, layers, signatures, SBOMs, and attestations. Deleting an apparently untagged object can remove a digest still referenced by deployment configuration or evidence. Use inventory rather than tag presence alone to decide what is safe to remove.

Quarantine must also have a release path. Record why the digest was blocked, which policy or incident created the state, who may reassess it, and what new evidence is required. Otherwise teams may bypass quarantine by copying the same bytes under another tag or repository. Policy should recognize the digest across names and prevent accidental laundering of a blocked artifact.

Retention rules need legal and operational sensitivity as well as storage cost. An image can contain proprietary code, licensed components, or accidentally embedded data. Limit readers of retired artifacts, preserve what incident and rollback policy requires, and document the controlled deletion event when the period ends. The audit trail can remain after artifact deletion when policy allows, but it should clearly show that the bytes are no longer retrievable.

## How Do Private Access, Logs, Signatures, and Provenance Fit Together?
<!-- section-summary: Private registries and networks reduce exposure, audit logs explain actions, and digest-bound signatures and provenance explain which artifact was authorized and how it was produced. -->

A private registry requires authentication and can restrict repositories to organizational producers and consumers. Private network connectivity can reduce exposure further by keeping push and pull traffic on controlled paths rather than public endpoints.

Network privacy is not authorization. A compromised workload inside the network should still face registry authentication and least privilege. TLS, certificate validation, and trusted endpoints protect the artifact in transit. Egress and DNS controls can make it harder for a workload to pull from an unapproved external registry.

Audit logging answers a different question from scanning or signing: who did what, when, and from where? Useful events include authentication, push, pull, tag creation or movement, delete, quarantine change, retention change, policy administration, and failed authorization.

Log digests, not only tags. A record that says “pulled production” is ambiguous after the label moves. A record that includes `sha256:ABC` can be matched to deployment, evidence, and incident scope. Retain logs somewhere the pushing or deleting identity cannot erase.

Signatures add artifact authorization. A verifier can check that an approved identity signed the exact digest. Provenance adds a claim about creation: source revision, workflow, builder, and other build context. Neither replaces registry authorization, vulnerability review, or audit logs.

The controls answer different questions:

```text
registry access  -> who may store or retrieve?
digest           -> which exact artifact?
immutable tag    -> can this release name be reused?
signature        -> did an approved identity endorse it?
provenance       -> how and from what was it built?
audit log        -> what registry action occurred?
deployment policy-> may this artifact run here now?
```

A stronger architecture binds them. The build identity pushes one candidate repository, the registry records the digest, evidence is attached to that digest, a promotion identity changes release state after checks, and the runtime pull identity reads only allowed repositories. Network policy limits alternate registries, while logs provide an independent action trail.

Monitor the boundary rather than only configuring it once. Alert on pushes from unexpected identities, mutation attempts against immutable tags, pulls of quarantined or retired digests, deletion of recent releases, access from unusual network paths, repeated authorization failures, and administration outside the normal workflow. Join registry pull events with cluster deployment inventory so an unexplained consumer becomes visible.

Mirrors and caches require the same reasoning. A runtime may appear to pull from an approved internal endpoint while the mirror fetches from an uncontrolled upstream or serves stale mutable tags. Pin upstreams, validate TLS and artifact digests, scope mirror administration, and ensure audit evidence can trace an internal object to its source.

## What Does a Complete Secure Registry Release Look Like?
<!-- section-summary: A secure release preserves artifact identity and capability separation from one controlled build through evidence, promotion, digest deployment, runtime pull, retention, and later investigation. -->

Consider release `4.2.1` of the payments API:

1. Protected CI builds the image once from reviewed source.
2. A narrow build identity pushes it as a candidate.
3. The registry returns `sha256:ABC`.
4. CI binds the SBOM, scan, provenance, and signature to `ABC`.
5. Policy confirms the required evidence and trust state.
6. Staging deploys `ABC` and records the result.
7. An accountable promotion changes `ABC` to approved production state.
8. The version tag `4.2.1` is immutable and maps to `ABC`.
9. Production configuration requests `ABC` directly.
10. A pull-only runtime identity retrieves it through an allowed path.
11. Registry and deployment logs record the digest.
12. Retention preserves `ABC`, its evidence, and promotion history.

What if another artifact appears under the same version? Immutable-tag policy rejects the replacement. If a separate tag points to the new digest, it has no inherited approval; it must pass the trust workflow as a new artifact.

What if a new vulnerability affects `ABC`? The registry can mark it quarantined for future deployments while runtime inventory identifies current use. The team builds a repaired `DEF`, publishes new evidence, and promotes it through the same path. Historical records for `ABC` remain available.

What if production must roll back? The release record identifies the previous known-good digest rather than asking the registry what an old mutable label once meant. Current policy and incident authority determine whether that digest remains acceptable for emergency use.

![Registry controls summary infographic showing least privilege, immutable tags, digest deploys, retention, quarantine, private access, and audit logs around the payments-api private registry](/content-assets/articles/article-devsecops-container-image-security-registry-security-immutable-tags/registry-controls-summary.png)

The design can be stated as invariants:

1. **Artifact identity:** every security and deployment decision names a digest.
2. **Stable release names:** a published version cannot silently point to new bytes.
3. **Testing transfers:** production runs the same digest that staging tested.
4. **Capability separation:** consumers cannot become producers, and normal producers cannot administer registry controls.
5. **Presence is not approval:** stored and quarantined artifacts do not automatically qualify for production.
6. **Explainable history:** retained artifacts, evidence, promotion records, and logs show what happened.
7. **Controlled access:** pushes and pulls use authenticated, encrypted, scoped paths.

The three most important distinctions are simple:

```text
tag is not digest
push is not pull
stored is not trusted
```

Together they produce the registry mental model:

```text
secure registry release
  = exact artifact identity
  + immutable human naming
  + separated producer and consumer powers
  + build-once promotion
  + explicit trust state
  + protected history and evidence
  + observable controlled access
```

The registry is therefore not the place where trust begins or ends. It is the checkpoint that preserves the artifact and its identity between build and runtime while enforcing who may mutate, approve, retrieve, retain, or investigate it.

## Check Your Answers

:::expand[What Does a Container Registry Actually Store?]{kind="recap"}
A registry distributes executable artifacts and metadata; repositories organize them, tags provide readable labels, and digests identify exact stored content.
:::

:::expand[Why Are Digests Stronger Identities Than Tags?]{kind="recap"}
A tag may move, while a digest names exact content; immutable tags protect release-name mappings and digest deployments protect the consumer's actual choice.
:::

:::expand[How Should Push and Pull Authority Be Separated?]{kind="recap"}
Builders need narrow producer rights and runtimes need narrow consumer rights, so compromise of a pull identity cannot upload, delete, retag, or administer releases.
:::

:::expand[Why Should a Pipeline Build Once and Capture the Digest?]{kind="recap"}
One controlled build creates one registry digest, which becomes the shared subject for tests, evidence, promotion, deployment, logging, and rollback.
:::

:::expand[How Does Promotion Work Without Rebuilding?]{kind="recap"}
Promotion changes the approved state or controlled label of an existing digest; rebuilding would create new bytes and break the transfer of testing evidence.
:::

:::expand[How Do Quarantine, Retention, and Rollback Preserve Trust?]{kind="recap"}
Explicit trust states block unsafe artifacts, while append-oriented history and protected retention preserve exact objects for response, explanation, and deterministic rollback.
:::

:::expand[How Do Private Access, Logs, Signatures, and Provenance Fit Together?]{kind="recap"}
Private paths and authorization constrain access, logs record actions, signatures identify approval, and provenance explains how the exact digest was produced.
:::

:::expand[What Does a Complete Secure Registry Release Look Like?]{kind="recap"}
The complete path carries one digest from protected build through bound evidence and accountable promotion to pull-only deployment, retained history, and later reevaluation.
:::
