---
title: "Model Service CD"
description: "Design continuous delivery around release identity, build provenance, gates, environment promotion, rollout, verification, and rollback."
overview: "Continuous delivery for a model service promotes a complete release rather than rebuilding a model in each environment. This article develops the delivery framework for service images, model artifacts, configuration, evidence, traffic, and recovery."
tags: ["MLOps", "production", "ci-cd"]
order: 5
id: "article-mlops-mlops-infrastructure-cd-for-model-services"
aliases:
  - roadmaps/mlops/modules/deployment-and-release-management/model-release-basics/04-cd-for-model-services.md
  - roadmaps/mlops/modules/ml-testing-and-delivery/ci-cd-for-ml/03-cd-for-model-services.md
  - roadmaps/mlops/modules/mlops-infrastructure/ci-cd-for-ml/03-cd-for-model-services.md
  - child-ci-cd-for-ml-03-cd-for-model-services
---

## Continuous Delivery Promotes A Complete Release
<!-- section-summary: A model-service release identifies the code, image, model, preprocessing, configuration, policy, and evidence deployed together. -->

**Continuous delivery (CD)** keeps a tested release ready to deploy and moves it through environments under controlled policy. A normal service often promotes one container image. A model service may combine a serving image, external model artifact, feature and preprocessing versions, thresholds, deployment configuration, and evaluation evidence.

The delivery framework has seven responsibilities:

1. Define the complete release identity.
2. Build each artifact once with provenance.
3. Gate predictive, contract, security, and operational quality.
4. Promote the same identities across isolated environments.
5. Release traffic progressively under stop conditions.
6. Verify the versions and behaviour users actually reach.
7. Restore a complete previous release through tested rollback.

CD should not retrain or rebuild the candidate differently in staging and production. It promotes already identified artifacts and accumulates evidence around them.

## Release Identity Joins Independently Changing Parts
<!-- section-summary: A release record binds service and model lifecycles without forcing them to share one version number. -->

API code can change while the model stays fixed. A model can change while serving code stays fixed. Thresholds and feature configuration can change without either artifact changing. The release record names every concrete identity.

```yaml
release:
  id: hazard-service-2026-07-12.3
  image: ghcr.io/example/hazard-api@sha256:bd71...
  model:
    name: road-hazard-classifier
    version: "42"
    digest: sha256:8b6d...
  preprocessing: road-images-v9
  feature_contract: hazard-request-v4
  policy: hazard-routing-v7
  deployment_config: git:4a89c12
  rollback_release: hazard-service-2026-06-28.2
```

This identity lets evaluation, deployment, telemetry, and incidents discuss the same system. A mutable `champion` alias may help locate a version, while the release records the resolved version and digest.

## Build Once Preserves Provenance
<!-- section-summary: CI produces immutable images and model candidates that later environments verify and reuse. -->

The serving image is built from a reviewed commit, dependency lock, and approved base. CI runs unit, contract, integration, vulnerability, and image smoke tests. The registry digest identifies the resulting bytes.

The model artifact comes from a tracked training run and registry version with data, code, configuration, signature, evaluation, and integrity evidence. The release process never copies an engineer's local model file.

Software bills of materials, signatures, build attestations, and model lineage support supply-chain review according to organizational policy. Promotion verifies digests instead of trusting tags.

If the model is baked into the image, one digest can identify the combined package. If the model loads externally, the deployment pins both identities and the loader verifies the artifact before readiness.

## Gates Protect Different Failure Boundaries
<!-- section-summary: Delivery gates cover software, data and model quality, serving compatibility, security, performance, and recovery. -->

Software gates check tests, API compatibility, dependency and image policy, and infrastructure configuration. Model gates compare the candidate with production on the reviewed protocol, segments, robustness, calibration, and product harms. Serving gates check signature, preprocessing compatibility, startup, fixtures, latency, throughput, memory, and fallback.

Governance gates verify required documentation, approval scope, data and model lineage, privacy and security review, and accountable owners. Recovery gates confirm that the previous release remains deployable and that rollback verification exists.

Automated rules should fail deterministically. Human review addresses residual risk and scope. The approval record binds to the release digest; changing the model, image, policy, or rollout scope invalidates it where relevant.

A passing average metric cannot override a blocking segment, and a passing security scan cannot prove model quality. Gates remain separate so each owner can explain the evidence.

## Environments Are Trust Boundaries
<!-- section-summary: Development, staging, canary, and production use different identities and data while preserving the release artifact. -->

Development can build experiments and candidate images. Staging can read approved candidate artifacts and deploy into isolated infrastructure. Production release automation can deploy only approved release identities. The serving runtime can read its approved model and cannot replace it.

