---
title: "Pipeline Secrets"
description: "Teach how ML pipelines use short-lived identities, external secret stores, Kubernetes injection, rotation, scanning, and audit logs safely."
overview: "Pipeline secrets are the credentials and sensitive connection details that let training and deployment jobs reach warehouses, artifact stores, registries, and tracking systems. This tutorial follows a Kubernetes training pipeline that uses workload identity, External Secrets Operator, scoped Kubernetes Secrets, rotation, CI scanning, and release evidence checks."
tags: ["MLOps", "production", "security"]
order: 2
id: "article-mlops-governance-and-responsible-ai-secrets-credentials-in-ml-pipelines"
---

## Table of Contents

1. [What Pipeline Secrets Are](#what-pipeline-secrets-are)
2. [The Kubernetes Training Scenario](#the-kubernetes-training-scenario)
3. [Separate Identity From Secret Values](#separate-identity-from-secret-values)
4. [Sync Secrets From an External Store](#sync-secrets-from-an-external-store)
5. [Inject Secrets Into Training Jobs](#inject-secrets-into-training-jobs)
6. [Scan CI and Pull Requests](#scan-ci-and-pull-requests)
7. [Rotation and Incident Response](#rotation-and-incident-response)
8. [Release Evidence and Audit Logs](#release-evidence-and-audit-logs)
9. [Practical Checks, Mistakes, and Interview Understanding](#practical-checks-mistakes-and-interview-understanding)
10. [References](#references)

## What Pipeline Secrets Are
<!-- section-summary: Pipeline secrets are sensitive values and credentials that let ML jobs reach private systems during training, evaluation, and release. -->

Pipeline secrets are the sensitive values that ML jobs use to reach other systems. They can include database passwords, tracking server tokens, artifact registry credentials, API keys, TLS client certificates, webhook signing keys, and connection strings. In MLOps, secrets appear in training jobs, evaluation jobs, model registration jobs, deployment jobs, and monitoring jobs.

The safest direction is to reduce secret values wherever you can. Use workload identity, short-lived tokens, and scoped service accounts for cloud access. Keep long-lived values in an external secret manager when a system still needs them. Sync only the few values a namespace or job needs. Inject them at runtime. Rotate them. Scan code and CI logs so secrets stay out of Git. Keep audit logs so you can answer who used or changed a credential.

For a beginner, the key distinction is **identity versus secret value**. A Kubernetes ServiceAccount or cloud workload identity tells the platform which workload is running. A secret value is a password, token, or key. Good pipelines use identity for cloud permissions and reserve secret values for systems that still require a credential.

## The Kubernetes Training Scenario
<!-- section-summary: A Kubernetes training pipeline needs secrets for tracking, databases, registries, and notifications while keeping cloud permissions scoped. -->

We will follow SlateRiver Media, a fictional streaming company that trains a churn-risk model. The model predicts which subscribers may cancel in the next 30 days so the retention team can test offers. The training pipeline runs as a Kubernetes Job in namespace `ml-training`. It reads feature snapshots from object storage, writes metrics to MLflow, pulls a private training image, and posts release summaries to an internal review service.

The pipeline needs several sensitive pieces:

| Need | Better source | Why |
| --- | --- | --- |
| Read and write object storage | Workload identity through a Kubernetes ServiceAccount | Avoids static cloud access keys in pods. |
| Connect to MLflow tracking | Token stored in AWS Secrets Manager or another external store | MLflow may still need an application token. |
| Pull private image | Kubernetes image pull secret or registry identity integration | Lets kubelet authenticate to the registry. |
| Notify review service | Webhook token from external secret store | Keeps release notification tokens out of Git. |
| Sign release metadata | Keyless CI signing or controlled signing service | Avoids putting signing keys into training containers. |

![SlateRiver identity and secret value flow for the churn trainer job](/content-assets/articles/article-mlops-governance-and-responsible-ai-secrets-credentials-in-ml-pipelines/identity-and-secret-values.png)
*SlateRiver keeps cloud access on the workload identity path and syncs only the token values the churn trainer needs.*

The exact provider can change. SlateRiver uses EKS, AWS Secrets Manager, External Secrets Operator, and GitHub Actions. The pattern also maps to Azure Key Vault with workload identity or Google Secret Manager with Workload Identity. The important point is the flow: CI receives short-lived cloud access, Kubernetes workloads use service accounts, external secrets sync controlled values, and jobs consume only the secrets they need.

## Separate Identity From Secret Values
<!-- section-summary: Workload identity gives the training job cloud permissions without shipping static access keys inside the container. -->

Start with cloud access. A training job should not carry a static cloud access key in an environment variable. In EKS, IAM Roles for Service Accounts lets a Kubernetes ServiceAccount assume an IAM role. The pod receives short-lived credentials from the platform, and the IAM role policy controls what the job can do.

Here is the Kubernetes ServiceAccount for the training job.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: churn-trainer
  namespace: ml-training
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::111122223333:role/slateriver-churn-training
```

The IAM role policy should match the job. SlateRiver's training job reads one feature prefix, writes one candidate artifact prefix, and reads a small set of secret manager values that External Secrets Operator syncs. It cannot update production aliases or read every analytics bucket.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadFeatureSnapshot",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::slateriver-ml-features",
        "arn:aws:s3:::slateriver-ml-features/churn/snapshots/2026-07-01/*"
      ]
    },
    {
      "Sid": "WriteCandidateArtifacts",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::slateriver-ml-artifacts/churn/candidates/run-20260705-31/*"
    },
    {
      "Sid": "ReadPipelineSecretValues",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:eu-west-2:111122223333:secret:mlflow/churn-trainer-*",
        "arn:aws:secretsmanager:eu-west-2:111122223333:secret:review-api/churn-release-*"
      ]
    }
  ]
}
```

This split makes debugging easier. If the job cannot read features, check the service account annotation and IAM policy. If the job cannot connect to MLflow, check the external secret sync and the MLflow token. If the job writes outside the run prefix, the policy should block it.

## Sync Secrets From an External Store
<!-- section-summary: External Secrets Operator copies selected values from a secret manager into Kubernetes Secrets for a namespace. -->

Kubernetes Secrets store sensitive values inside the cluster API. The Kubernetes docs clearly describe them as objects for sensitive information such as passwords, OAuth tokens, and SSH keys. A cluster still needs careful encryption, RBAC, namespace boundaries, and audit logging around Secrets because anyone who can read a Secret can often use the credential.

Many teams keep the source value in an external manager such as AWS Secrets Manager, Azure Key Vault, Google Secret Manager, or HashiCorp Vault. External Secrets Operator connects that external store to Kubernetes. It reads selected remote secrets and creates Kubernetes Secret objects in the namespace where a workload runs.

SlateRiver creates a `SecretStore` for the namespace. The authentication path uses the pod identity attached to the operator or a configured service account, depending on the cluster setup.

```yaml
apiVersion: external-secrets.io/v1
kind: SecretStore
metadata:
  name: slateriver-aws-secrets
  namespace: ml-training
spec:
  provider:
    aws:
      service: SecretsManager
      region: eu-west-2
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets
```

Then the team defines an `ExternalSecret` that syncs only the MLflow token and review API token needed by the churn trainer.

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: churn-training-secrets
  namespace: ml-training
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: slateriver-aws-secrets
    kind: SecretStore
  target:
    name: churn-training-secrets
    creationPolicy: Owner
  data:
    - secretKey: MLFLOW_TRACKING_TOKEN
      remoteRef:
        key: mlflow/churn-trainer
        property: token
    - secretKey: REVIEW_API_TOKEN
      remoteRef:
        key: review-api/churn-release
        property: token
```

Two details matter. `refreshInterval` tells the operator to refresh the Kubernetes Secret from the external store. `target.name` controls the Kubernetes Secret name that the training job will reference. The job never needs permission to call AWS Secrets Manager directly if the operator handles the sync. Some teams prefer direct workload reads from the external manager for very sensitive values. Both designs need clear ownership, RBAC, and audit logs.

## Inject Secrets Into Training Jobs
<!-- section-summary: Training jobs should reference scoped Kubernetes Secrets at runtime and avoid printing or writing secret values. -->

After the external secret syncs, the training Job can consume values from the Kubernetes Secret. The manifest should reference the ServiceAccount for cloud identity and the Secret for the few token values the application needs.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: churn-train-20260705-31
  namespace: ml-training
  labels:
    app.kubernetes.io/name: churn-trainer
    ml.slateriver.io/model-id: churn-risk
spec:
  backoffLimit: 1
  template:
    spec:
      serviceAccountName: churn-trainer
      restartPolicy: Never
      containers:
        - name: trainer
          image: ghcr.io/slateriver/churn-trainer@sha256:54b1a4d93c
          imagePullPolicy: IfNotPresent
          env:
            - name: MLFLOW_TRACKING_URI
              value: https://mlflow.slateriver.example
            - name: MLFLOW_TRACKING_TOKEN
              valueFrom:
                secretKeyRef:
                  name: churn-training-secrets
                  key: MLFLOW_TRACKING_TOKEN
            - name: REVIEW_API_TOKEN
              valueFrom:
                secretKeyRef:
                  name: churn-training-secrets
                  key: REVIEW_API_TOKEN
            - name: FEATURE_SNAPSHOT_URI
              value: s3://slateriver-ml-features/churn/snapshots/2026-07-01/
            - name: ARTIFACT_OUTPUT_URI
              value: s3://slateriver-ml-artifacts/churn/candidates/run-20260705-31/
          resources:
            requests:
              cpu: "4"
              memory: 16Gi
            limits:
              cpu: "8"
              memory: 32Gi
```

The secrets enter only through `secretKeyRef`. The source code should avoid printing environment variables, command-line arguments, or full connection strings. Logs should show that a connection was configured, not the credential value. Exception handlers should redact tokens from errors before writing logs.

For local development or a throwaway test cluster, you may see a plain Kubernetes Secret like this:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: churn-training-secrets
  namespace: ml-training
type: Opaque
stringData:
  MLFLOW_TRACKING_TOKEN: replace-with-local-test-token
  REVIEW_API_TOKEN: replace-with-local-test-token
```

Treat that as a local bootstrap shape, not the production source of truth. Production values should come from the approved external secret store, and RBAC should limit who can read the resulting Kubernetes Secret.

## Scan CI and Pull Requests
<!-- section-summary: CI scanning catches committed tokens, unsafe environment files, and leaked credentials before a pipeline reaches production. -->

Secret handling also starts before Kubernetes. A leaked token in Git history can outlive a clean deployment manifest. SlateRiver scans pull requests and release branches for committed secrets, unsafe `.env` files, and accidental credential output.

![SlateRiver pull request and rendered manifest secret checks before release](/content-assets/articles/article-mlops-governance-and-responsible-ai-secrets-credentials-in-ml-pipelines/secret-checks-before-release.png)
*Secret scanning checks both source changes and rendered deployment manifests before the pipeline can release.*

GitHub's secret scanning can detect many known token formats when enabled for a repository or organization. Teams often add an open-source scanner such as Gitleaks as a pull request check because it can scan custom patterns and local history too.

```yaml
name: secret-scan

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  gitleaks:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The workflow checks repository content. It should run alongside checks that inspect generated Kubernetes manifests and Helm values. A common failure is a chart value that seems harmless in a pull request and then renders into a secret in the deployment output. CI can render manifests and scan the rendered files before applying them.

```bash
helm template churn-trainer ./deploy/churn-trainer \
  --namespace ml-training \
  --values deploy/churn-trainer/values-prod.yaml \
  > rendered.yaml

gitleaks detect --no-git --source rendered.yaml
```

CI should also avoid leaking secrets in its own logs. Keep shell tracing off around secret commands. Avoid `echo $TOKEN`. Mask expected sensitive values in the CI system when available. Prefer OIDC federation for cloud access so the workflow receives short-lived credentials instead of storing cloud keys as repository secrets.

## Rotation and Incident Response
<!-- section-summary: Secret rotation needs an owner, refresh path, verification command, rollback plan, and incident response flow. -->

Rotation means replacing a secret value on a planned schedule or after a possible leak. A pipeline secret needs a known owner, source store, refresh path, dependent workloads, and validation check. Without that, teams are afraid to rotate because nobody knows what will break.

SlateRiver records the rotation plan beside the pipeline:

```yaml
secret_rotation:
  mlflow/churn-trainer:
    owner: ml-platform
    stored_in: aws-secrets-manager
    synced_to:
      namespace: ml-training
      kubernetes_secret: churn-training-secrets
      key: MLFLOW_TRACKING_TOKEN
    rotation_days: 60
    validation:
      - kubectl -n ml-training wait externalsecret/churn-training-secrets --for=condition=Ready --timeout=90s
      - kubectl -n ml-training create job churn-secret-smoke --from=cronjob/churn-secret-smoke
    rollback:
      - restore previous version in AWS Secrets Manager
      - wait for ExternalSecret refresh
      - rerun smoke job
```

External secret refresh is only one part. The application may cache tokens. A running training job may need to finish with the old token while the next job starts with the new one. A serving endpoint may need a restart if it reads a secret only at startup. The rotation plan should state which workloads need restarts and which read secrets dynamically.

Incident response follows a sharper path. If a token appears in Git, first revoke or rotate the token. Then remove the secret from the current branch and open a history cleanup path if needed. Next, check audit logs for use after the suspected leak time. Finally, add or tune scanner rules so the same format is caught earlier.

The response should produce a short incident record:

```yaml
secret_incident:
  incident_id: sec-2026-07-mlflow-token
  detected_by: gitleaks pull request check
  exposed_secret: mlflow/churn-trainer token
  first_seen: 2026-07-05T09:14:00Z
  revoked_at: 2026-07-05T09:30:00Z
  rotated_to_version: awssm-version-77c2
  affected_workloads:
    - churn-train-20260705-31
  audit_window_checked: 2026-07-05T09:00:00Z to 2026-07-05T11:00:00Z
  follow_up:
    - add custom gitleaks rule for internal MLflow tokens
    - move local smoke tests to generated short-lived tokens
```

That record keeps the team from treating leaks as one-off chaos. It shows detection, containment, rotation, audit review, and prevention.

![SlateRiver rotation and incident response loop for churn training secrets](/content-assets/articles/article-mlops-governance-and-responsible-ai-secrets-credentials-in-ml-pipelines/rotation-and-response.png)
*A clear response loop gives the team a known path from leak detection to token revocation, sync, smoke testing, and audit review.*

## Release Evidence and Audit Logs
<!-- section-summary: A release should prove which secret store, service account, RBAC rules, scanner checks, and rotation plan protected the pipeline. -->

Before SlateRiver promotes a training pipeline to production, the release gate checks secret handling. It verifies the ServiceAccount, ExternalSecret readiness, Kubernetes RBAC, secret scan result, and rotation metadata.

```bash
kubectl -n ml-training get serviceaccount churn-trainer -o yaml

kubectl -n ml-training wait \
  externalsecret/churn-training-secrets \
  --for=condition=Ready \
  --timeout=90s

kubectl auth can-i get secrets/churn-training-secrets \
  --as=system:serviceaccount:ml-training:churn-trainer \
  -n ml-training

kubectl auth can-i list secrets \
  --as=system:serviceaccount:ml-training:churn-trainer \
  -n ml-training
```

The first command shows the workload identity annotation. The second checks that External Secrets Operator synced successfully. The `kubectl auth can-i` checks reveal whether the training ServiceAccount can read the specific Secret or list Secrets broadly. Many applications do not need the Kubernetes API permission to read Secrets at all because kubelet injects values into the pod. If the application only uses `secretKeyRef`, broad `get` or `list` permissions for Secrets should raise a review question.

The release evidence file captures the result.

```yaml
pipeline_secret_evidence:
  pipeline: churn-risk-training
  release: train-pipeline-2026-07-05
  namespace: ml-training
  workload_service_account: churn-trainer
  cloud_role: arn:aws:iam::111122223333:role/slateriver-churn-training
  external_secret:
    name: churn-training-secrets
    store: slateriver-aws-secrets
    condition: Ready
    refresh_interval: 1h
  ci_checks:
    gitleaks: passed
    rendered_manifest_scan: passed
  rotation:
    mlflow_token_rotation_days: 60
    last_rotated: 2026-06-20
  audit_logs:
    aws_cloudtrail_checked: true
    kubernetes_audit_checked: true
```

Audit logs should cover both the external store and Kubernetes. AWS CloudTrail can show Secrets Manager reads and updates when the relevant events are logged. Kubernetes audit logs can show Secret reads, RBAC changes, ServiceAccount changes, and workload creation. External Secrets Operator also exposes status conditions that help diagnose sync failures.

## Practical Checks, Mistakes, and Interview Understanding
<!-- section-summary: Safe pipeline secret handling combines workload identity, external stores, scoped injection, scanning, rotation, and audit evidence. -->

Use these checks when reviewing an ML pipeline:

| Check | What good looks like |
| --- | --- |
| Cloud identity | The workload uses a scoped ServiceAccount or managed identity instead of static cloud keys. |
| External source | Secret values live in an approved manager such as AWS Secrets Manager, Azure Key Vault, Google Secret Manager, or Vault. |
| Kubernetes sync | ExternalSecret objects sync only the keys the namespace needs. |
| Injection | Jobs use `secretKeyRef`, mounted secret volumes, or direct secret manager reads with clear RBAC. |
| Logging | Application and CI logs redact tokens, connection strings, and signed URLs. |
| CI scanning | Pull requests and rendered manifests run secret scanning. |
| Rotation | Every secret has owner, interval, validation, and rollback steps. |
| Audit | Secret reads, updates, RBAC changes, and job launches can be investigated. |

Common mistakes are easy to recognize. A team puts cloud access keys into GitHub repository secrets even though OIDC would work. A Helm values file contains a real token. A Kubernetes ServiceAccount can list every Secret in the namespace. External Secrets syncs a whole JSON blob when the job needs one field. A training script prints all environment variables during startup. Rotation exists in theory, yet no one has run the smoke test after rotation.

Interview-ready understanding sounds like this: pipeline secret security starts by removing long-lived credentials where possible. Use workload identity for cloud access, keep remaining values in an external secret manager, sync narrow values into Kubernetes, inject them at runtime, scan code and rendered manifests, rotate on a schedule, and keep audit logs for secret reads and changes.

## References

- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Official Kubernetes documentation for Secret objects and usage patterns.
- [Kubernetes ServiceAccounts](https://kubernetes.io/docs/concepts/security/service-accounts/) - Official Kubernetes documentation for workload identities inside a cluster.
- [External Secrets Operator documentation](https://external-secrets.io/latest/) - Official External Secrets Operator documentation.
- [External Secrets Operator AWS Secrets Manager provider](https://external-secrets.io/latest/provider/aws-secrets-manager/) - Official provider guide for syncing AWS Secrets Manager values.
- [AWS EKS IAM roles for service accounts](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html) - Official AWS guidance for associating IAM roles with Kubernetes ServiceAccounts.
- [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - Official GitHub guidance for short-lived cloud authentication from workflows.
- [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) - Official GitHub documentation for repository secret scanning.
- [Gitleaks Action](https://github.com/gitleaks/gitleaks-action) - Official Gitleaks GitHub Action repository.
