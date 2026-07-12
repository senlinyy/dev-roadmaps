---
title: "AWS SageMaker"
description: "Use AWS SageMaker as a managed path for training jobs, model registry approval, endpoint deployment, monitoring, and secure MLOps automation."
overview: "SageMaker helps an ML team run training code on managed AWS infrastructure, register approved model versions, deploy endpoints, and monitor production behavior while keeping data, artifacts, and access inside AWS guardrails."
tags: ["MLOps", "advanced", "cloud"]
order: 1
id: "article-mlops-mlops-infrastructure-aws-sagemaker-overview"
---

## Table of Contents

1. [What SageMaker Gives an MLOps Team](#what-sagemaker-gives-an-mlops-team)
2. [The Workflow Map](#the-workflow-map)
3. [Prepare Data and Access](#prepare-data-and-access)
4. [Run a Managed Training Job](#run-a-managed-training-job)
5. [Register the Model for Review](#register-the-model-for-review)
6. [Deploy an Endpoint with a Controlled Release](#deploy-an-endpoint-with-a-controlled-release)
7. [Monitor the Model After Launch](#monitor-the-model-after-launch)
8. [Access, Secrets, and Audit Checks](#access-secrets-and-audit-checks)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

AWS SageMaker, now called **Amazon SageMaker AI** across many AWS docs, is the managed AWS service that helps you build, train, register, deploy, and monitor machine learning models. The plain version is this: your team brings data, code, containers, and model review rules, and SageMaker runs the heavy AWS infrastructure pieces around them.

We will follow **Harbor Pantry**, an online grocery team that predicts next-day demand for fresh items. The model reads sales history and store events from Amazon S3, trains an XGBoost model, stores the model artifact, registers the model for approval, deploys it behind a SageMaker endpoint, and monitors live prediction data. That is a very normal production path because grocery demand changes quickly, bad forecasts waste inventory, and the platform team needs a release process that gives finance, operations, and data science the same evidence.

The spine for this article is simple: you have ML work that outgrew laptops, SageMaker gives each part of the workflow a managed AWS resource, and a production team still has to make clear choices about data paths, IAM roles, model approval, endpoint rollout, monitoring, and rollback.

## What SageMaker Gives an MLOps Team
<!-- section-summary: SageMaker gives ML teams managed AWS resources for the lifecycle around model code: training, registry, serving, monitoring, and audit. -->

SageMaker is easiest to understand if you start with the jobs your team already does. Someone prepares data, someone trains a model, someone reviews the metrics, someone deploys the model, and someone gets paged when the model drifts. SageMaker gives AWS-native resources for those steps so the team can avoid hand-building every server, artifact bucket, model registry, endpoint, and monitoring job.

A **training job** runs your training code on managed compute. You choose the container image, input data channels, output S3 location, instance type, and execution role. SageMaker starts the compute, runs the container, streams logs, writes model artifacts to S3, and shuts the compute down. For Harbor Pantry, that means the data science team can run a larger XGBoost training job without asking the platform team to keep a permanent training server alive.

A **model package group** in **SageMaker Model Registry** holds versions of a model that solve the same business problem. Each model version can carry model artifacts, inference image details, metrics, approval status, model card information, and lineage. That matters because the serving team needs to know exactly which training run produced the model in production, and the operations team needs a place to say whether a candidate is approved.

An **endpoint** serves real-time predictions. A SageMaker endpoint is backed by an endpoint configuration, one or more production variants, and the model containers assigned to those variants. Production variants let a team send all traffic to one model or split traffic across candidates during a controlled test.

Here is the first map of the moving pieces:

| Team question | SageMaker resource | Harbor Pantry example |
| --- | --- | --- |
| Where does training data live? | S3 input channels | `s3://harbor-ml-prod/demand/features/2026-07-05/` |
| Which permissions can the job use? | IAM execution role | `HarborSageMakerTrainingRole` reads only the training prefix and writes only model artifacts |
| How does training run? | Training job | `demand-xgb-20260705-a1b2c3d` runs a pinned container image |
| Where does review happen? | Model Registry package group | `harbor-demand-forecast` stores versions and approval status |
| How do callers get predictions? | Endpoint and production variant | `demand-forecast-prod` sends traffic to `candidate-20260705` |
| How does the team watch behavior? | Model Monitor and CloudWatch | Baselines compare live request data against training data expectations |

This map is important because SageMaker is a platform surface, not a single button. The team still owns the ML code, the business metric, the access policy, and the release decision. SageMaker gives managed AWS resources for the workflow around those choices.

## The Workflow Map
<!-- section-summary: A useful SageMaker workflow moves from S3 data to managed training, registry review, endpoint rollout, and monitoring evidence. -->

Harbor Pantry has a daily prediction problem. Store managers need a forecast by 5 a.m., and the model owner wants to retrain when new promotions, holidays, or weather patterns change demand. The first version can run as a batch job, yet the article focuses on SageMaker endpoints because the same model will later answer real-time inventory questions from a store dashboard.

The production workflow looks like this:

1. Feature data lands in S3 with a date-stamped prefix.
2. A CI workflow validates the feature schema and submits a SageMaker training job.
3. The training job writes `model.tar.gz` and evaluation metrics to S3.
4. The pipeline registers a model package in the `harbor-demand-forecast` package group with `PendingManualApproval`.
5. The reviewer checks metrics, bias notes, cost, data lineage, and model card fields.
6. A release workflow creates or updates a SageMaker endpoint configuration.
7. Traffic moves to the approved model in a small step, then increases after monitoring checks pass.
8. Model Monitor and CloudWatch collect evidence after launch.

This structure gives each person a clear handoff. The data engineer owns the S3 input contract. The ML engineer owns the training container and metrics. The platform engineer owns the endpoint and IAM role. The product owner owns the approval rule, such as "mean absolute percentage error must stay below 8 percent for high-volume items."

![Harbor Pantry SageMaker Flow](/content-assets/articles/article-mlops-mlops-infrastructure-aws-sagemaker-overview/harbor-pantry-sagemaker-flow.png)

*Harbor Pantry's SageMaker path keeps the data snapshot, training run, registry review, endpoint, and monitoring evidence connected as one release chain.*

## Prepare Data and Access
<!-- section-summary: SageMaker training starts with clear S3 paths and a small IAM role, because every later step depends on those boundaries. -->

Before training, the team needs a data location that SageMaker can read and an output location that SageMaker can write. In AWS, S3 is the usual object store for ML datasets, model artifacts, evaluation reports, and batch prediction files. A clean S3 layout keeps training runs reproducible because each run can point to a frozen input prefix.

For Harbor Pantry, the data engineer publishes a manifest like this:

```json
{
  "dataset_id": "demand-features-2026-07-05",
  "train_uri": "s3://harbor-ml-prod/demand/features/2026-07-05/train/",
  "validation_uri": "s3://harbor-ml-prod/demand/features/2026-07-05/validation/",
  "schema_uri": "s3://harbor-ml-prod/demand/contracts/features-v4.json",
  "label_delay_days": 1,
  "owner": "ml-platform@harbor.example"
}
```

That manifest is small, yet it carries the evidence a reviewer needs later. The `dataset_id` ties the run to one prepared dataset. The training and validation prefixes show exactly which data moved into the model. The schema path tells CI which contract to validate before a training job consumes the files.

The IAM role should match those paths. An **execution role** is the AWS identity that SageMaker assumes while it runs your job. The role should read the approved input bucket prefix, read the container image from Amazon ECR if you use a private image, write model artifacts to the output prefix, write logs to CloudWatch, and use a KMS key when your team encrypts artifacts with a customer-managed key.

Here is the shape of the S3 permissions. Real teams usually keep this in Terraform, CloudFormation, or CDK, and they review the exact prefixes during platform changes.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::harbor-ml-prod/demand/features/*",
        "arn:aws:s3:::harbor-ml-prod/demand/contracts/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::harbor-ml-prod/demand/artifacts/*"
    }
  ]
}
```

The important detail is the direction of access. The training job reads feature inputs and writes artifacts. It receives no broad access to unrelated buckets, billing data, production databases, or deployment roles. That small boundary gives the security team a much easier review packet.

## Run a Managed Training Job
<!-- section-summary: A SageMaker training job packages code, data, compute, output, tags, and logs into one auditable AWS resource. -->

Now the team can run training. A **training job** is a request to SageMaker that says, "Run this container with these inputs on this compute and place the output here." The container can use a built-in SageMaker algorithm, a framework container, or a custom image from ECR. Harbor Pantry uses a custom image because the team pins Python packages, feature code, and a small command-line interface inside the image.

The CI workflow writes a `training-job.json` file from the commit SHA and dataset manifest:

```json
{
  "TrainingJobName": "demand-xgb-20260705-a1b2c3d",
  "RoleArn": "arn:aws:iam::123456789012:role/HarborSageMakerTrainingRole",
  "AlgorithmSpecification": {
    "TrainingImage": "123456789012.dkr.ecr.us-east-1.amazonaws.com/demand-trainer@sha256:1111222233334444",
    "TrainingInputMode": "File"
  },
  "InputDataConfig": [
    {
      "ChannelName": "train",
      "DataSource": {
        "S3DataSource": {
          "S3DataType": "S3Prefix",
          "S3Uri": "s3://harbor-ml-prod/demand/features/2026-07-05/train/",
          "S3DataDistributionType": "FullyReplicated"
        }
      }
    },
    {
      "ChannelName": "validation",
      "DataSource": {
        "S3DataSource": {
          "S3DataType": "S3Prefix",
          "S3Uri": "s3://harbor-ml-prod/demand/features/2026-07-05/validation/",
          "S3DataDistributionType": "FullyReplicated"
        }
      }
    }
  ],
  "OutputDataConfig": {
    "S3OutputPath": "s3://harbor-ml-prod/demand/artifacts/"
  },
  "ResourceConfig": {
    "InstanceType": "ml.m5.2xlarge",
    "InstanceCount": 1,
    "VolumeSizeInGB": 100
  },
  "StoppingCondition": {
    "MaxRuntimeInSeconds": 7200
  },
  "Tags": [
    {"Key": "git_sha", "Value": "a1b2c3d"},
    {"Key": "dataset_id", "Value": "demand-features-2026-07-05"},
    {"Key": "owner", "Value": "ml-platform"}
  ]
}
```

The command that submits the job is small because the job file carries the important parts:

```bash
aws sagemaker create-training-job \
  --cli-input-json file://training-job.json

aws sagemaker describe-training-job \
  --training-job-name demand-xgb-20260705-a1b2c3d \
  --query '{status:TrainingJobStatus,artifact:ModelArtifacts.S3ModelArtifacts,reason:FailureReason}'
```

The first command creates the job. The second command gives CI a compact status check. When the job finishes, `ModelArtifacts.S3ModelArtifacts` points to the trained `model.tar.gz`. If the job fails, `FailureReason` gives the first place to look before opening CloudWatch logs.

Real teams add one more check before registration. They read the evaluation file from S3 and fail the workflow if the candidate misses the release bar.

```bash
aws s3 cp \
  s3://harbor-ml-prod/demand/artifacts/demand-xgb-20260705-a1b2c3d/output/evaluation.json \
  evaluation.json

jq -e '.mape_high_volume <= 0.08 and .p95_latency_ms <= 80' evaluation.json
```

This check keeps the model registry clean. A failed candidate can stay as an experiment run, while only release-ready candidates move into the formal package group.

## Register the Model for Review
<!-- section-summary: Model Registry turns a training output into a reviewed, versioned model candidate with metadata and approval status. -->

The next step is registration. **Model Registry** gives the team a shared place for production candidates. In SageMaker, the registry uses package groups and package versions. The package group represents one model family, and every new candidate creates a version inside that group.

Harbor Pantry creates the package group once:

```bash
aws sagemaker create-model-package-group \
  --model-package-group-name harbor-demand-forecast \
  --model-package-group-description "Demand forecast models for fresh grocery inventory"
```

Each training run can then register a version. The model package points to the model artifact in S3 and the inference image that will load that artifact during serving.

```json
{
  "ModelPackageGroupName": "harbor-demand-forecast",
  "ModelPackageDescription": "XGBoost demand forecast trained from demand-features-2026-07-05",
  "InferenceSpecification": {
    "Containers": [
      {
        "Image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/demand-inference@sha256:5555666677778888",
        "ModelDataUrl": "s3://harbor-ml-prod/demand/artifacts/demand-xgb-20260705-a1b2c3d/output/model.tar.gz"
      }
    ],
    "SupportedContentTypes": ["application/json"],
    "SupportedResponseMIMETypes": ["application/json"]
  },
  "ModelApprovalStatus": "PendingManualApproval",
  "CustomerMetadataProperties": {
    "git_sha": "a1b2c3d",
    "dataset_id": "demand-features-2026-07-05",
    "mape_high_volume": "0.071",
    "owner": "fresh-demand-team"
  }
}
```

```bash
aws sagemaker create-model-package \
  --cli-input-json file://model-package.json
```

The approval status is a useful gate. `PendingManualApproval` tells downstream deployment automation that a human or policy workflow still needs to review the candidate. The review packet should include metrics, data range, training image digest, inference image digest, model card details, known limits, and rollback instructions.

When the reviewer approves the package, CI can update the status:

```bash
aws sagemaker update-model-package \
  --model-package-arn "$MODEL_PACKAGE_ARN" \
  --model-approval-status Approved
```

This gives the deployment workflow a simple rule: deploy only approved package versions from the expected package group. The model artifact may live in S3, and the image may live in ECR, yet the registry version gives the release pipeline a single reviewed object to promote.

## Deploy an Endpoint with a Controlled Release
<!-- section-summary: SageMaker endpoints serve approved models, and production variants let teams shift traffic in measured steps. -->

After approval, the serving team needs an endpoint. A **SageMaker model** resource connects the approved package or image/artifact pair to an execution role. An **endpoint configuration** describes which model version runs, what instance type hosts it, how many instances start, and which production variants receive traffic.

For a first deployment, the team creates a model resource:

```bash
aws sagemaker create-model \
  --model-name demand-xgb-a1b2c3d \
  --execution-role-arn arn:aws:iam::123456789012:role/HarborSageMakerEndpointRole \
  --primary-container Image=123456789012.dkr.ecr.us-east-1.amazonaws.com/demand-inference@sha256:5555666677778888,ModelDataUrl=s3://harbor-ml-prod/demand/artifacts/demand-xgb-20260705-a1b2c3d/output/model.tar.gz
```

Then it creates an endpoint configuration. The `InitialVariantWeight` controls the traffic share for the variant in a multi-variant endpoint. One model can receive all traffic at the start, or two models can share traffic during an A/B test.

```json
[
  {
    "VariantName": "candidate-a1b2c3d",
    "ModelName": "demand-xgb-a1b2c3d",
    "InitialInstanceCount": 2,
    "InstanceType": "ml.m5.large",
    "InitialVariantWeight": 1.0
  }
]
```

```bash
aws sagemaker create-endpoint-config \
  --endpoint-config-name demand-forecast-a1b2c3d \
  --production-variants file://production-variants.json
```

For a brand-new service, create the endpoint:

```bash
aws sagemaker create-endpoint \
  --endpoint-name demand-forecast-prod \
  --endpoint-config-name demand-forecast-a1b2c3d
```

For an existing service, update the endpoint to the new configuration after the model receives approval:

```bash
aws sagemaker update-endpoint \
  --endpoint-name demand-forecast-prod \
  --endpoint-config-name demand-forecast-a1b2c3d
```

The rollout rule should sit outside the training code. Harbor Pantry uses a release checklist with three gates: the registry package is approved, the endpoint can load the model and answer a small test request, and live metrics stay inside the rollback threshold after traffic moves.

Rollback has to be concrete. Keep the last known good endpoint configuration name in the release record. If the new model causes high error rate, high latency, or a business metric alert, run:

```bash
aws sagemaker update-endpoint \
  --endpoint-name demand-forecast-prod \
  --endpoint-config-name demand-forecast-previous-good
```

That command moves the endpoint back to the previous configuration. The team still needs an incident note, yet the mechanical rollback path is clear and quick.

![SageMaker Release Gates](/content-assets/articles/article-mlops-mlops-infrastructure-aws-sagemaker-overview/sagemaker-release-gates.png)

*The release gate is outside the training script: the package is approved, the endpoint answers a smoke request, traffic moves in a small step, and rollback points to the previous good config.*

## Monitor the Model After Launch
<!-- section-summary: SageMaker monitoring connects live endpoint data, baseline statistics, CloudWatch alarms, and incident response. -->

Production ML needs monitoring because the world can change after the model ships. Fresh grocery demand can shift after a heat wave, a competitor sale, a supplier shortage, or a new store opening. The model can still answer requests successfully while the predictions lose business value.

SageMaker Model Monitor can capture endpoint input and output data, compare live data with baselines, run scheduled monitoring jobs, and publish violations. A practical first monitor for Harbor Pantry checks whether important request fields drift away from the training baseline.

The model owner stores a baseline report next to the model package:

```json
{
  "baseline_dataset_id": "demand-features-2026-07-05",
  "monitored_fields": ["item_id", "store_id", "forecast_date", "promotion_flag", "temperature_c"],
  "alert_thresholds": {
    "missing_store_id_rate": 0.001,
    "promotion_flag_drift": 0.15,
    "prediction_p95_latency_ms": 120
  }
}
```

CloudWatch catches service symptoms such as invocation errors, latency, and endpoint health. Model Monitor catches ML symptoms such as data quality or model quality drift when labels arrive. The incident runbook should bring those two views together:

| Alert | First owner | Evidence to pull | Likely action |
| --- | --- | --- | --- |
| 5xx errors rise | Platform engineer | CloudWatch logs, endpoint events, recent deployment record | Roll back endpoint config |
| P95 latency rises | Platform engineer | Instance utilization, request size, model image digest | Scale endpoint or roll back image |
| Promotion feature drifts | ML engineer | Captured requests, current campaign calendar, baseline report | Retrain or patch feature pipeline |
| Label-based MAPE crosses threshold | Model owner | Forecasts, delayed labels, item segment report | Freeze rollout and open model review |

AWS EventBridge can react to SageMaker job and endpoint state changes. Many teams use it to notify Slack, trigger a Step Functions workflow, or create a ticket when a training job fails or an endpoint update changes state. That event trail helps the team connect automated actions with human review.

![Harbor Pantry Runbook](/content-assets/articles/article-mlops-mlops-infrastructure-aws-sagemaker-overview/harbor-pantry-runbook.png)

*A useful runbook joins endpoint logs, Model Monitor findings, CloudWatch alarms, and owner action so service symptoms and ML drift lead to the right response.*

## Access, Secrets, and Audit Checks
<!-- section-summary: SageMaker production work depends on small roles, short-lived CI credentials, encrypted artifacts, network boundaries, and reviewable metadata. -->

SageMaker sits inside AWS, so access design matters as much as model code. Start with separate roles for training, registration, and endpoint deployment. The training role reads feature data and writes artifacts. The registry role creates model packages and updates approval status. The deployment role creates models, endpoint configurations, and endpoint updates. Keeping those roles separate makes it harder for a compromised training job to deploy directly to production.

CI should use short-lived cloud credentials. If GitHub Actions submits jobs, configure GitHub OIDC with an AWS role trust policy scoped to the repository, branch, and environment. The workflow then requests temporary credentials during the job instead of storing long-lived AWS keys as repository secrets.

A minimal GitHub Actions job for submitting a training job looks like this:

```yaml
name: sagemaker-training

on:
  workflow_dispatch:
    inputs:
      dataset_id:
        required: true
        type: string

permissions:
  id-token: write
  contents: read

jobs:
  submit-training:
    runs-on: ubuntu-latest
    environment: ml-training
    steps:
      - uses: actions/checkout@v6
      - uses: aws-actions/configure-aws-credentials@v5
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubSageMakerTrainingSubmitter
          aws-region: us-east-1
      - run: python scripts/render_training_job.py --dataset-id "${{ inputs.dataset_id }}"
      - run: aws sagemaker create-training-job --cli-input-json file://training-job.json
```

The key details are the `id-token: write` permission and the deployment environment. The environment can require approval before the job receives cloud access. The AWS role trust policy should match the repository and environment claim, and the role permissions should allow only the SageMaker and S3 actions needed for this workflow.

For audit, tag every SageMaker resource with `git_sha`, `dataset_id`, `owner`, `cost_center`, and `model_family`. Encrypt S3 artifacts with KMS. Use private VPC access for jobs that need private data services. Keep secrets in AWS Secrets Manager or Systems Manager Parameter Store, and pass references through the runtime configuration instead of placing secret values in the model package, container image, or repository.

## Putting It Together
<!-- section-summary: SageMaker works best when each managed resource has a clear owner, input, output, approval rule, and rollback path. -->

SageMaker gives Harbor Pantry a managed AWS path from data to prediction. S3 holds versioned training inputs and artifacts. Training jobs run pinned containers on managed compute. Model Registry records model versions, metrics, approval status, and lineage. Endpoints serve approved models, while production variants and endpoint configs give the release team a controlled rollout and rollback path. Model Monitor, CloudWatch, and EventBridge help the team watch both service behavior and ML behavior after launch.

The main habit is to keep the workflow evidence close to the model. A future incident responder should be able to answer five questions quickly: which code trained this model, which data trained it, which image serves it, who approved it, and which command rolls it back. SageMaker can hold much of that evidence, and your CI/CD process has to write the rest consistently.

## References

- [Amazon SageMaker AI training jobs](https://docs.aws.amazon.com/sagemaker/latest/dg/train-model.html)
- [Amazon SageMaker Model Registry](https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry.html)
- [Amazon SageMaker real-time endpoints](https://docs.aws.amazon.com/sagemaker/latest/dg/realtime-endpoints-deploy-models.html)
- [Testing SageMaker models with production variants](https://docs.aws.amazon.com/sagemaker/latest/dg/model-ab-testing.html)
- [Amazon SageMaker Model Monitor](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor.html)
- [Amazon SageMaker Model Cards](https://docs.aws.amazon.com/sagemaker/latest/dg/model-cards.html)
- [SageMaker events in Amazon EventBridge](https://docs.aws.amazon.com/sagemaker/latest/dg/automating-sagemaker-with-eventbridge.html)
- [GitHub Actions OIDC for AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