Configuration varies by environment—endpoint names, credentials, replicas, network, storage paths—while the image and model remain the same. Secrets enter through the platform at runtime. Environment-specific overrides are versioned and reviewed.

Staging uses production-like request contracts, feature services, resource limits, and observability. It runs smoke, replay, load, and failure tests. A staging pass is evidence for production rollout rather than a different build.

## Progressive Delivery Limits Exposure
<!-- section-summary: Shadow, canary, and wider rollout stages answer increasingly consequential questions under explicit stop signals. -->

Shadow traffic tests current inputs, compatibility, latency, errors, and prediction divergence without using the candidate decision. A canary lets a small identifiable traffic share receive the release and measures real product outcomes. Blue-green can provide a fast switch between complete environments when capacity permits.

The rollout specification names traffic percentage or segment, observation window, owner, metrics, thresholds, and automatic or manual stop behaviour. Service health and model/product health both matter. Latency, errors, fallback, prediction distribution, quality, queue load, and user-impact signals may stop progression.

The deployment controller and traffic router should enforce the approved scope. A ten-percent canary approval should not allow full traffic through a manual console click.

## Post-Deployment Verification Checks Reality
<!-- section-summary: CD compares desired release state with runtime identity, live traffic, health, and product evidence. -->

A successful Kubernetes or cloud API response proves that the control plane accepted configuration. It does not prove that every worker loaded the candidate or that traffic reaches it.

The service exposes image, model, feature, and policy identities. Prediction telemetry records concrete version and route. CD checks rollout status, readiness, version endpoints, traffic metrics, error and latency bands, and a live fixture where safe.

Stale workers, cached aliases, partial rollouts, and feature mismatches appear as disagreement between desired and observed state. The pipeline pauses instead of widening traffic.

Labels and product outcomes may arrive later. The release remains under observation until the relevant window matures, even if infrastructure checks pass quickly.

The verification job should fail at the first mismatched boundary. For a Kubernetes Deployment, it can wait for controller progress, inspect the loaded version through the service, and confirm that prediction telemetry sees the same release:

```bash
set -euo pipefail

release_id=hazard-service-2026-07-12.3
namespace=hazard-canary

kubectl -n "$namespace" rollout status deployment/hazard-api --timeout=5m

runtime=$(curl --fail --silent https://hazard-canary.example.com/version)
jq --exit-status \
  --arg release "$release_id" \
  '.release_id == $release and
   .model_version == "42" and
   .model_digest == "sha256:8b6d..."' <<<"$runtime"

python verify_prediction_events.py \
  --release "$release_id" \
  --window 10m \
  --minimum-events 1000 \
  --maximum-mismatched-release-events 0
```

`kubectl rollout status` returns a non-zero exit code when the rollout exceeds its progress deadline. Kubernetes reports that stalled state; it does not automatically choose a product-safe rollback. The next two checks close the gap: the endpoint reports what it loaded, and prediction events prove which release handled traffic.

If rollout status succeeds while 2 percent of events still report version 41, CD pauses. A stale replica, service route, or telemetry join remains. The pipeline records the pod and revision identities, keeps traffic at the current canary percentage, and either repairs the mismatch or restores the rollback release. Widening traffic would convert a diagnosable partial rollout into mixed production behaviour.

## Rollback Restores A Known Complete System
<!-- section-summary: Rollback returns traffic to a retained model, image, configuration, and compatible feature path, then verifies recovery. -->

The rollback unit should match the release unit. A model-only rollback may fail if preprocessing changed. An image-only rollback may load an incompatible model. A registry alias change may not affect already running processes.

The pipeline or on-call runbook selects the previous release, applies its deployment state, waits for readiness, verifies runtime identities and traffic, and checks user-impact signals. The failed release remains preserved for investigation.

Some incidents need containment other than rollback: disable one segment, switch to a deterministic fallback, route to human review, or revert a feature feed. CD should expose kill switches without hiding them inside the model prompt.

## The Pipeline Is An Enforceable State Machine
<!-- section-summary: Delivery state connects immutable artifacts, evidence, approvals, rollout scope, observation, and recovery. -->

A practical pipeline moves through candidate built, gates passed, approved for scope, deployed to staging, verified, canary active, observing, promoted, or rolled back. Invalid transitions are rejected.

The state record carries the evidence for every transition:

```json
{
  "release_id": "hazard-service-2026-07-12.3",
  "state": "canary_observing",
  "previous_state": "canary_verified",
  "approved_traffic_percent": 5,
  "observed_traffic_percent": 5.02,
  "runtime_identity_match": true,
  "service_gate": "passed",
  "model_quality_gate": "pending_mature_labels",
  "rollback_release": "hazard-service-2026-06-28.2"
}
```

