---
title: "Artifact Signing and Verification"
description: "Use digests, signatures, signer identity, keyless signing, transparency logs, deploy-time verification, Kubernetes admission, failure handling, and rollback controls."
overview: "Start with the sealed delivery box from the DevSecOps trust model. Follow one Harbor Books image from digest to signature, signer identity, Cosign keyless signing, Rekor, deploy-time verification, Kubernetes admission policy, failure handling, and rollback."
tags: ["devsecops", "signing", "cosign", "verification"]
order: 4
id: article-devsecops-software-supply-chain-artifact-signing-verification
---

## Table of Contents

1. [The Sealed Delivery Box](#the-sealed-delivery-box)
2. [Digest First](#digest-first)
3. [What a Signature Proves](#what-a-signature-proves)
4. [Signer Identity](#signer-identity)
5. [Cosign Keyless Signing](#cosign-keyless-signing)
6. [Transparency Logs and Rekor](#transparency-logs-and-rekor)
7. [Public Key and Keyless Flows](#public-key-and-keyless-flows)
8. [Deploy-Time Verification](#deploy-time-verification)
9. [Kubernetes Admission Policy](#kubernetes-admission-policy)
10. [Failure Handling](#failure-handling)
11. [Rollback](#rollback)
12. [Production Checklist](#production-checklist)
13. [References](#references)

## The Sealed Delivery Box
<!-- section-summary: Artifact signing is the sealed-box check from the delivery trust model, applied to exact software artifacts. -->

In the delivery trust model, Harbor Books treats a finished release like a sealed delivery box. The kitchen can prepare the meal correctly, but the waiter still checks the seal before handing it to the customer. Software delivery needs the same kind of final artifact check before production runs a workload.

For `checkout-api`, the sealed box is the container image digest in the registry. The build already created an SBOM and provenance attestation. Now the release system needs to attach a cryptographic approval to the exact digest, and production needs to verify that approval before a Pod starts.

**Artifact signing** means creating a signature for a release artifact. **Artifact verification** means checking the artifact, signature, signer identity, and policy before accepting it. The four pieces work together:

| Piece | Plain meaning | Harbor Books example |
|---|---|---|
| Digest | Exact content identifier | `ghcr.io/harborbooks/checkout-api@sha256:9f3e...` |
| Signature | Cryptographic approval for that digest | Cosign signs the image digest |
| Signer identity | Who or what signed it | GitHub Actions release workflow |
| Verification policy | Which signatures production accepts | Deployment and admission checks require the expected workflow identity |

The rest of the article follows that path. Pin the image to a digest, sign the digest, verify the signer identity, record the signing event, enforce the rule during deployment, and keep a failure and rollback runbook ready.

## Digest First
<!-- section-summary: A digest identifies exact artifact content, so signing and deployment can refer to one unchanging image. -->

A **digest** is a content-based identifier. For container images, registries use hashes such as `sha256:...` to identify the image manifest. If the image content changes, the digest changes. That gives signing and deployment one stable object to discuss.

Tags are readable labels. Harbor Books may tag an image as `checkout-api-v2.4.2` for release notes. A tag can point to a different digest later if someone pushes again. The digest is the value the release should sign and the value production should run.

The build can push a tag:

```bash
docker buildx build \
  --platform linux/amd64 \
  --tag ghcr.io/harborbooks/checkout-api:checkout-api-v2.4.2 \
  --push .
```

The command builds a Linux AMD64 image, tags it for humans, and pushes it to the registry. After the push, the pipeline should read the digest behind the tag:

```bash
docker buildx imagetools inspect ghcr.io/harborbooks/checkout-api:checkout-api-v2.4.2
```

Example output:

```bash
Name:      ghcr.io/harborbooks/checkout-api:checkout-api-v2.4.2
MediaType: application/vnd.oci.image.index.v1+json
Digest:    sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

The release record should carry the digest form:

```bash
IMAGE="ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6"
```

That exact image reference is the signing target, the verification target, and the deployment target.

![Trust the digest infographic showing a movable tag, pinned digest, signature, verifier, and allow decision](/content-assets/articles/article-devsecops-software-supply-chain-artifact-signing-verification/trust-the-digest.png)

*Signing follows the digest because the digest identifies exact artifact content while a tag is a movable label.*

## What a Signature Proves
<!-- section-summary: A signature binds a trusted approval to an artifact digest so verifiers can check integrity and origin. -->

A **digital signature** is cryptographic proof that a trusted signer approved a specific piece of data. In container signing, the data is usually the image digest. The signing tool creates signature material for that digest and stores it where verifiers can find it.

For `checkout-api`, the useful production question is: did the approved release path sign this exact digest? A signature helps answer that question. It shows that the digest has an approval attached, and verification checks whether the signer is one Harbor Books trusts.

Cosign is the signing tool from the Sigstore project. With a traditional key pair, Harbor Books could create a private key and public key:

```bash
cosign generate-key-pair
cosign sign --key cosign.key "$IMAGE"
cosign verify --key cosign.pub "$IMAGE"
```

`cosign generate-key-pair` creates signing and verification keys. `cosign sign --key` signs the digest with the private key. `cosign verify --key` verifies the signature with the public key. The private key is powerful because anyone who can use it can sign artifacts that look trusted.

Signatures give two kinds of evidence. **Integrity** means the digest being verified is the same digest that was signed. **Origin** means the signature came from an approved signing source. Tests, scanners, SBOMs, and provenance still answer other release questions. The signature attaches the release approval to the exact artifact production wants to run.

Key management is where many teams spend operational effort. Private keys need storage, access control, rotation, revocation, audit logs, and break-glass procedures. Keyless signing reduces that key-management load by using workload identity.

## Signer Identity
<!-- section-summary: Verification policy should check which person, key, workflow, or workload identity signed the artifact. -->

**Signer identity** is the identity behind the signature. A signature alone says a key or identity approved a digest. Verification policy says which signers count as trusted for a given artifact.

For Harbor Books, production should trust the `checkout-api` release workflow on protected release refs. It should reject a signature from a developer laptop, a test workflow, a fork, or an unreviewed branch. That rule makes signer identity as important as the cryptographic signature.

In a public-key flow, signer identity usually maps to a public key, key management service key, HSM key, or signing service account. The policy asks whether the signature verifies with the expected key and whether the key is still trusted.

In a keyless flow, signer identity comes from a workload identity token and certificate. For GitHub Actions, the identity can include repository, workflow path, branch or tag, and issuer. Harbor Books can require a signer identity like this:

```bash
https://github.com/harborbooks/checkout-api/.github/workflows/release-checkout.yml@refs/tags/checkout-api-v2.4.2
```

This identity names the GitHub repository, workflow file, and release tag. A renamed workflow, different branch, or different repository should fail verification unless policy has been updated and reviewed.

## Cosign Keyless Signing
<!-- section-summary: Keyless signing lets CI sign an artifact through short-lived OIDC identity instead of storing a long-lived private key. -->

**Keyless signing** means the CI job signs through a short-lived workload identity rather than a long-lived private signing key stored in CI secrets. Cryptography still uses keys under the hood. The operational change keeps a permanent private key out of workflow secrets.

The identity usually comes from **OpenID Connect**, or **OIDC**. OIDC lets a CI platform issue a signed token that says which workload is running. In GitHub Actions, the token can identify the repository, workflow file, ref, and job context. Sigstore can bind that identity into a short-lived signing certificate.

![Keyless signing flow infographic showing CI job, OIDC, Fulcio, Cosign, Rekor, and registry stages connected through a signing pipeline](/content-assets/articles/article-devsecops-software-supply-chain-artifact-signing-verification/keyless-signing-flow.png)

*Keyless signing lets the CI job use a short-lived workload identity, sign the digest, record the event, and publish evidence for verifiers.*

A GitHub Actions release job can sign the image digest with Cosign:

```yaml
name: release-checkout

on:
  push:
    tags:
      - "checkout-api-v*"

permissions:
  contents: read
  packages: write
  id-token: write

jobs:
  build-sign:
    runs-on: ubuntu-24.04
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
          tags: ghcr.io/harborbooks/checkout-api:${{ github.ref_name }}

      - name: Sign image digest
        env:
          IMAGE: ghcr.io/harborbooks/checkout-api@${{ steps.build.outputs.digest }}
        run: cosign sign --yes "$IMAGE"
```

`id-token: write` lets the job request a GitHub OIDC token. Cosign uses that workload identity during keyless signing. `packages: write` lets the workflow push the image. In production, Harbor Books would protect release tags, restrict who can edit the workflow, and pin third-party actions to reviewed versions or commit SHAs.

After this job runs, production can verify the exact digest and the identity that signed it.

## Transparency Logs and Rekor
<!-- section-summary: Rekor records Sigstore signing events in an append-only log so teams can audit artifact signing history. -->

A **transparency log** is an append-only record of security events. Append-only logs help auditors and verifiers review signing history and detect unexpected events. Sigstore's transparency log is **Rekor**.

With public Sigstore keyless signing, Cosign can record signing metadata in Rekor. A verifier can check that the signature, certificate, and log entry line up. Harbor Books can also search for unexpected signing activity, such as a different workflow signing the same image repository.

The normal verification command checks the image signature and identity constraints together:

```bash
cosign verify "$IMAGE" \
  --certificate-identity "https://github.com/harborbooks/checkout-api/.github/workflows/release-checkout.yml@refs/tags/checkout-api-v2.4.2" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

`--certificate-identity` names the exact workflow identity Harbor Books trusts. `--certificate-oidc-issuer` pins the identity provider to GitHub Actions. The final argument, `$IMAGE`, must be the digest-pinned image reference.

Example output:

```bash
Verification for ghcr.io/harborbooks/checkout-api@sha256:9f3e...
The following checks were performed:
  - The cosign claims were validated
  - The certificate was verified against Fulcio roots
  - The certificate identity matched the expected identity
```

Some organizations use private Sigstore deployments or private transparency systems when artifact names, repository names, or release timing are sensitive. The production habit stays the same: signing events should leave reviewable evidence, and verification should check that evidence before accepting an artifact.

## Public Key and Keyless Flows
<!-- section-summary: Public-key signing and keyless signing both sign digests, but they place trust in different operational systems. -->

Public-key signing and keyless signing both create signatures over artifact digests. The difference is where Harbor Books places trust.

| Flow | What production trusts | Strong fit | Operations work |
|---|---|---|---|
| Public key | A public key, KMS key, HSM key, or signing service | Internal build systems, offline releases, regulated key custody | Key storage, access control, rotation, revocation, backup, and audit |
| Keyless | OIDC issuer, signing certificate, workflow identity, transparency log, and policy constraints | CI systems with strong workload identity and protected workflows | OIDC permissions, workflow protection, identity matching, and log monitoring |

Harbor Books may use both. The platform team might sign a base image with a KMS-backed key. The `checkout-api` release workflow might use GitHub Actions keyless signing because the workflow identity clearly names the repository, workflow, and ref.

The signature should never stand alone as the whole trust rule. A public key can be used by too many systems. A keyless workflow can allow too many refs. Verification policy should say exactly which key or identity can sign which artifact for which environment.

## Deploy-Time Verification
<!-- section-summary: A deployment gate verifies digest, signature, OIDC issuer, and signer identity before updating production. -->

**Verification** is the act of checking an artifact against the trust rule. For `checkout-api`, the rule says production images must be digest-pinned and signed by the release workflow in `harborbooks/checkout-api` through GitHub Actions OIDC.

The deployment job should verify the same image reference it plans to deploy:

```bash
IMAGE="ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6"

cosign verify "$IMAGE" \
  --certificate-identity "https://github.com/harborbooks/checkout-api/.github/workflows/release-checkout.yml@refs/tags/checkout-api-v2.4.2" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

kubectl -n checkout set image deployment/checkout-api checkout-api="$IMAGE"
```

The Cosign command runs first. It verifies the signature and identity for the digest-pinned image. `kubectl set image` runs only after that check succeeds. The Deployment then references the exact signed digest.

Deployment verification catches common release mistakes. A tag-only manifest can be rejected before rollout. A signature from a test workflow fails the identity check. A new image pushed under the same tag after release leaves the digest in the manifest unchanged.

Every deployment path should use the same rule. A script, GitOps controller, emergency command, and release pipeline should all converge on digest-pinned signed images.

## Kubernetes Admission Policy
<!-- section-summary: Admission policy repeats verification at the cluster boundary so untrusted images fail before Pods start. -->

**Admission control** is the Kubernetes checkpoint that evaluates a request before the API server stores it. After authentication and authorization, admission controllers can validate or mutate objects. Image verification policies use that checkpoint to inspect Pod images before they run.

Admission policy helps because production clusters receive changes from several paths. A GitOps controller may sync a manifest. A release job may run `kubectl`. An on-call engineer may apply an emergency patch. The cluster should still enforce one rule for production namespaces.

Many teams use Kyverno, Sigstore policy-controller, or another admission system. This Kyverno example verifies keyless Cosign signatures for `checkout-api`:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-signed-checkout-api
spec:
  webhookConfiguration:
    failurePolicy: Fail
    timeoutSeconds: 30
  background: false
  rules:
    - name: verify-checkout-api-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaces:
                - checkout
      verifyImages:
        - imageReferences:
            - "ghcr.io/harborbooks/checkout-api*"
          mutateDigest: true
          verifyDigest: true
          required: true
          failureAction: Enforce
          attestors:
            - entries:
                - keyless:
                    subjectRegExp: "^https://github\\.com/harborbooks/checkout-api/\\.github/workflows/release-checkout\\.yml@refs/tags/checkout-api-v[0-9]+\\.[0-9]+\\.[0-9]+$"
                    issuer: "https://token.actions.githubusercontent.com"
                    rekor:
                      url: "https://rekor.sigstore.dev"
```

`imageReferences` scopes the rule to the image repository. `mutateDigest` lets the policy engine resolve supported tag references to digests. `verifyDigest` requires a digest. `required` makes a missing signature fail. `failureAction: Enforce` blocks the request.

The keyless `subjectRegExp` allows release workflow signatures on release tags and excludes other refs. `issuer` pins GitHub Actions as the OIDC issuer. `rekor.url` tells the verifier which transparency log to use.

The rollout should test both paths:

```bash
kubectl apply -f require-signed-checkout-api.yaml

kubectl -n checkout apply -f signed-checkout-api-deployment.yaml

kubectl -n checkout run unsigned-test \
  --image=ghcr.io/harborbooks/checkout-api:dev-local \
  --restart=Never
```

The signed Deployment should pass. The unsigned test Pod should fail admission. That failure is a successful test because the cluster rejected an untrusted artifact before a node pulled it.

## Failure Handling
<!-- section-summary: Verification failures need a runbook that checks image reference, signature, signer identity, policy, and release source. -->

Verification failures usually appear during a release window, so Harbor Books needs a calm runbook. A failure may mean the image lacks a signature, the manifest points to the wrong digest, the signer identity changed, Rekor is unreachable, or someone tried to deploy from outside the approved path.

The first check is the image reference:

```bash
kubectl -n checkout get events --sort-by='.lastTimestamp'

kubectl -n checkout get deployment checkout-api \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="checkout-api")].image}{"\n"}'
```

The events command shows admission or rollout errors. The JSONPath command prints the image currently configured in the Deployment. The responder checks for a digest-pinned reference and compares it with the release record.

The next check is the signature identity:

```bash
cosign verify "$IMAGE" \
  --certificate-identity-regexp "^https://github\\.com/harborbooks/checkout-api/\\.github/workflows/release-checkout\\.yml@refs/tags/checkout-api-v[0-9]+\\.[0-9]+\\.[0-9]+$" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

The regular expression allows release tags that match the expected pattern. A failure may point to a renamed workflow, an unprotected branch, a missing signature, or a policy expression that no longer matches the release process.

If the image is unsigned, the safest repair is to rebuild or promote it through the approved release workflow so signature, SBOM, provenance, scan result, and deployment record all point to the same digest. Manual re-signing should use a documented break-glass identity, narrow approval, a short-lived exception, and an incident ticket.

If Rekor, the registry, or the admission verifier is unavailable, the response depends on the namespace risk. High-risk production namespaces usually fail closed. During early rollout, teams often run new policies in audit mode first so network and trust-store problems surface before enforcement.

Every failure ticket should include image digest, expected signer identity, actual signer identity if present, policy error, admission event, release record, and final decision. That evidence helps the next response and improves the policy.

## Rollback
<!-- section-summary: Rollback should use a previously signed digest and the same verification rule as forward deployment. -->

Rollback is part of signing design. The previous production image should already have a digest, signature, SBOM, provenance, and release record. During an incident, the team should verify the rollback digest before updating Kubernetes.

```bash
PREVIOUS_IMAGE="ghcr.io/harborbooks/checkout-api@sha256:2a4c6e8f0b1d3f5a7c9e0d2f4a6b8c1d3e5f7a9b0c2d4e6f8a1b3c5d7e9f0a"

cosign verify "$PREVIOUS_IMAGE" \
  --certificate-identity "https://github.com/harborbooks/checkout-api/.github/workflows/release-checkout.yml@refs/tags/checkout-api-v2.4.1" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

kubectl -n checkout set image deployment/checkout-api checkout-api="$PREVIOUS_IMAGE"

kubectl -n checkout rollout status deployment/checkout-api
```

The command verifies the old signed digest, updates the Deployment, and waits for rollout completion. The release record should store `PREVIOUS_IMAGE` so responders avoid searching through tags during a stressful incident.

`kubectl rollout undo` can help when the previous ReplicaSet already contains a digest-pinned signed image. Many teams still prefer an explicit rollback digest in the incident ticket because it keeps verification, change record, and final Deployment image aligned.

Break-glass rollback should be rare and documented before the emergency. A narrow temporary exception should name one namespace, one digest, one signer or approval path, one expiry, and one incident ticket. After the incident, remove the exception and rebuild the artifact through the normal signed path.

## Production Checklist
<!-- section-summary: A trusted artifact path signs exact digests, verifies signer identity, enforces admission policy, and rehearses rollback. -->

The signed delivery path for Harbor Books is now complete. CI builds `checkout-api`, captures the image digest, signs that digest through Cosign keyless signing, and records the signing event. The deployment job verifies the signature and workflow identity. Kubernetes admission repeats the check at the cluster boundary. Rollback uses the same rule.

| Review area | What Harbor Books checks |
|---|---|
| Digest discipline | Manifests and release records use digest-pinned image references |
| Signature coverage | Every production image, sidecar, and init container has a valid signature |
| Signer identity | Policy names the expected OIDC issuer, repository, workflow, and release ref |
| Workflow protection | Trusted maintainers review changes to signing workflows and release tags |
| Transparency evidence | Rekor or the chosen transparency system records signing activity |
| Admission enforcement | Production namespaces enforce signature policy and fail closed |
| Failure handling | Responders can inspect image refs, signatures, identities, policy errors, and release records |
| Rollback | Previous signed digests are stored and verified before rollback |

![Deploy-time verification infographic showing registry image, admission gate checks for digest, signer, issuer, policy, and Rekor evidence, then allow pod, reject pod, or rollback to last signed digest](/content-assets/articles/article-devsecops-software-supply-chain-artifact-signing-verification/deploy-time-verification.png)

*Deploy-time verification repeats the sealed-box check at the cluster boundary before production runs the artifact.*

Daily operation should feel predictable. Digests name the exact thing. Signatures attach approval to that thing. Signer identity explains which release path approved it. Transparency logs make signing activity reviewable. Admission policy turns the evidence into an enforceable production rule.

---

## References

- [Sigstore Cosign signing overview](https://docs.sigstore.dev/cosign/signing/overview/) - Sigstore documentation for Cosign signing flows, including keyless signing.
- [Sigstore Cosign verification](https://docs.sigstore.dev/cosign/verifying/verify/) - Sigstore documentation for verifying signatures, certificate identities, and OIDC issuers.
- [Sigstore certificate authority overview](https://docs.sigstore.dev/certificate_authority/overview/) - Sigstore documentation for Fulcio and keyless signing certificates.
- [Sigstore Rekor](https://docs.sigstore.dev/logging/overview/) - Sigstore documentation for Rekor transparency logging.
- [GitHub Actions OIDC security hardening](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) - GitHub documentation for OIDC tokens and `id-token: write`.
- [Kubernetes images](https://kubernetes.io/docs/concepts/containers/images/) - Kubernetes documentation for image names, tags, and digest references.
- [Kubernetes admission controllers](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/) - Kubernetes documentation for the admission control request flow.
- [Kyverno verifyImages with Sigstore](https://kyverno.io/docs/policy-types/cluster-policy/verify-images/sigstore/) - Kyverno documentation for Cosign and keyless image verification.
