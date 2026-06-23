---
title: "Artifact Signing and Verification"
description: "Use digests, Cosign signatures, OIDC identities, transparency logs, and admission policy so production rejects untrusted artifacts."
overview: "Artifact signing connects an immutable artifact digest to the build identity that produced it. This article follows a production container from CI to Kubernetes admission so you can see how Cosign keyless signing, Rekor, and verification policy keep untrusted images out of production."
tags: ["devsecops", "signing", "cosign", "verification"]
order: 4
id: article-devsecops-software-supply-chain-artifact-signing-verification
---

## Table of Contents

1. [The Production Gate](#the-production-gate)
2. [Digests](#digests)
3. [Signatures](#signatures)
4. [Cosign Keyless Signing](#cosign-keyless-signing)
5. [Transparency Logs and Rekor](#transparency-logs-and-rekor)
6. [Public Key and Keyless Flows](#public-key-and-keyless-flows)
7. [Verification Before Deployment](#verification-before-deployment)
8. [Kubernetes Admission Policy](#kubernetes-admission-policy)
9. [Verification Failure Handling](#verification-failure-handling)
10. [Rollout and Rollback Operations](#rollout-and-rollback-operations)
11. [Putting It All Together](#putting-it-all-together)

## The Production Gate
<!-- section-summary: Production needs a repeatable way to accept artifacts from approved build paths and reject everything else before a workload starts. -->

Imagine a company called Meridian Retail. The checkout team ships a service named `payments-api`, and that service runs in a production Kubernetes cluster. The team already has a CI pipeline that builds the image, scans it, creates an SBOM, and records how the image was built. The next question is the production question: how does the cluster know the image came from that approved pipeline instead of from a laptop, a compromised registry token, or an old build someone pushed under the same tag?

An **artifact** is the file-like output that a delivery pipeline ships. In this article, the artifact is a container image. The same idea also applies to binaries, Helm charts, language packages, and release archives. **Artifact signing** means the release system attaches a cryptographic approval to the artifact. **Artifact verification** means another system checks that approval before it lets the artifact move forward.

The release path has four connected pieces. The **digest** identifies the exact artifact. The **signature** proves that a trusted signer approved that digest. The **identity** tells us who or what signed it. The **verification policy** tells production which identities and artifacts count as trusted. Each piece matters because production needs a simple answer at deploy time: should this exact artifact be allowed to run?

| Piece | Simple meaning | Production example |
|---|---|---|
| **Digest** | The immutable address of the artifact content | `ghcr.io/meridian-retail/payments-api@sha256:...` |
| **Signature** | Cryptographic proof attached to that digest | Cosign signs the image digest after CI builds it |
| **Identity** | The trusted signer behind the signature | GitHub Actions workflow `release.yml` on a protected tag |
| **Verification policy** | The rule that checks the digest, signature, and identity | Kubernetes admission rejects unsigned images in `production` |

That is the path for this article. First we pin the image to a digest, then we sign that digest, then we connect the signature to a CI identity, then we let Kubernetes reject anything outside the approved release path.

## Digests
<!-- section-summary: A digest identifies exact artifact content, so signing and deployment can talk about one unchanging image instead of a movable tag. -->

A **digest** is a content-based identifier. For container images, the registry calculates a cryptographic hash of the image manifest and gives it a name that starts with `sha256:`. If the image content changes, the digest changes. This gives the release process a stable way to point at exactly one artifact.

A tag is the friendly name humans like to type, such as `1.8.3` or `main`. Teams use tags because they are readable, and a tag can move to a different image when someone pushes again. A digest gives production the exact object that the registry stored. The release record, the signature, the SBOM, the scan result, and the deployment manifest can all point to the same digest.

The Meridian pipeline might build and push this image tag:

```bash
docker buildx build \
  --platform linux/amd64 \
  --tag ghcr.io/meridian-retail/payments-api:1.8.3 \
  --push .
```

After the push, the pipeline asks the registry for the digest behind the tag:

```bash
docker buildx imagetools inspect ghcr.io/meridian-retail/payments-api:1.8.3
```

The digest form is the value the deployment should carry forward:

```bash
IMAGE="ghcr.io/meridian-retail/payments-api@sha256:9e3d1f5b7c4a8c6d0e2f4a6b8c1d3e5f7a9b0c2d4e6f8a1b3c5d7e9f0a2b4c6d"
```

Kubernetes can use the digest directly in the Pod template. The tag can still exist for humans and release notes, while the manifest uses the immutable reference:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  namespace: production
spec:
  template:
    spec:
      containers:
        - name: payments-api
          image: ghcr.io/meridian-retail/payments-api@sha256:9e3d1f5b7c4a8c6d0e2f4a6b8c1d3e5f7a9b0c2d4e6f8a1b3c5d7e9f0a2b4c6d
```

This digest gives the signing step a precise target. The signer should approve the artifact content that passed the release workflow and leave the human-readable name as release metadata.

## Signatures
<!-- section-summary: A signature binds trust to a digest, which lets a verifier check both artifact integrity and approved origin. -->

A **digital signature** is cryptographic proof that a trusted signer approved a specific piece of data. With container signing, the data is usually the image digest. The signing tool creates signature material for that digest, stores it where verifiers can find it, and lets other systems check it later with public verification information.

Think about the release meeting for `payments-api`. The useful production question is whether the exact digest was signed by the approved release path. A signature answers that question. It says this digest passed through a signer that production trusts, and that answer matters more than the friendly tag name.

Cosign is the common signing tool in the Sigstore project. With a traditional key pair, the release team creates a private key and a public key. The private key signs the image digest. The public key verifies the signature later.

```bash
cosign generate-key-pair

cosign sign --key cosign.key "$IMAGE"

cosign verify --key cosign.pub "$IMAGE"
```

The private key is sensitive because anyone who has it can sign artifacts that look trusted. In a production system, that key usually belongs in a key management service, hardware-backed signing service, or a tightly controlled secret store. Teams also need rotation rules, emergency revocation steps, access reviews, and logs that show who used the key.

The signature gives strong evidence for **integrity** and **origin**. Integrity means the artifact still matches the digest that was signed. Origin means the signature came from a trusted signing path. Other controls still answer other release questions. Tests answer whether the application behaves correctly. Scanners answer whether known vulnerabilities are present. Provenance answers how the artifact was built. The signature connects those release decisions to the exact artifact production wants to run.

![Trust the digest infographic showing a movable tag, pinned digest, signature, verifier, and allow decision](/content-assets/articles/article-devsecops-software-supply-chain-artifact-signing-verification/trust-the-digest.png)

*Signing works best when the trust decision follows the digest, because the digest identifies the exact artifact while a tag can move.*

Key management is where many teams get stuck. CI jobs need to sign releases, and long-lived private keys inside CI secrets create another powerful credential to protect. That is why many modern pipelines use keyless signing.

## Cosign Keyless Signing
<!-- section-summary: Keyless signing lets CI sign an artifact through a short-lived OIDC identity instead of storing a long-lived signing key. -->

**Keyless signing** means the CI job signs with a short-lived identity instead of a long-lived private key stored in the pipeline. The word keyless can sound strange because cryptography still uses keys under the hood. The important part is that the release team avoids managing a permanent signing private key for the workflow.

The identity usually comes from **OpenID Connect**, often shortened to OIDC. OIDC is a standard way for one system to say, with a signed token, who a workload is and where it is running. In GitHub Actions, a workflow can request an OIDC token that says which repository, workflow file, branch or tag, and job context created the token. The signing system can use that token as the signer identity.

With Sigstore keyless signing, the flow looks like this:

![Keyless signing flow infographic showing CI job, OIDC, Fulcio, Cosign, Rekor, and registry stages connected through a signing pipeline](/content-assets/articles/article-devsecops-software-supply-chain-artifact-signing-verification/keyless-signing-flow.png)

*Keyless signing lets the CI job use a short-lived workload identity, receive signing credentials, sign the digest, record the event, and publish the signed artifact.*

Fulcio is the Sigstore certificate authority used by public Sigstore keyless signing. The CI job proves its OIDC identity to Fulcio. Fulcio issues a short-lived signing certificate that includes that identity. Cosign signs the image digest and records enough information for later verification. Rekor, the transparency log, gives the signature a public audit trail.

A GitHub Actions release job for Meridian might look like this:

```yaml
name: release-payments-api

on:
  push:
    tags:
      - "payments-api-v*"

permissions:
  contents: read
  packages: write
  id-token: write

jobs:
  build-sign:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: sigstore/cosign-installer@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/meridian-retail/payments-api:${{ github.ref_name }}

      - name: Sign image digest
        env:
          IMAGE: ghcr.io/meridian-retail/payments-api@${{ steps.build.outputs.digest }}
        run: cosign sign --yes "$IMAGE"
```

The important line is `id-token: write`. That permission lets the workflow request an OIDC token for this job. The registry write access still comes from the registry login. In a production repository, teams usually pin third-party GitHub Actions to reviewed commit SHAs, protect the release workflow file with code owners, and allow release tags only through the normal release process.

Now production can verify more than "someone signed this." Production can verify "the `payments-api` release workflow in the Meridian repository signed this digest from a release tag." That identity check is the heart of keyless signing.

## Transparency Logs and Rekor
<!-- section-summary: Rekor records signing events in an append-only log so teams can audit which identities signed which artifacts. -->

A **transparency log** is an append-only record of security events. Append-only means entries can be added and audited in order. The log gives verifiers and auditors a shared place to check that a signing event happened and to look for suspicious signing activity.

Rekor is Sigstore's transparency log. When Cosign signs through the public Sigstore flow, the signing event can be recorded in Rekor. A verifier can check that the signature and certificate information line up with the log entry. This gives the release team more than a private conversation between one CI job and one cluster. It gives them an auditable record that security tooling can inspect later.

For the `payments-api` team, Rekor helps answer practical incident questions. Did the approved `release.yml` workflow sign this digest? Did any unexpected workflow sign an image under the same package name? Did a release happen from a branch when policy only expects tags? Those questions matter during an incident because responders need evidence quickly.

Verification usually checks the certificate identity, the OIDC issuer, and the log-backed signing material together:

```bash
cosign verify "$IMAGE" \
  --certificate-identity "https://github.com/meridian-retail/payments-api/.github/workflows/release.yml@refs/tags/payments-api-v1.8.3" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

The command succeeds when Cosign can verify the signature for that image and match the expected identity constraints. Teams often wrap this command in release scripts, deployment jobs, and incident runbooks so the same trust rule appears everywhere.

Public transparency logs work well for public or internet-reachable signing flows. Some companies use private Sigstore deployments or private policy systems when artifact names, repository names, or release timing are sensitive. The operational idea stays the same: signing events should leave reviewable evidence, and production should check that evidence before it accepts an artifact.

## Public Key and Keyless Flows
<!-- section-summary: Public-key signing and keyless signing both create valid signatures and place trust in different systems. -->

Public-key signing and keyless signing both create signatures over artifact digests. The difference is where production places trust. A public-key flow trusts a key or key service. A keyless flow trusts an identity provider, a certificate authority, and the identity rules inside the verification policy.

Meridian might use both patterns in different places. The cloud platform team may sign a base image with a KMS-backed key because the base image pipeline runs in a private network and has strict change control. The application team may sign `payments-api` with GitHub Actions keyless signing because the workflow identity already describes the release source clearly.

| Flow | What production trusts | Strong fit | Operations work |
|---|---|---|---|
| **Public key** | A public key, KMS key, HSM key, or signing service | Internal build systems, offline releases, regulated key custody | Key creation, access control, rotation, backup, revocation, audit |
| **Keyless** | OIDC identity, Fulcio certificate, Rekor log, and policy constraints | CI systems with strong workload identity, open source releases, cloud-native pipelines | OIDC permissions, workflow protection, identity matching, log monitoring |

Teams get into trouble when they treat the signature as the whole policy. A public key can be shared too broadly. A keyless workflow can allow too many branches or repositories. The signature gives a cryptographic check, and the verification policy decides which signing source production should trust.

For key-based signing, a production review usually asks these questions. Who can use the private key? Where is the key stored? How is the key rotated? How does the team revoke trust after a leak? Which systems log key usage? For keyless signing, the review asks a different set of questions. Which OIDC issuer is trusted? Which repository and workflow are trusted? Which branches or tags may release? Who can edit that workflow? How are unexpected Rekor entries investigated?

Those questions lead naturally into deployment verification. The signature has value after the deployment path checks it.

## Verification Before Deployment
<!-- section-summary: A deployment gate checks the image digest, signature, signer identity, and expected issuer before it changes production. -->

**Verification** is the act of checking the artifact against the trust rule. For `payments-api`, the rule says the deployed image must be signed by the release workflow in the `meridian-retail/payments-api` repository, and the OIDC issuer must be GitHub Actions. The deployment job can check that rule before it updates Kubernetes.

Here is a simple deploy gate. The same image reference that will go into the manifest is the image reference Cosign verifies:

```bash
IMAGE="ghcr.io/meridian-retail/payments-api@sha256:9e3d1f5b7c4a8c6d0e2f4a6b8c1d3e5f7a9b0c2d4e6f8a1b3c5d7e9f0a2b4c6d"

cosign verify "$IMAGE" \
  --certificate-identity "https://github.com/meridian-retail/payments-api/.github/workflows/release.yml@refs/tags/payments-api-v1.8.3" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

kubectl -n production set image deployment/payments-api payments-api="$IMAGE"
```

That gate catches common release mistakes. If someone tries to deploy a tag without a digest, the release job can fail its own manifest check. If someone signs from a test workflow, the certificate identity will differ. If someone pushes a new image to the same tag after the release, the digest in the manifest still points to the signed image.

Real teams usually add a few more guardrails around this step. The deploy job should accept only digest-pinned image references. It should keep the verified digest in release metadata. It should show the signing identity in the change record so reviewers see the source of the artifact. It should run the same verification logic in staging and production so the rule has already passed before the production window.

This deploy-time check is useful. Every deployment path still has to run it. Kubernetes admission policy moves the check into the cluster so the API server can block bad workloads even when a script, human, or alternate tool tries to create them.

## Kubernetes Admission Policy
<!-- section-summary: Admission policy puts signature verification at the cluster boundary, so untrusted images fail before Pods start. -->

**Admission control** is the Kubernetes checkpoint that evaluates a request before the API server stores it. After a caller authenticates and Kubernetes checks authorization, admission controllers can validate or mutate the object. Image verification policies use that checkpoint to inspect Pod images before the workload runs.

This matters because production clusters receive changes from many paths. A GitOps controller may sync a manifest. A deploy job may run `kubectl`. An on-call engineer may apply an emergency patch. Admission policy gives the cluster one shared rule: images in the production namespace must match trusted signing requirements.

Many teams use Kyverno, Sigstore policy-controller, or a similar admission policy system for this. The example below uses Kyverno because it can verify Cosign signatures and keyless identities directly in Kubernetes policy. Meridian starts in `Audit` mode in staging, reviews violations, then changes production to `Enforce` after the release path is clean.

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-signed-payments-api
spec:
  webhookConfiguration:
    failurePolicy: Fail
    timeoutSeconds: 30
  background: false
  rules:
    - name: verify-payments-api-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaces:
                - production
      verifyImages:
        - imageReferences:
            - "ghcr.io/meridian-retail/payments-api*"
          mutateDigest: true
          verifyDigest: true
          required: true
          failureAction: Enforce
          attestors:
            - entries:
                - keyless:
                    subjectRegExp: "^https://github\\.com/meridian-retail/payments-api/\\.github/workflows/release\\.yml@refs/tags/payments-api-v[0-9]+\\.[0-9]+\\.[0-9]+$"
                    issuer: "https://token.actions.githubusercontent.com"
                    rekor:
                      url: "https://rekor.sigstore.dev"
```

There are several important details in this policy. `imageReferences` scopes the rule to the `payments-api` package. `mutateDigest: true` lets the policy resolve tags to digests where the policy engine supports that behavior. `verifyDigest: true` requires the final image reference to use a digest. `required: true` makes a missing signature fail the rule. `failureAction: Enforce` blocks the request after the rollout has moved past audit mode.

The `subjectRegExp` is the keyless identity rule. It allows the release workflow on release tags and excludes other branches and workflows. The `issuer` pins the identity provider to GitHub Actions. The Rekor URL tells the verifier which transparency log to use for the keyless signature evidence.

The rollout should test both the success path and the failure path:

```bash
kubectl apply -f require-signed-payments-api.yaml

kubectl -n production apply -f signed-payments-api-deployment.yaml

kubectl -n production run unsigned-test \
  --image=ghcr.io/meridian-retail/payments-api:dev-local \
  --restart=Never
```

The signed deployment should pass. The unsigned test Pod should fail admission. That failure is useful because it proves the policy can reject an untrusted artifact before it reaches a node.

## Verification Failure Handling
<!-- section-summary: A failed verification should trigger a small incident workflow that checks the digest, signer identity, policy, and release source. -->

Verification failures need a calm runbook because they usually happen during a release window. A failure may mean the image has no signature, the manifest points to the wrong digest, the workflow identity changed, the Rekor check failed, or someone is trying to deploy an artifact from outside the approved path. The team needs a quick way to separate a release mistake from a real security problem.

The first check is the image reference. The release owner should confirm that the manifest uses a digest and that the digest matches the image the pipeline built. If the manifest uses a tag only, the fix belongs in the release process. The deployment should move to the signed digest that CI produced.

```bash
kubectl -n production get events --sort-by='.lastTimestamp'

kubectl -n production get deployment payments-api \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="payments-api")].image}'
```

The next check is the signature and identity. The responder can run the same Cosign verification outside the cluster and compare the identity in the certificate with the expected workflow rule. A mismatch often points to a renamed workflow file, a release from the wrong branch, or a manual signing attempt.

```bash
cosign verify "$IMAGE" \
  --certificate-identity-regexp "^https://github\\.com/meridian-retail/payments-api/\\.github/workflows/release\\.yml@refs/tags/payments-api-v[0-9]+\\.[0-9]+\\.[0-9]+$" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

If the image is unsigned, the safest repair is to rebuild or promote it through the approved release workflow so the signature, SBOM, scan result, and deployment record all match the same digest. Re-signing an image manually can hide the path that created it, so production teams usually reserve manual signing for documented break-glass procedures with a separate trusted identity.

If Rekor or the registry is unavailable, the response depends on the risk level of the service and the policy mode. High-risk production namespaces usually fail closed because an unavailable verifier should block unknown images. During rollout, teams often run new policies in `Audit` first so networking and trust-store problems appear before enforcement. When enforcement is active, a temporary exception should be narrow: one namespace, one image digest, one short expiration, one incident ticket, and one follow-up to remove it.

The failure runbook should end with evidence. The ticket should include the image digest, the expected signer identity, the actual signer identity if one exists, the admission error, and the decision that released or blocked the artifact. That evidence makes the next incident faster and helps reviewers improve the policy.

## Rollout and Rollback Operations
<!-- section-summary: Rollout and rollback work best when every candidate image is digest-pinned and verified before Kubernetes changes the Deployment. -->

Signing and verification need both a build step and an operations plan. The first rollout should start in a lower environment with audit mode. The team gathers policy reports, fixes unsigned sidecars or init containers, and checks that the release workflow signs every image the Deployment needs. Then production can move to enforcement with fewer surprises.

A normal rollout verifies the new digest, updates the Deployment, and waits for Kubernetes to finish the rollout:

```bash
NEW_IMAGE="ghcr.io/meridian-retail/payments-api@sha256:9e3d1f5b7c4a8c6d0e2f4a6b8c1d3e5f7a9b0c2d4e6f8a1b3c5d7e9f0a2b4c6d"

cosign verify "$NEW_IMAGE" \
  --certificate-identity "https://github.com/meridian-retail/payments-api/.github/workflows/release.yml@refs/tags/payments-api-v1.8.3" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

kubectl -n production set image deployment/payments-api payments-api="$NEW_IMAGE"

kubectl -n production rollout status deployment/payments-api
```

Rollback follows the same trust rule. The previous image should already have a digest and a valid signature from the approved release workflow. The release record should store that previous digest so the team avoids searching through mutable tags during an incident.

```bash
PREVIOUS_IMAGE="ghcr.io/meridian-retail/payments-api@sha256:2a4c6e8f0b1d3f5a7c9e0d2f4a6b8c1d3e5f7a9b0c2d4e6f8a1b3c5d7e9f0a"

cosign verify "$PREVIOUS_IMAGE" \
  --certificate-identity "https://github.com/meridian-retail/payments-api/.github/workflows/release.yml@refs/tags/payments-api-v1.8.2" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

kubectl -n production set image deployment/payments-api payments-api="$PREVIOUS_IMAGE"

kubectl -n production rollout status deployment/payments-api
```

`kubectl rollout undo` can still help when the previous ReplicaSet already contains a digest-pinned, signed image. Many teams prefer an explicit rollback digest in the incident ticket because it keeps the verification command, the change record, and the final Deployment image aligned.

The release team also needs a break-glass path before the first emergency. A good break-glass path uses a separate trusted signing identity, requires approval from the incident commander and security owner, records the exact digest, and expires any temporary policy exception after the incident. The goal is to keep production moving during a real outage while preserving the evidence that makes the exception reviewable.

## Putting It All Together
<!-- section-summary: A trusted delivery path signs exact digests, verifies signer identities, enforces the rule in Kubernetes, and rehearses failure handling. -->

The full path for Meridian is now connected. CI builds `payments-api` and pushes it to the registry. The release workflow gets the image digest, signs that digest with Cosign keyless signing, and records the signing event through the Sigstore flow. The deployment job verifies the digest against the expected GitHub Actions identity. Kubernetes admission policy repeats the check at the cluster boundary and rejects workloads outside that rule.

A production review for artifact signing should cover these checks:

| Review area | What the reviewer looks for |
|---|---|
| **Digest discipline** | Deployment manifests use image digests, release records store the exact digest, and tags stay out of the trust decision |
| **Signer identity** | Verification policy names the expected OIDC issuer, repository, workflow, and protected release ref |
| **Workflow protection** | Only trusted maintainers can edit the release workflow, create release tags, or change signing steps |
| **Transparency evidence** | Signing events can be audited through Rekor or the organization's chosen transparency system |
| **Admission enforcement** | Production namespaces enforce signature policy and fail closed for high-risk workloads |
| **Failure runbook** | Responders can check image references, signatures, identities, policy errors, and rollback digests quickly |

![Deploy-time verification infographic showing registry image, admission gate checks for digest, signer, issuer, policy, and Rekor evidence, then allow pod, reject pod, or rollback to last signed digest](/content-assets/articles/article-devsecops-software-supply-chain-artifact-signing-verification/deploy-time-verification.png)

*Deploy-time verification repeats the trust check at the cluster boundary, so production accepts signed digests from approved identities and rejects everything else.*

Daily operation is simple. Production should run artifacts from the trusted release path and reject artifacts that lack evidence for that path. Digests name the exact thing. Signatures attach approval to that thing. OIDC identities explain which workflow signed it. Transparency logs make signing activity reviewable. Admission policy turns all of that into a production gate.

---

**References**

- [Sigstore Cosign signing overview](https://docs.sigstore.dev/cosign/signing/overview/) - Explains Cosign signing flows for container images, including keyless signing.
- [Sigstore Cosign verification](https://docs.sigstore.dev/cosign/verifying/verify/) - Documents signature verification, certificate identity checks, and OIDC issuer checks.
- [Sigstore keyless signing](https://docs.sigstore.dev/certificate_authority/overview/) - Describes how Sigstore uses short-lived certificates and workload identities in keyless signing.
- [Sigstore Rekor](https://docs.sigstore.dev/logging/overview/) - Describes Rekor as Sigstore's transparency log for signing metadata.
- [GitHub Actions OIDC security hardening](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) - Explains GitHub Actions OIDC tokens and the `id-token: write` permission.
- [Kubernetes images](https://kubernetes.io/docs/concepts/containers/images/) - Documents image names, tags, and digest-pinned image references.
- [Kubernetes admission controllers](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/) - Explains admission control in the Kubernetes API request flow.
- [Kyverno verifyImages with Sigstore](https://kyverno.io/docs/policy-types/cluster-policy/verify-images/sigstore/) - Documents Kyverno image signature verification with Cosign, keyless identities, and Rekor.