A request to move directly from `gates_passed` to `promoted` fails because staging, runtime verification, and canary observation have no evidence. A request above five percent fails because approval granted less authority. If a stop signal fires, the only permitted transition is `rolling_back`; recovery completes after runtime and prediction telemetry show the rollback release.

The state record above is intentionally not promotable: mature model quality is still pending, and its approval grants only five percent traffic. After outcomes mature and reviewers grant full scope, the transition request needs the complete subject and evidence rather than a button labelled “promote”:

```yaml
evaluated_at: "2026-07-14T14:00:00Z"
transition: {from: canary_observing, to: promoted}
release:
  release_id: hazard-service-2026-07-12.3
  image_digest: sha256:bd71...
  model_digest: sha256:8b6d...
  feature_contract: hazard-request-v4
  policy_digest: sha256:199a...
  rollback_release: hazard-service-2026-06-28.2
approval:
  decision_id: HAZ-REL-2026-0714-3
  subject:
    release_id: hazard-service-2026-07-12.3
    image_digest: sha256:bd71...
    model_digest: sha256:8b6d...
    feature_contract: hazard-request-v4
    policy_digest: sha256:199a...
  traffic_percent_max: 100
  segments: [all]
  expires_at: "2026-07-15T14:00:00Z"
requested_scope: {traffic_percent: 100, segment: all}
evidence:
  gates:
    software: {state: passed, evidence_sha256: a10e...}
    model_quality: {state: passed, evidence_sha256: b20f...}
    segment_quality: {state: passed, evidence_sha256: c30a...}
    serving_compatibility: {state: passed, evidence_sha256: d40b...}
    security: {state: passed, evidence_sha256: e50c...}
  runtime:
    replica_release_ids:
      - hazard-service-2026-07-12.3
      - hazard-service-2026-07-12.3
    image_digest: sha256:bd71...
    model_digest: sha256:8b6d...
    feature_contract: hazard-request-v4
    policy_digest: sha256:199a...
  canary:
    traffic_percent: 5
    observed_minutes: 60
    prediction_events: 28412
    mismatched_release_events: 0
    stop_signal_breaches: []
  rollback_drill:
    target_release: hazard-service-2026-06-28.2
    observed_release: hazard-service-2026-06-28.2
    fixture_errors: 0
```

The release, approval subject, runtime, and telemetry repeat some identities deliberately. Each comes from a different trust boundary. Equality between them proves that approval, desired state, loaded state, and observed traffic refer to one system.

The evaluator can now reject transitions deterministically. It treats an unknown gate as a denial, checks approval scope and expiry, compares loaded identities, requires a meaningful canary observation, and proves that the rollback drill restored the declared target:

```python
from datetime import datetime

ALLOWED_TRANSITIONS = {
    "canary_observing": {"promoted", "rolling_back"},
    "rolling_back": {"rolled_back"},
}
REQUIRED_PROMOTION_GATES = {
    "software",
    "model_quality",
    "segment_quality",
    "serving_compatibility",
    "security",
}
IDENTITY_FIELDS = {
    "image_digest",
    "model_digest",
    "feature_contract",
    "policy_digest",
}


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def evaluate_transition(request: dict) -> dict:
    transition = request["transition"]
    release = request["release"]
    approval = request["approval"]
    evidence = request["evidence"]
    reasons = []

    allowed_targets = ALLOWED_TRANSITIONS.get(transition["from"], set())
    if transition["to"] not in allowed_targets:
        reasons.append("transition is not allowed from the current state")

    approved_subject = approval["subject"]
    for field in {"release_id", *IDENTITY_FIELDS}:
        if approved_subject.get(field) != release.get(field):
            reasons.append(f"approval subject mismatch: {field}")

    if parse_time(request["evaluated_at"]) >= parse_time(approval["expires_at"]):
        reasons.append("approval expired")

    scope = request["requested_scope"]
    if scope["traffic_percent"] > approval["traffic_percent_max"]:
        reasons.append("requested traffic exceeds approval")
    if scope["segment"] not in approval["segments"]:
        reasons.append("requested segment is outside approval")

    if transition["to"] == "promoted":
        gates = evidence["gates"]
        for gate in sorted(REQUIRED_PROMOTION_GATES):
            if gates.get(gate, {}).get("state") != "passed":
                reasons.append(f"gate is not passed: {gate}")

        runtime = evidence["runtime"]
        if set(runtime["replica_release_ids"]) != {release["release_id"]}:
            reasons.append("replicas do not agree on release identity")
        for field in IDENTITY_FIELDS:
            if runtime.get(field) != release.get(field):
                reasons.append(f"runtime identity mismatch: {field}")

        canary = evidence["canary"]
        if canary["observed_minutes"] < 60 or canary["prediction_events"] < 10_000:
            reasons.append("canary observation is too small")
        if canary["mismatched_release_events"] != 0:
            reasons.append("prediction events contain another release")
        if canary["stop_signal_breaches"]:
            reasons.append("a canary stop signal breached")

        drill = evidence["rollback_drill"]
        if (
            drill["target_release"] != release["rollback_release"]
            or drill["observed_release"] != release["rollback_release"]
            or drill["fixture_errors"] != 0
        ):
            reasons.append("rollback drill did not restore the declared release")

    return {
        "allowed": not reasons,
        "release_id": release["release_id"],
        "from": transition["from"],
        "to": transition["to"],
        "reasons": reasons,
    }
```

