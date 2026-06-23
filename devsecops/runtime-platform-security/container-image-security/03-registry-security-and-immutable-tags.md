---
title: "Registry Security and Immutable Tags"
description: "Protect image registries with access control, private connectivity, immutable tags, and digest-based deploys."
overview: "A private registry is the release checkpoint between the CI build that publishes payments-api and the Kubernetes cluster that runs it. This article explains push and pull identities, immutable tags, digest-based deploys, tag promotion, retention, quarantine, audit logs, private connectivity, and rollback with known-good digests."
tags: ["devsecops", "registries", "immutable-tags", "image-digests"]
order: 3
id: article-devsecops-container-image-security-registry-security-immutable-tags
---

## Table of Contents

1. [Why the Registry Is the Release Checkpoint](#why-the-registry-is-the-release-checkpoint)
2. [Private Registries, Repositories, Tags, and Digests](#private-registries-repositories-tags-and-digests)
3. [Separate Push Identity from Pull Identity](#separate-push-identity-from-pull-identity)
4. [Push the Image and Capture the Digest](#push-the-image-and-capture-the-digest)
5. [Immutable Tags and Digest-Based Deploys](#immutable-tags-and-digest-based-deploys)
6. [Promote Tags Without Rebuilding](#promote-tags-without-rebuilding)
7. [Retention, Quarantine, and Release History](#retention-quarantine-and-release-history)
8. [Private Connectivity and Audit Logs](#private-connectivity-and-audit-logs)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Why the Registry Is the Release Checkpoint
<!-- section-summary: The registry connects image evidence from CI to the exact image Kubernetes pulls in production. -->

In the previous part of this module, the `payments-api` team started collecting image evidence. The CI pipeline built a container image, scanned it, created an SBOM, and attached release evidence to the build. That work matters because a container image can carry application code, operating system packages, language packages, startup scripts, certificates, and configuration defaults. If the team wants to know what they are about to run, the image gives them the evidence.

Now the question moves one step forward. After CI creates that image, where does the team put it, and how does Kubernetes know which exact copy to run? That is where the **container registry** enters the story. A container registry stores image manifests, image layers, tags, and sometimes related artifacts such as SBOMs and signatures. For a small team, the registry can look like a simple upload location. In production, it works more like the release checkpoint between build and runtime.

Here is the simple flow for our team:

![Registry release checkpoint infographic showing a CI push role sending payments-api into a private registry, audit logs recording the action, and a Kubernetes pull role receiving the approved digest](/content-assets/articles/article-devsecops-container-image-security-registry-security-immutable-tags/registry-release-checkpoint.png)

*The registry is a release checkpoint: CI can publish, Kubernetes can pull, and the audit log connects those actions to the approved digest.*

The registry has to answer a few security questions. Which pipeline can push `payments-api`? Which Kubernetes cluster can pull it? Can someone overwrite the tag that production uses? Can the team prove that the image deployed on Tuesday is the same image that passed review on Monday? Can they roll back to a known-good digest if the new release breaks checkout?

Those questions connect this article to the rest of the module. Image hardening reduces what goes into the image. Image evidence tells the team what CI produced. Registry security controls who can publish, who can consume, which labels can move, how long images stay available, and which exact bytes Kubernetes receives.

## Private Registries, Repositories, Tags, and Digests
<!-- section-summary: A registry stores image content, a repository groups versions of one image, tags are human labels, and digests identify exact content. -->

A **private registry** is a registry that requires authentication and authorization before clients can push or pull images. The word private can mean a managed cloud service such as Amazon ECR, Azure Container Registry, Google Artifact Registry, GitHub Container Registry, or a self-hosted registry inside a company network. The important part is the access boundary: the `payments-api` image belongs to the team, and random internet users should have no path to read it or replace it.

Inside the registry, a **repository** groups related image versions under one name. For example, the team might use this repository:

```bash
111122223333.dkr.ecr.us-east-1.amazonaws.com/payments-api
```

That repository can contain many releases of the same service: commit builds, staging candidates, production releases, and rollback images. The repository name usually maps to the application or component, so `payments-api`, `payments-worker`, and `fraud-rules-api` would each get their own repository. This gives access policies, retention rules, scan settings, and audit searches a clean boundary.

A **tag** is a human-readable pointer to an image manifest. A tag might look like `sha-4f8c2a1`, `staging-2026-06-21`, `prod-2026-06-21-001`, or `v1.18.3`. Humans like tags because a tag carries meaning. A release manager can understand `prod-2026-06-21-001` faster than a 64-character hash.

A **digest** is a content identifier, usually written as `sha256:...`. A digest comes from a cryptographic hash of the manifest or layer content. If the content changes, the digest changes. That is why digests are so useful for deployment evidence. When Kubernetes pulls `payments-api@sha256:abc...`, the cluster asks for one exact image version instead of whatever a tag happens to point to at that moment.

The OCI Distribution Spec gives these terms their standard meaning across registries. The registry handles push and pull APIs. The repository scopes those API calls. The manifest describes the image. The blobs hold layer content. The tag points at a manifest. The digest identifies content by hash. Docker, Kubernetes, and cloud registries use these ideas so teams can move images through different tools without changing the basic vocabulary.

The practical takeaway for the `payments-api` team is simple: use **tags for workflow labels** and **digests for runtime identity**. CI can publish a tag named after the Git commit. The release job can add a production tag after approval. Kubernetes should deploy the digest that the pipeline recorded after push.

## Separate Push Identity from Pull Identity
<!-- section-summary: CI needs permission to publish images, while Kubernetes needs only enough permission to download approved images. -->

Once the repository exists, the next question is access. The team has two very different callers. The CI pipeline needs to push new image versions after it builds `payments-api`. The Kubernetes cluster needs to pull approved image versions before it starts Pods. These callers have different jobs, so they should have different identities and different permissions.

The **push identity** belongs to automation that publishes images. In a cloud environment, this might be a short-lived federated role assumed by GitHub Actions, GitLab CI, Azure Pipelines, Buildkite, Jenkins, or another build system. In a smaller setup, it might be a registry robot account or service account. The important design is that this identity belongs to CI, has a clear name such as `ci-payments-api-publisher`, and can push only to the `payments-api` repository.

The **pull identity** belongs to the runtime path. Kubernetes pulls images before the application container starts, so the pull identity often sits at the node, kubelet, or image credential layer. In managed Kubernetes with a cloud registry, a node role or workload-specific image credential provider may handle the pull. In a generic Kubernetes cluster, the team may create an `imagePullSecret` in the namespace. The application service account inside the Pod usually handles application API calls after startup, while the image pull identity handles registry access before startup.

Here is a narrow Amazon ECR-style push policy for the CI role. The `GetAuthorizationToken` action uses `Resource: "*"`, while the upload and manifest actions stay scoped to one repository ARN.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GetRegistryLoginToken",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "PushPaymentsApiImages",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": "arn:aws:ecr:us-east-1:111122223333:repository/payments-api"
    }
  ]
}
```

Here is the matching pull policy for a Kubernetes node role or registry pull role. It can authenticate, get the image manifest, and download layers. It has no upload permission, no delete permission, and no permission to change repository settings.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GetRegistryLoginToken",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "PullPaymentsApiImages",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "arn:aws:ecr:us-east-1:111122223333:repository/payments-api"
    }
  ]
}
```

The same shape applies outside AWS. In Azure Container Registry, a pipeline identity might receive push rights to one repository, while the Kubernetes pull identity receives pull rights. In GitHub Container Registry, a GitHub Actions workflow can publish packages, while a cluster gets a read-only token. In a self-hosted registry, the same idea usually appears as robot accounts with repository-scoped permissions.

For a generic Kubernetes cluster, an image pull secret makes the pull identity visible in YAML. The secret stores registry credentials, and the Deployment references it through `imagePullSecrets`. The secret must live in the same namespace as the Pod that uses it.

```bash
kubectl create secret docker-registry payments-api-registry \
  --namespace payments \
  --docker-server=registry.example.com \
  --docker-username="$REGISTRY_PULL_USER" \
  --docker-password="$REGISTRY_PULL_TOKEN"
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  namespace: payments
spec:
  template:
    spec:
      imagePullSecrets:
        - name: payments-api-registry
      containers:
        - name: payments-api
          image: registry.example.com/platform/payments-api:prod-2026-06-21-001
```

This separation helps during incidents. If the CI token leaks, responders can rotate the push identity without changing how the cluster pulls current images. If a node pull credential leaks, responders can revoke read access without giving an attacker the ability to publish a replacement image. The registry stays useful because each identity has one job.

## Push the Image and Capture the Digest
<!-- section-summary: The pipeline should record the digest after push because the registry decides the final manifest identity. -->

Now the CI role has permission to push. The next step is the actual publication flow. A beginner-friendly version of the flow has three pieces: build the image, push it with a useful tag, then record the digest that the registry reports.

For `payments-api`, the team should avoid a release process where every build pushes only `latest`. A commit tag gives each build a unique label. A build number, Git SHA, or source revision works well because the tag connects the registry entry back to source control. The team can still add environment tags later during promotion.

```bash
REGISTRY="111122223333.dkr.ecr.us-east-1.amazonaws.com"
IMAGE="payments-api"
GIT_SHA="4f8c2a19d5be"

docker build \
  --tag "$REGISTRY/$IMAGE:sha-$GIT_SHA" \
  .

docker push "$REGISTRY/$IMAGE:sha-$GIT_SHA"
```

After the push, the registry has the final manifest. That detail matters because the digest the team deploys should come from the registry, especially when the build creates a multi-platform image or the registry stores an image index. The Docker CLI can inspect the remote reference:

```bash
docker buildx imagetools inspect "$REGISTRY/$IMAGE:sha-$GIT_SHA"
```

The output includes a digest line for the image reference. In an ECR-based pipeline, the AWS CLI can return the digest as a machine-friendly value:

```bash
DIGEST=$(aws ecr describe-images \
  --repository-name payments-api \
  --image-ids imageTag="sha-$GIT_SHA" \
  --query 'imageDetails[0].imageDigest' \
  --output text)

echo "$DIGEST"
```

At this point the pipeline has two identifiers. The tag `sha-4f8c2a19d5be` helps humans connect the image to a commit. The digest `sha256:...` identifies the exact manifest Kubernetes should run. A mature pipeline stores both in a release record, along with scan results, SBOM location, signature status, build URL, source commit, and approval state.

Here is a small release record shape:

```json
{
  "service": "payments-api",
  "sourceCommit": "4f8c2a19d5be",
  "sourceTag": "sha-4f8c2a19d5be",
  "digest": "sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
  "registry": "111122223333.dkr.ecr.us-east-1.amazonaws.com",
  "repository": "payments-api",
  "sbom": "oci://111122223333.dkr.ecr.us-east-1.amazonaws.com/payments-api@sha256:...",
  "scanGate": "passed",
  "buildUrl": "https://ci.example.com/payments-api/runs/8421"
}
```

This is where image evidence and registry security join together. The evidence from the previous article has a stable target now. The team can say, "This digest passed the gate, and this digest is what production is allowed to pull."

## Immutable Tags and Digest-Based Deploys
<!-- section-summary: Immutable tags stop accidental tag replacement, and digest deploys make Kubernetes pull the exact approved image. -->

The next risk shows up after the first few releases. Someone pushes `payments-api:prod` on Monday, and Kubernetes deploys it. On Tuesday, another job pushes a different image with the same `prod` tag. Some Pods might still run Monday's image. New Pods might pull Tuesday's image. The tag name stayed the same, while the content behind the tag moved.

This is why teams care about **immutable tags**. An immutable tag setting tells the registry to reject a second push that tries to reuse an existing tag. In Amazon ECR, enabling tag immutability on a repository makes ECR return `ImageTagAlreadyExistsException` when a push tries to overwrite an existing tag. Azure Container Registry can lock image or repository attributes so a tag or digest cannot receive writes or deletes. Different registries expose the control differently, but the production goal stays the same: release tags should keep pointing to the image they named at release time.

For an ECR repository, the setting can be created with the repository:

```bash
aws ecr create-repository \
  --repository-name payments-api \
  --image-tag-mutability IMMUTABLE \
  --image-scanning-configuration scanOnPush=true
```

For an existing repository, the team can update the tag mutability setting:

```bash
aws ecr put-image-tag-mutability \
  --repository-name payments-api \
  --image-tag-mutability IMMUTABLE
```

Immutable tags reduce accidental replacement, but **digest-based deployment** gives the runtime the strongest release identity. Kubernetes supports image references by tag, digest, or tag plus digest. When a reference includes both a tag and a digest, Kubernetes uses the digest for pulling. That means the tag can help humans understand the release, while the digest controls the actual bytes pulled by the cluster.

Here is a Deployment that pins `payments-api` by digest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  namespace: payments
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payments-api
  template:
    metadata:
      labels:
        app: payments-api
    spec:
      containers:
        - name: payments-api
          image: 111122223333.dkr.ecr.us-east-1.amazonaws.com/payments-api@sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
```

Here is the tag-plus-digest form. Some teams like this because the tag keeps the release name visible in manifests, dashboards, and review diffs, while Kubernetes still pulls by digest.

```yaml
image: 111122223333.dkr.ecr.us-east-1.amazonaws.com/payments-api:prod-2026-06-21-001@sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
```

The team should reserve `latest` for development convenience and use a named tag plus digest for production releases. Kubernetes gives `latest` special pull-policy behavior, and humans have a hard time answering which code is running from the word `latest`. A production incident needs specific evidence: commit, build, digest, scan result, deployment time, and rollback target.

![Tag digest promotion infographic showing a production tag, an immutable digest lock, promotion to Kubernetes, rollback, and known-good digest selection](/content-assets/articles/article-devsecops-container-image-security-registry-security-immutable-tags/tag-digest-promotion.png)

*Tags help humans follow releases, while digests give Kubernetes the exact artifact identity for promotion and rollback.*

## Promote Tags Without Rebuilding
<!-- section-summary: Promotion should move approval labels to an already-built digest instead of rebuilding a new image for each environment. -->

Once the team pins deployments by digest, the release flow can get cleaner. The pipeline can build the image once, then promote that same digest through dev, staging, and production. Rebuilding for each environment creates a subtle problem: the team can end up testing one digest and deploying another digest. Even if the source commit is the same, package repositories, base image pulls, build timestamps, and generated files can change between builds.

**Tag promotion** means the team adds a new tag to an existing image manifest after that digest passes a gate. For example, CI pushes `sha-4f8c2a19d5be`. Staging tests pass. Security gates pass. A release approver approves production. The release job then attaches `prod-2026-06-21-001` to the same manifest and deploys the digest from that manifest.

In ECR, retagging can happen without pulling the image layers back to the CI worker. The release job reads the existing manifest and writes it back with a new tag:

```bash
SOURCE_TAG="sha-4f8c2a19d5be"
PROMOTE_TAG="prod-2026-06-21-001"

MANIFEST=$(aws ecr batch-get-image \
  --repository-name payments-api \
  --image-ids imageTag="$SOURCE_TAG" \
  --query 'images[0].imageManifest' \
  --output text)

aws ecr put-image \
  --repository-name payments-api \
  --image-tag "$PROMOTE_TAG" \
  --image-manifest "$MANIFEST"

DIGEST=$(aws ecr describe-images \
  --repository-name payments-api \
  --image-ids imageTag="$PROMOTE_TAG" \
  --query 'imageDetails[0].imageDigest' \
  --output text)
```

The release job can then update a Kubernetes manifest or a GitOps repository with the digest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  namespace: payments
spec:
  template:
    spec:
      containers:
        - name: payments-api
          image: 111122223333.dkr.ecr.us-east-1.amazonaws.com/payments-api:prod-2026-06-21-001@sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
```

Here is a compact CI sketch that shows the release shape. The exact syntax will change by CI system, but the separation of jobs matters more than the product name.

```yaml
name: payments-api-release

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - name: Build and push commit image
        run: |
          IMAGE="$REGISTRY/payments-api:sha-$GITHUB_SHA"
          docker build --tag "$IMAGE" .
          docker push "$IMAGE"
          aws ecr describe-images \
            --repository-name payments-api \
            --image-ids imageTag="sha-$GITHUB_SHA" \
            --query 'imageDetails[0].imageDigest' \
            --output text > digest.txt
      - name: Store release evidence
        run: |
          echo "digest=$(cat digest.txt)" >> "$GITHUB_OUTPUT"

  promote:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    permissions:
      id-token: write
      contents: write
    steps:
      - name: Promote approved digest
        run: |
          SOURCE_TAG="sha-$GITHUB_SHA"
          PROMOTE_TAG="prod-$(date +%Y-%m-%d)-${GITHUB_RUN_NUMBER}"
          MANIFEST=$(aws ecr batch-get-image \
            --repository-name payments-api \
            --image-ids imageTag="$SOURCE_TAG" \
            --query 'images[0].imageManifest' \
            --output text)
          aws ecr put-image \
            --repository-name payments-api \
            --image-tag "$PROMOTE_TAG" \
            --image-manifest "$MANIFEST"
```

Notice the workflow shape. Build publishes once. Evidence attaches to that one pushed image. Promotion adds a release label to the same content. Deployment uses the digest. This keeps the registry as the place where release approval meets exact image identity.

## Retention, Quarantine, and Release History
<!-- section-summary: Cleanup rules save space, quarantine prevents risky pulls, and release history keeps rollback digests available. -->

After a few months, the `payments-api` repository will fill with images. Every commit build creates a tag. Every staging test creates a candidate. Every production release creates a release tag. The registry needs cleanup, but cleanup has to respect production rollback.

**Retention** means the registry expires images based on age, count, tag pattern, or other rules. A useful retention policy treats different tags differently. Short-lived CI tags can expire quickly. Production tags should stay longer. Known-good rollback digests should stay available as long as the team needs them for incident response and compliance.

Here is an ECR lifecycle policy shape for a build repository where short-lived candidate tags start with `sha-` and production tags live in a separate release repository. This separation keeps cleanup simple because the build repository holds disposable candidates, while the release repository holds rollback history.

```json
{
  "rules": [
    {
      "rulePriority": 10,
      "description": "Expire old commit images after 14 days",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["sha-"],
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 14
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
```

For the release repository, a second policy can keep a practical number of production releases:

```json
{
  "rules": [
    {
      "rulePriority": 10,
      "description": "Keep the most recent 30 production releases",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["prod-"],
        "countType": "imageCountMoreThan",
        "countNumber": 30
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
```

The build repository policy can be applied like this:

```bash
aws ecr put-lifecycle-policy \
  --repository-name payments-api-builds \
  --lifecycle-policy-text file://payments-api-builds-lifecycle.json
```

The team should preview cleanup rules before applying them, especially if Kubernetes uses digest-pinned deployments. Some registries treat untagged manifests differently from tagged images, and a single manifest can carry more than one tag. If a shared repository keeps both `sha-*` and `prod-*` tags on the same manifest, the team should avoid a rule that deletes a production digest just because it also has an old short-lived tag. A practical release process keeps a release tag on every digest that might be deployed or rolled back, such as `prod-2026-06-21-001` or `rollback-safe-2026-q2`.

**Quarantine** means a newly pushed image waits in a restricted place until it passes gates. Some registries have explicit quarantine or locking controls. Many teams implement the same idea with repository separation. For example, CI pushes to `payments-api-builds`, scanners and policy checks run there, and the release job copies or promotes the approved manifest into `payments-api-release`. Kubernetes has pull permission only on the release repository.

That separation gives the team a clean safety line:

| Repository | Who can push | Who can pull | Typical tags |
|---|---|---|---|
| `payments-api-builds` | CI build identity | CI, scanners, release automation | `sha-*`, `candidate-*` |
| `payments-api-release` | Release identity only | Kubernetes pull identity | `prod-*`, `rollback-safe-*` |

Rollback needs the same discipline. A **known-good digest** is a digest that the team has already deployed or tested and kept in release history. When a new deployment breaks checkout, the incident commander should have a small list of previous production digests instead of searching old pipeline logs under pressure.

Here is a simple rollback record:

```json
[
  {
    "release": "prod-2026-06-21-001",
    "digest": "sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
    "sourceCommit": "4f8c2a19d5be",
    "deployedAt": "2026-06-21T14:20:00Z",
    "status": "known-good"
  },
  {
    "release": "prod-2026-06-14-004",
    "digest": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "sourceCommit": "a1b2c3d4e5f6",
    "deployedAt": "2026-06-14T10:05:00Z",
    "status": "known-good"
  }
]
```

The rollback action can update the Deployment to a previous digest:

```bash
KNOWN_GOOD_DIGEST="sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
IMAGE="111122223333.dkr.ecr.us-east-1.amazonaws.com/payments-api@$KNOWN_GOOD_DIGEST"

kubectl set image deployment/payments-api \
  payments-api="$IMAGE" \
  --namespace payments

kubectl rollout status deployment/payments-api \
  --namespace payments
```

Many production teams use GitOps instead of direct `kubectl set image`. In that case, the rollback changes the image field in the environment repository, reviewers approve the change, and the GitOps controller applies it. The registry part stays the same: the known-good digest must still exist, the Kubernetes pull identity must still have permission, and audit logs should show the pull.

## Private Connectivity and Audit Logs
<!-- section-summary: Network controls decide where registry traffic can flow, and audit logs show who changed or pulled release artifacts. -->

Access policies answer who can use the registry. Network controls answer where registry traffic can travel. For a small team, a public registry endpoint with strong authentication may be enough. For a payments system, teams often add private connectivity so CI runners and Kubernetes nodes reach the registry through private network paths.

A **private endpoint** gives a resource inside a private network a private IP path to a managed service. For example, Amazon ECR can use AWS PrivateLink interface endpoints, and Azure Container Registry can use Azure Private Link private endpoints. This means Kubernetes nodes in private subnets can pull images without a general internet path to the registry endpoint. The details vary by provider, especially around DNS, endpoint policies, and layer storage.

In AWS, ECR pulls involve ECR APIs and image layers stored behind S3-backed infrastructure. That is why private ECR access often needs both ECR interface endpoints and an S3 gateway endpoint for the layer downloads. In Azure, private endpoints require private DNS to resolve the registry name to private IP addresses, and managed CI services may need self-hosted agents with network line of sight after public access is disabled.

The production design question is practical: can the `payments-api` release path reach the registry while other paths cannot? A common setup looks like this:

| Caller | Network path | Registry permission |
|---|---|---|
| CI build runner | Private runner subnet or controlled outbound IPs | Push to build repository |
| Scanner | Private runner subnet | Pull candidate images and attach findings |
| Release job | Private runner subnet | Retag or promote approved digests |
| Kubernetes nodes | Private cluster subnet | Pull release repository only |
| Developer laptops | No direct production push path | Read-only or no production registry access |

Network controls and audit logs work together. Network rules narrow where registry traffic can come from, and **audit logging** records who called the registry API, what action they took, when they took it, and where the request came from. In ECR, CloudTrail records API calls such as `PutImage`, `BatchGetImage`, repository setting changes, delete actions, and lifecycle policy actions. Other registries expose similar events through cloud audit logs or registry logs.

Here are useful ECR events to search during release review or incident response:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=PutImage \
  --max-results 20

aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=DeleteRepository \
  --max-results 20

aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=PutImageTagMutability \
  --max-results 20
```

The team should alert on a few high-signal events. A human identity pushing to the production repository deserves review. A repository changing from immutable to mutable deserves review. A delete action against a release repository deserves review. Repeated denied pulls from a Kubernetes namespace can point to a broken pull secret, an expired token, or a workload trying to use an image it should not reach.

Audit logs turn registry controls into evidence. During an incident, the team can connect the release record, the tag promotion event, the Kubernetes deployment change, and the registry pull events. That chain helps them answer whether production ran the digest that passed the gate.

## Putting It All Together
<!-- section-summary: A secure registry flow gives each release one pushed image, one approved digest, controlled identities, and a rollback path. -->

Now put the pieces back into the `payments-api` story. A small team can start with a modest release pipeline on day one, as long as the registry flow keeps the release identity stable.

The build job uses a short-lived CI identity named `ci-payments-api-publisher`. It builds the container once, pushes it to a private repository with a commit tag, captures the digest from the registry, and stores the digest with the scan and SBOM evidence. That one digest is the object the rest of the release process talks about.

The registry uses least-privilege access. CI can push only to the build repository. The scanner can pull candidates and attach findings. The release job can add production tags to approved manifests. Kubernetes can pull only from the release repository or approved repository path. Human developers do not get broad production push rights for normal work.

The repository protects release tags. Immutable tag settings or registry lock controls reject accidental overwrites. Production deployment manifests use digest references, often with a helpful tag next to the digest. Kubernetes pulls the digest, so a tag movement cannot quietly change the image that new Pods receive.

Retention and quarantine keep operations clean. CI tags expire after a short window. Production tags stay long enough for rollback and audit. Candidate images stay away from the Kubernetes pull identity until scan, policy, and approval gates pass. Known-good digests live in release history, and rollback updates Kubernetes to one of those digests.

Private connectivity and audit logging close the loop. CI runners and cluster nodes reach the registry through controlled network paths where the environment requires it. Registry audit logs show `PutImage`, promotion, pull, delete, lifecycle, and settings changes. When the team asks what happened during a release, the registry can answer with events instead of guesses.

Here is the compact checklist the team can keep next to the release pipeline:

| Control | Production target for `payments-api` |
|---|---|
| Private registry | `payments-api` stored in a private repository |
| Push identity | CI role can push only build images |
| Pull identity | Kubernetes pull identity can pull only approved images |
| Immutable tags | Release tags cannot be overwritten |
| Digest deployment | Kubernetes manifest references `@sha256:...` |
| Promotion | Approval adds a tag to the existing digest |
| Retention | CI images expire, release and rollback digests stay available |
| Quarantine | Candidate images stay away from production pull access |
| Private connectivity | CI and cluster reach registry through approved network paths |
| Audit logging | Registry changes and pulls appear in audit logs |

![Registry controls summary infographic showing least privilege, immutable tags, digest deploys, retention, quarantine, private access, and audit logs around the payments-api private registry](/content-assets/articles/article-devsecops-container-image-security-registry-security-immutable-tags/registry-controls-summary.png)

*Registry security works as a set of small controls around one release path: publish narrowly, deploy by digest, keep rollback history, and log the changes.*

That is the registry's job in the container security story. It keeps the path from build evidence to runtime deployment traceable, controlled, and reversible.

## What's Next

The registry controls which image Kubernetes can pull. The next article moves inside the cluster after the pull succeeds. We will look at **container runtime isolation**: how namespaces, cgroups, Linux capabilities, seccomp, AppArmor or SELinux, read-only filesystems, and Kubernetes security settings limit what the `payments-api` container can do while it is running.

---

**References**

- [OCI Distribution Specification](https://github.com/opencontainers/distribution-spec/blob/main/spec.md) - Defines registry, repository, push, pull, tag, manifest, blob, and digest concepts used by compliant registries.
- [Kubernetes Images](https://kubernetes.io/docs/concepts/containers/images/) - Documents image names, tags, digests, pull policies, digest pinning, and private registry pull configuration.
- [Kubernetes Pull an Image from a Private Registry](https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/) - Shows how Kubernetes uses image pull secrets for private registries.
- [Docker image digests](https://docs.docker.com/dhi/core-concepts/digests/) - Explains Docker image digests as SHA-256 content identifiers.
- [Amazon ECR tag immutability](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html) - Documents repository tag immutability and the CLI commands for ECR.
- [Amazon ECR retagging](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-retag.html) - Shows how to retag an existing ECR image manifest without pulling and pushing layers again.
- [Amazon ECR lifecycle policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html) - Documents image cleanup rules, previews, and lifecycle policy behavior.
- [Amazon ECR image scanning](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html) - Documents ECR basic and enhanced scanning modes.
- [Amazon ECR CloudTrail logging](https://docs.aws.amazon.com/AmazonECR/latest/userguide/logging-using-cloudtrail.html) - Lists ECR events captured through AWS CloudTrail for audit and incident response.
- [Amazon ECR VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html) - Explains PrivateLink access to ECR APIs and required S3 gateway endpoint considerations for layer pulls.
- [Azure Container Registry image locking](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-image-lock) - Documents locking images, repositories, and read/write/delete attributes in ACR.
- [Azure Container Registry private endpoints](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-private-endpoints) - Documents private endpoint setup, DNS, and access considerations for ACR.
- [Azure Container Registry retention policy](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-retention-policy) - Documents retention behavior for untagged manifests and the caution for digest-based pulls.