Running the valid request returns an auditable decision:

```json
{
  "allowed": true,
  "release_id": "hazard-service-2026-07-12.3",
  "from": "canary_observing",
  "to": "promoted",
  "reasons": []
}
```

The evaluator itself needs tests. One test changes `segment_quality` from `passed` to `unknown`; another changes the runtime model digest; a third requests 110 percent traffic. None can inherit the valid result:

```python
from copy import deepcopy

assert evaluate_transition(promotion_request)["allowed"] is True

bad = deepcopy(promotion_request)
bad["evidence"]["gates"]["segment_quality"]["state"] = "unknown"
bad["evidence"]["runtime"]["model_digest"] = "sha256:different"
bad["requested_scope"]["traffic_percent"] = 110

decision = evaluate_transition(bad)
assert decision["allowed"] is False
assert decision["reasons"] == [
    "requested traffic exceeds approval",
    "gate is not passed: segment_quality",
    "runtime identity mismatch: model_digest",
]
```

This test protects three different boundaries: authority, evidence completeness, and observed runtime identity. It also fixes the denial order, which makes CI output stable enough for operators and reviewers to compare.

Rollback completion has a different subject. A successful controller command starts recovery; it does not close it. When the state is `rolling_back`, the recovery evaluator checks every ready replica, live routing, new prediction events, and the same fixture path used before release:

```python
def verify_rollback(expected_release: str, observation: dict) -> dict:
    reasons = []
    if set(observation["ready_replica_release_ids"]) != {expected_release}:
        reasons.append("ready replicas do not all run the rollback release")
    if observation["failed_release_traffic_percent"] != 0:
        reasons.append("failed release still receives traffic")
    if set(observation["prediction_event_release_ids"]) != {expected_release}:
        reasons.append("new prediction events do not agree on rollback release")
    if observation["prediction_event_count"] < 1000:
        reasons.append("too few post-rollback events to verify routing")
    if observation["fixture_errors"] != 0:
        reasons.append("rollback fixture failed")
    return {"verified": not reasons, "reasons": reasons}


rollback_observation = {
    "ready_replica_release_ids": [
        "hazard-service-2026-06-28.2",
        "hazard-service-2026-06-28.2",
    ],
    "failed_release_traffic_percent": 0,
    "prediction_event_release_ids": ["hazard-service-2026-06-28.2"],
    "prediction_event_count": 1824,
    "fixture_errors": 0,
}
assert verify_rollback(
    "hazard-service-2026-06-28.2", rollback_observation
) == {"verified": True, "reasons": []}
```

If one ready replica or one live route still names the failed release, recovery stays open. Operators preserve that mismatch, repair the replica or route, and rerun the same check. Product outcomes can require a longer monitoring window after this technical verification, so `rolled_back` and `incident_closed` should remain separate states.

CI systems such as GitHub Actions or GitLab CI can build and test. GitOps tools such as Argo CD or Flux can **reconcile** Kubernetes deployment state, meaning they compare the live cluster with declared state and correct differences. Cloud deployment services can operate managed endpoints. The toolchain should preserve one release identity and clear ownership rather than duplicate promotion state across dashboards.

Model service CD succeeds when the same tested release moves through trust boundaries, real traffic is verified, and recovery restores a complete known system. The pipeline is the enforcement of that framework, not a long sequence of deployment commands.

## References

- [Google SRE Workbook: Canarying Releases](https://sre.google/workbook/canarying-releases/)
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Argo Rollouts](https://argo-rollouts.readthedocs.io/)
- [Argo CD automated sync](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [SLSA specification](https://slsa.dev/spec/)
