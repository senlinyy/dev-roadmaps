---
title: "Approval Authority, Exceptions, and Periodic Review"
description: "Design accountable model decisions through separation of duties, scoped authority, expiring exceptions, reassessment, and auditable periodic review."
overview: "Model governance assigns policy ownership and approval authority, limits every approval and exception to a declared scope and expiry, and reviews active decisions as evidence or risk changes."
tags: ["MLOps", "production", "audit"]
order: 3
id: "article-mlops-governance-and-responsible-ai-who-approved-this-model"
aliases:
  - roadmaps/mlops/modules/governance-and-responsible-ai/governance/03-who-approved-this-model.md
  - child-governance-03-who-approved-this-model
---

## Approval Is Authority Applied To A Defined Use
<!-- section-summary: Approval records who accepted residual risk for one model, use, environment, scope, policy version, and time window. -->

**Approval authority** is the formally assigned power to accept the remaining risk of a model use after the required reviews finish. The decision applies to a named model version, intended use, environment, traffic scope, policy version, and time window. A person who can read an evaluation report has no automatic authority to accept its residual risk.

This article focuses on the governance decision around a release. Earlier evaluation articles explain how a team measures candidate quality, and release-management articles explain how deployment gates move an approved artifact. Governance supplies a different control: it determines who may decide, which policy gives that person authority, which exceptions remain active, and when the organization must revisit the decision.

The framework has six connected responsibilities:

1. **Policy ownership** defines risk tiers, required reviews, approval roles, exception rules, and review frequency.
2. **Separation of duties** prevents one person from requesting, assessing, approving, and releasing the same change alone.
3. **Scoped authority** limits an approver by system, risk tier, action, environment, and expiry.
4. **Exceptions** authorize a temporary deviation from one named control with compensating controls and an owner.
5. **Reassessment and periodic review** revisit approvals after time passes or material facts change.
6. **Audit evidence** connects every decision to a trusted identity, policy version, evidence set, and later action.

NIST's current AI Risk Management Framework Core supports this lifecycle. GOVERN 1.5 calls for ongoing monitoring and periodic review with defined roles and frequency. GOVERN 2.1 calls for clear roles and communication, while GOVERN 2.3 places responsibility for AI risk decisions with executive leadership. The NIST AI Resource Center currently marks AI RMF 1.0 as under revision, so a governance team should track the published revision and update its policy mapping when that work finishes.

## Separation Of Duties Creates Independent Decisions
<!-- section-summary: Different roles own policy, evidence, approval, exceptions, and release so one person cannot control the full decision path. -->

**Separation of duties** means dividing a sensitive operation across roles so one person lacks enough privilege to misuse the process alone. NIST describes static separation through conflicting role assignments and dynamic separation through access-time checks such as a two-person rule. A model approval system usually needs both forms.

Static separation assigns stable responsibilities. A model developer may submit a candidate and respond to findings. An independent reviewer assesses privacy, fairness, security, or operational evidence. An approval authority accepts residual risk within a delegated scope. A release operator executes the approved change. Dynamic checks then compare the actual identities on one request and deny combinations that violate policy, even when each person holds a valid role.

The role design should follow decision ownership rather than job titles. A small organization may assign several duties to the same team, while the sensitive transition still requires two distinct principals. The following table shows the responsibility boundary for a high-risk production model.

| Role | Decision owned | State the role may change | Important conflict |
|---|---|---|---|
| Policy owner | Which rules, risk tiers, roles, and review periods apply | Draft policy to published policy version | Should not silently change a rule for one pending request |
| Requester or system owner | Which model use is requested and who operates it | Draft request to submitted request | Cannot approve the same request |
| Control reviewer | Whether evidence satisfies one control | Review pending to accepted or rejected | Cannot review evidence they produced alone when policy requires independence |
| Approval authority | Whether residual risk is accepted for the declared scope | Pending request to approved or denied decision | Must hold an active scoped grant and remain distinct from the requester |
| Exception owner | Which compensating control runs until a gap closes | Exception requested to remediated or closed | Cannot approve their own exception |
| Release operator | Whether the approved artifact reached the declared target | Approved decision to deployed release event | Cannot enlarge the approval scope during deployment |
| Assurance or audit | Whether the process and records match policy | Finding open to resolved | Keeps read access and finding authority rather than release authority |

This division also makes incident investigation clearer. If a deployment exceeded its approved traffic percentage, the records identify whether the approval scope was wrong, the release operator supplied a different target, or the serving platform ignored the desired state. One broad `ml-admin` group hides those distinctions.

## Policy Ownership Defines The Decision Contract
<!-- section-summary: A versioned policy tells people and automation which controls apply, who may approve them, and how long decisions remain valid. -->

A **policy owner** maintains the decision rules for a class of systems. The owner defines the risk classification, required control reviews, approval roles, non-exceptionable controls, exception approval rules, maximum approval duration, and periodic-review frequency. Changes go through their own review because a policy change can alter every later decision.

The policy is a contract between governance and engineering. Humans need plain explanations of why a rule exists. Automation needs stable identifiers and explicit values. A policy version should therefore travel with each request and decision. When the current policy changes from `pricing-risk/v6` to `pricing-risk/v7`, active decisions tied to `v6` enter reassessment instead of inheriting the new rules silently.

For an insurance renewal-pricing model, the policy could require accepted privacy-impact and segment-risk reviews before a production canary. The policy may allow a temporary exception for a delayed documentation control, while it can mark data-usage authorization as non-exceptionable. The model team still produces evaluation evidence; this policy decides which independent parties must review that evidence and who can accept the remaining risk.

```yaml
policy_id: pricing-risk
version: v6
risk_tier: high
systems: [renewal-price-adjustment]
actions: [approve-use]
required_controls:
  production-canary:
    - data-usage-authorization
    - privacy-impact
    - segment-risk
    - operational-readiness
non_exceptionable_controls:
  - data-usage-authorization
approval:
  authority_group: ai-risk-approvers
  maximum_duration_days: 180
  periodic_review_days: 90
exception:
  authority_group: ai-exception-board
  minimum_distinct_approvers: 2
  maximum_duration_days: 30
```

The control identifiers stay stable across tools. A ticket, database row, review report, and decision service can all refer to `segment-risk`. Policy publication should create an immutable version, record the authors and reviewers, and notify system owners whose active approvals use an older version.

## A Trusted Principal Must Match A Scoped Grant
<!-- section-summary: The decision service combines verified identity claims with a narrow authority grant instead of trusting names supplied in a request. -->

A **principal** is the authenticated person or workload making a request. The decision service should receive the principal from a verified identity token or workload identity. It validates the token signature, trusted issuer, intended audience, and expiry before constructing internal principal state. Fields such as `subject` and `groups` should never come from the approval request body.

An identity group alone gives too much implied power. A separate **authority grant** records exactly where the principal's group can act. The grant below permits members of `ai-risk-approvers` to approve high-risk production canaries for one system until the end of September. It gives no permission for full production traffic or another model family.

```yaml
grant_id: grant-pricing-canary-2026-q3
principal_group: ai-risk-approvers
trusted_issuer: https://identity.example.com/
actions: [approve-use]
systems: [renewal-price-adjustment]
environments: [production-canary]
risk_tiers: [high]
valid_from: 2026-07-01T00:00:00Z
expires_at: 2026-09-30T23:59:59Z
policy_version: pricing-risk/v6
```

The service evaluates both identity and grant at decision time. Removing a person from the identity group blocks a later decision. Revoking the grant blocks the whole delegation. An approval already recorded keeps the original subject and grant ID in its audit record, while a policy can require reassessment after a grant revocation.

## The Decision Mechanism Checks State Before It Approves
<!-- section-summary: A concrete decision function verifies trusted identity, separation of duties, authority scope, control reviews, exceptions, and expiry before producing an immutable result. -->

The mechanism below receives post-verification principal state, a pending approval request, the immutable policy contract loaded by trusted application code, authority grants, independent control reviews, and any exception approvals. The request can ask for a shorter approval window, while it cannot choose which controls apply, make a control exceptionable, extend the policy maximum, or set its own review date. The function returns an explicit approved or denied result. The caller stores the result as an append-only event and uses the status transition to control the later release step.

The code uses only the Python standard library so the authority logic can run in a test without a policy server. A larger platform may implement the same rules in Open Policy Agent, Cedar, a cloud authorization service, or an internal decision service. The key design is the input and output contract rather than the product.

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
from typing import Literal, Optional

TRUSTED_ISSUER = "https://identity.example.com/"


@dataclass(frozen=True)
class Principal:
    issuer: str
    subject: str
    groups: frozenset[str]
    expires_at: datetime


@dataclass(frozen=True)
class AuthorityGrant:
    grant_id: str
    principal_group: str
    systems: frozenset[str]
    environments: frozenset[str]
    actions: frozenset[str]
    risk_tiers: frozenset[str]
    policy_version: str
    valid_from: datetime
    expires_at: datetime


@dataclass(frozen=True)
class ApprovalPolicy:
    policy_version: str
    systems: frozenset[str]
    environments: frozenset[str]
    actions: frozenset[str]
    risk_tier: str
    approval_authority_group: str
    required_controls: frozenset[str]
    non_exceptionable_controls: frozenset[str]
    maximum_approval_days: int
    periodic_review_days: int
    exception_minimum_distinct_approvers: int
    exception_maximum_duration_days: int


@dataclass(frozen=True)
class ControlReview:
    review_id: str
    request_id: str
    control_id: str
    reviewer_subject: str
    status: Literal["accepted", "rejected"]
    valid_until: datetime


@dataclass(frozen=True)
class ExceptionApproval:
    exception_id: str
    request_id: str
    control_id: str
    owner_subject: str
    approved_by: tuple[str, ...]
    compensating_controls: tuple[str, ...]
    status: Literal["approved", "denied", "closed"]
    expires_at: datetime


@dataclass(frozen=True)
class ApprovalRequest:
    request_id: str
    state: Literal["pending", "approved", "denied"]
    system_id: str
    model_version: str
    environment: str
    action: str
    risk_tier: str
    requester_subject: str
    policy_version: str
    requested_valid_until: datetime


@dataclass(frozen=True)
class ApprovalDecision:
    decision_id: str
    request_id: str
    status: Literal["approved", "denied"]
    code: str
    approver_subject: str
    authority_grant_id: Optional[str]
    policy_version: str
    valid_until: Optional[datetime]
    next_review_at: Optional[datetime]
    review_ids: tuple[str, ...]
    exception_ids: tuple[str, ...]
    reason: str
    recovery: Optional[str]


def _decision_id(request: ApprovalRequest, principal: Principal, now: datetime) -> str:
    material = f"{request.request_id}|{principal.subject}|{now.isoformat()}"
    return "decision-" + sha256(material.encode()).hexdigest()[:16]


def _deny(
    request: ApprovalRequest,
    principal: Principal,
    now: datetime,
    code: str,
    reason: str,
    recovery: str,
) -> ApprovalDecision:
    return ApprovalDecision(
        decision_id=_decision_id(request, principal, now),
        request_id=request.request_id,
        status="denied",
        code=code,
        approver_subject=principal.subject,
        authority_grant_id=None,
        policy_version=request.policy_version,
        valid_until=None,
        next_review_at=None,
        review_ids=(),
        exception_ids=(),
        reason=reason,
        recovery=recovery,
    )


def decide_approval(
    principal: Principal,
    request: ApprovalRequest,
    policy: ApprovalPolicy,
    grants: tuple[AuthorityGrant, ...],
    reviews: tuple[ControlReview, ...],
    exceptions: tuple[ExceptionApproval, ...],
    now: datetime,
) -> ApprovalDecision:
    if principal.issuer != TRUSTED_ISSUER or principal.expires_at <= now:
        return _deny(
            request, principal, now, "untrusted_principal",
            "The verified identity is expired or came from an untrusted issuer.",
            "Authenticate again through the trusted identity provider.",
        )

    if request.state != "pending":
        return _deny(
            request, principal, now, "invalid_request_state",
            f"Request state {request.state!r} cannot receive a new approval.",
            "Create a new request or use the recorded renewal workflow.",
        )

    if (
        request.policy_version != policy.policy_version
        or request.system_id not in policy.systems
        or request.environment not in policy.environments
        or request.action not in policy.actions
        or request.risk_tier != policy.risk_tier
    ):
        return _deny(
            request, principal, now, "policy_contract_mismatch",
            "The request does not match the immutable policy version, system, action, environment, and risk tier loaded by the decision service.",
            "Create a request against the current published policy contract.",
        )

    if (
        policy.maximum_approval_days <= 0
        or policy.periodic_review_days <= 0
        or policy.exception_minimum_distinct_approvers <= 0
        or policy.exception_maximum_duration_days <= 0
    ):
        return _deny(
            request, principal, now, "invalid_policy_contract",
            "The published policy contains an invalid duration or approval rule.",
            "Stop decisions and repair the policy release before retrying.",
        )

    if request.requested_valid_until <= now:
        return _deny(
            request, principal, now, "invalid_requested_window",
            "The requested approval window has already ended.",
            "Submit a new request with a future end time.",
        )

    if principal.subject == request.requester_subject:
        return _deny(
            request, principal, now, "separation_of_duties",
            "The requester and final approver are the same principal.",
            "Route the request to a different authorized approver.",
        )

    scoped = [
        grant for grant in grants
        if grant.principal_group == policy.approval_authority_group
        and grant.principal_group in principal.groups
        and request.system_id in grant.systems
        and request.environment in grant.environments
        and request.action in grant.actions
        and request.risk_tier in grant.risk_tiers
        and request.policy_version == grant.policy_version
    ]
    active = [grant for grant in scoped if grant.valid_from <= now < grant.expires_at]

    if not active:
        expired = any(grant.expires_at <= now for grant in scoped)
        code = "authority_expired" if expired else "authority_out_of_scope"
        return _deny(
            request, principal, now, code,
            "No active authority grant covers this system, action, environment, risk tier, and policy version.",
            "Request a scoped grant from the authority administrator or use an approver with an active grant.",
        )

    grant = max(active, key=lambda item: item.expires_at)
    accepted_review_ids: list[str] = []
    accepted_exception_ids: list[str] = []
    policy_valid_until = now + timedelta(days=policy.maximum_approval_days)
    validity_limits = [
        request.requested_valid_until,
        grant.expires_at,
        policy_valid_until,
    ]

    for control_id in sorted(policy.required_controls):
        valid_reviews = [
            review for review in reviews
            if review.request_id == request.request_id
            and review.control_id == control_id
            and review.status == "accepted"
            and review.reviewer_subject != request.requester_subject
            and review.valid_until > now
        ]
        if valid_reviews:
            review = max(valid_reviews, key=lambda item: item.valid_until)
            accepted_review_ids.append(review.review_id)
            validity_limits.append(review.valid_until)
            continue

        matching_exceptions = [
            item for item in exceptions
            if item.request_id == request.request_id
            and item.control_id == control_id
            and item.status == "approved"
        ]
        valid_exceptions = [item for item in matching_exceptions if item.expires_at > now]

        if matching_exceptions and control_id in policy.non_exceptionable_controls:
            return _deny(
                request, principal, now, "non_exceptionable_control",
                f"Policy forbids an exception for control {control_id!r}.",
                f"Complete an accepted review for control {control_id!r} before requesting approval again.",
            )

        if matching_exceptions and not valid_exceptions:
            return _deny(
                request, principal, now, "exception_expired",
                f"The exception for control {control_id!r} has expired.",
                "Complete the control review or submit a new time-bounded exception with current evidence.",
            )

        if valid_exceptions:
            exception = min(valid_exceptions, key=lambda item: item.expires_at)
            independent_approvers = set(exception.approved_by) - {
                request.requester_subject,
                exception.owner_subject,
                principal.subject,
            }
            maximum_exception_expiry = now + timedelta(
                days=policy.exception_maximum_duration_days,
            )
            if exception.expires_at > maximum_exception_expiry:
                return _deny(
                    request, principal, now, "exception_duration_exceeded",
                    f"The exception for control {control_id!r} exceeds the policy duration limit.",
                    "Return the exception to the board with an allowed expiry.",
                )
            if (
                len(independent_approvers)
                < policy.exception_minimum_distinct_approvers
                or not exception.compensating_controls
            ):
                return _deny(
                    request, principal, now, "invalid_exception",
                    f"The exception for control {control_id!r} lacks two independent approvers or a compensating control.",
                    "Return the exception to the exception board for a complete independent decision.",
                )
            accepted_exception_ids.append(exception.exception_id)
            validity_limits.append(exception.expires_at)
            continue

        return _deny(
            request, principal, now, "missing_control_review",
            f"Control {control_id!r} has no current accepted review or approved exception.",
            f"Route control {control_id!r} to its assigned reviewer before requesting approval again.",
        )

    return ApprovalDecision(
        decision_id=_decision_id(request, principal, now),
        request_id=request.request_id,
        status="approved",
        code="approved_with_exception" if accepted_exception_ids else "approved",
        approver_subject=principal.subject,
        authority_grant_id=grant.grant_id,
        policy_version=request.policy_version,
        valid_until=min(validity_limits),
        next_review_at=min(
            min(validity_limits),
            now + timedelta(days=policy.periodic_review_days),
        ),
        review_ids=tuple(sorted(accepted_review_ids)),
        exception_ids=tuple(sorted(accepted_exception_ids)),
        reason="All required controls have current independent evidence or a valid exception.",
        recovery=None,
    )
```

The checks follow the governance responsibilities in order. Identity establishes the actor. The immutable policy supplies required controls, non-exceptionable controls, duration limits, and review cadence. Separation of duties compares the actor with the requester. The authority grant limits the action. Control reviews and exceptions determine whether every policy requirement has a current disposition. The result keeps the grant, policy, reviews, exceptions, expiry, and derived next review date together.

An approved decision has a shorter lifetime when one of its dependencies expires early. For example, a six-month request with a 30-day exception receives at most 30 days of approval. This prevents a temporary waiver from quietly supporting a longer production use.

## Denial And Recovery Are First-Class Outcomes
<!-- section-summary: A denial carries a machine-readable reason and a concrete recovery route instead of a generic forbidden response. -->

Governance denials need enough detail for an authorized operator to fix the decision state. A plain HTTP `403` tells the requester that access failed, while the decision code explains which responsibility failed. The service should keep sensitive identity details out of public responses and write the full explanation to the protected decision record.

For a valid request with all independent reviews, the function returns an approved state such as this:

```json
{
  "status": "approved",
  "code": "approved",
  "authority_grant_id": "grant-pricing-canary-2026-q3",
  "policy_version": "pricing-risk/v6",
  "valid_until": "2026-09-30T23:59:59+00:00",
  "next_review_at": "2026-09-30T23:59:59+00:00",
  "review_ids": ["review-data-use-22", "review-operations-12", "review-privacy-41", "review-segment-18"],
  "exception_ids": []
}
```

If the privacy review is missing and its temporary exception expired yesterday, the output changes to a denied state with a recovery route:

```json
{
  "status": "denied",
  "code": "exception_expired",
  "reason": "The exception for control 'privacy-impact' has expired.",
  "recovery": "Complete the control review or submit a new time-bounded exception with current evidence."
}
```

The workflow stores both outcomes. A denied request can return to `pending` only through a recorded resubmission or renewal transition. Editing the old decision would erase the reason it failed and weaken the audit trail.

## Exceptions Are Narrow, Temporary Risk Decisions
<!-- section-summary: An exception authorizes one declared control gap for a limited scope and time while an owner maintains compensating controls and remediation. -->

An **exception** is a formal, temporary decision to proceed while one named control remains incomplete. It should identify the exact request and control, the reason for the gap, the remaining risk, compensating controls, an owner, distinct approvers, an expiry, and an exit condition. It should never act as a reusable `skip_governance` flag.

Suppose an external accessibility review for a customer-service routing model will finish ten days after the planned internal pilot. The policy may permit an internal-only pilot while trained supervisors review every recommendation, no automated customer decision occurs, and the exception expires in ten days. The exception gives the team a bounded way to learn while preserving the missing control as visible work.

The owner maintains the compensating control and supplies proof. Exception-board approvers judge whether the temporary arrangement keeps residual risk inside policy. The final model approval authority then sees the exception as one dependency; they do not create it inside the approval action. Policy can mark some controls non-exceptionable, so the decision mechanism should reject an exception for those controls before it reaches final approval.

An exception lifecycle usually carries these states: `requested`, `under_review`, `approved`, `denied`, `expired`, `remediated`, and `closed`. The scheduler marks an approved exception expired at its timestamp. The connected model approval either expires at the same time or enters an explicit hold state. Recovery requires completion of the original control, a newly reviewed exception, or withdrawal of the use.

## Periodic Review Rechecks A Live Decision
<!-- section-summary: Scheduled and event-driven reassessment compare the current system with the scope, evidence, policy, and expiry of its approval. -->

**Periodic review** is a planned reassessment of an active approval. The review asks whether the approved use, model identity, risk, evidence, policy, controls, and operating conditions still match the recorded decision. A reviewer can renew the decision, narrow its scope, require remediation, suspend it, revoke it, or begin decommissioning.

Time supplies one trigger, and material change supplies others. A new intended use, a major feature or data-source change, a severe incident, a risk-threshold breach, a third-party dependency change, a new policy version, or an expiring exception can bring reassessment forward. The policy owner defines which changes are material for each system class.

The decision store should expose a review queue rather than relying on calendar reminders owned by one person. The following PostgreSQL query finds active approvals whose review is due within 14 days, whose authorization expires within 30 days, or whose policy version differs from the current system policy.

```sql
SELECT
  d.decision_id,
  d.system_id,
  d.model_version,
  d.environment,
  d.policy_version AS approved_policy_version,
  s.current_policy_version,
  d.next_review_at,
  d.valid_until,
  d.exception_ids,
  CASE
    WHEN d.policy_version <> s.current_policy_version THEN 'policy_changed'
    WHEN d.valid_until <= CURRENT_TIMESTAMP THEN 'approval_expired'
    WHEN d.next_review_at <= CURRENT_TIMESTAMP THEN 'review_overdue'
    WHEN d.next_review_at <= CURRENT_TIMESTAMP + INTERVAL '14 days' THEN 'review_due_soon'
    WHEN d.valid_until <= CURRENT_TIMESTAMP + INTERVAL '30 days' THEN 'approval_expiring'
  END AS review_reason
FROM governance.approval_decisions AS d
JOIN governance.ai_systems AS s
  ON s.system_id = d.system_id
WHERE d.status = 'approved'
  AND (
    d.policy_version <> s.current_policy_version
    OR d.next_review_at <= CURRENT_TIMESTAMP + INTERVAL '14 days'
    OR d.valid_until <= CURRENT_TIMESTAMP + INTERVAL '30 days'
  )
ORDER BY
  LEAST(d.next_review_at, d.valid_until),
  d.system_id;
```

The query uses the decision's recorded dates instead of calculating policy from scratch. A review worker can open a reassessment case with the reason, owner, deadline, and exact previous decision. After review, the worker writes a new decision linked through `supersedes_decision_id`. The previous record remains available for audit.

## Tests Prove The Authority Boundaries
<!-- section-summary: Executable tests cover approval, requester-approver conflict, authority scope, valid exceptions, and expired exceptions. -->

Authority code deserves the same deterministic testing as deployment code. The tests below use a fixed UTC clock and concrete principals, grants, reviews, and exceptions. They verify the decision state and recovery code instead of checking only that a function returned.

```python
import unittest
from dataclasses import replace
from datetime import datetime, timezone

UTC = timezone.utc
NOW = datetime(2026, 7, 15, 12, 0, tzinfo=UTC)

PRINCIPAL = Principal(
    issuer=TRUSTED_ISSUER,
    subject="user:alice",
    groups=frozenset({"ai-risk-approvers"}),
    expires_at=datetime(2026, 7, 15, 20, 0, tzinfo=UTC),
)

REQUEST = ApprovalRequest(
    request_id="approval-renewal-price-v27",
    state="pending",
    system_id="renewal-price-adjustment",
    model_version="27",
    environment="production-canary",
    action="approve-use",
    risk_tier="high",
    requester_subject="user:maria",
    policy_version="pricing-risk/v6",
    requested_valid_until=datetime(2027, 1, 1, tzinfo=UTC),
)

POLICY = ApprovalPolicy(
    policy_version="pricing-risk/v6",
    systems=frozenset({"renewal-price-adjustment"}),
    environments=frozenset({"production-canary"}),
    actions=frozenset({"approve-use"}),
    risk_tier="high",
    approval_authority_group="ai-risk-approvers",
    required_controls=frozenset({
        "data-usage-authorization",
        "privacy-impact",
        "segment-risk",
        "operational-readiness",
    }),
    non_exceptionable_controls=frozenset({"data-usage-authorization"}),
    maximum_approval_days=180,
    periodic_review_days=90,
    exception_minimum_distinct_approvers=2,
    exception_maximum_duration_days=30,
)

GRANT = AuthorityGrant(
    grant_id="grant-pricing-canary-2026-q3",
    principal_group="ai-risk-approvers",
    systems=frozenset({"renewal-price-adjustment"}),
    environments=frozenset({"production-canary"}),
    actions=frozenset({"approve-use"}),
    risk_tiers=frozenset({"high"}),
    policy_version="pricing-risk/v6",
    valid_from=datetime(2026, 7, 1, tzinfo=UTC),
    expires_at=datetime(2026, 9, 30, 23, 59, 59, tzinfo=UTC),
)

REVIEWS = (
    ControlReview(
        "review-data-use-22", REQUEST.request_id, "data-usage-authorization",
        "user:imani", "accepted", datetime(2027, 1, 1, tzinfo=UTC),
    ),
    ControlReview(
        "review-privacy-41", REQUEST.request_id, "privacy-impact",
        "user:priya", "accepted", datetime(2027, 1, 1, tzinfo=UTC),
    ),
    ControlReview(
        "review-segment-18", REQUEST.request_id, "segment-risk",
        "user:dan", "accepted", datetime(2027, 1, 1, tzinfo=UTC),
    ),
    ControlReview(
        "review-operations-12", REQUEST.request_id, "operational-readiness",
        "user:sofia", "accepted", datetime(2027, 1, 1, tzinfo=UTC),
    ),
)


class ApprovalDecisionTests(unittest.TestCase):
    def test_approves_current_evidence_and_clamps_to_grant_expiry(self):
        result = decide_approval(
            PRINCIPAL, REQUEST, POLICY, (GRANT,), REVIEWS, (), NOW,
        )
        self.assertEqual(result.status, "approved")
        self.assertEqual(result.valid_until, GRANT.expires_at)
        self.assertEqual(result.next_review_at, GRANT.expires_at)
        self.assertEqual(result.review_ids, (
            "review-data-use-22",
            "review-operations-12",
            "review-privacy-41",
            "review-segment-18",
        ))

    def test_requester_cannot_approve_their_own_request(self):
        requester = replace(PRINCIPAL, subject=REQUEST.requester_subject)
        result = decide_approval(
            requester, REQUEST, POLICY, (GRANT,), REVIEWS, (), NOW,
        )
        self.assertEqual(result.code, "separation_of_duties")
        self.assertIn("different authorized approver", result.recovery)

    def test_grant_cannot_approve_a_larger_environment(self):
        full_release = replace(REQUEST, environment="production-full")
        result = decide_approval(
            PRINCIPAL, full_release, POLICY, (GRANT,), REVIEWS, (), NOW,
        )
        self.assertEqual(result.code, "policy_contract_mismatch")

    def test_valid_exception_limits_approval_lifetime(self):
        exception = ExceptionApproval(
            exception_id="exception-privacy-7",
            request_id=REQUEST.request_id,
            control_id="privacy-impact",
            owner_subject="user:omar",
            approved_by=("user:bea", "user:li"),
            compensating_controls=("manual-review-every-decision",),
            status="approved",
            expires_at=datetime(2026, 8, 1, tzinfo=UTC),
        )
        result = decide_approval(
            PRINCIPAL,
            REQUEST,
            POLICY,
            (GRANT,),
            tuple(review for review in REVIEWS if review.control_id != "privacy-impact"),
            (exception,),
            NOW,
        )
        self.assertEqual(result.code, "approved_with_exception")
        self.assertEqual(result.valid_until, exception.expires_at)
        self.assertEqual(result.exception_ids, ("exception-privacy-7",))

    def test_expired_exception_returns_a_recovery_route(self):
        expired = ExceptionApproval(
            exception_id="exception-privacy-6",
            request_id=REQUEST.request_id,
            control_id="privacy-impact",
            owner_subject="user:omar",
            approved_by=("user:bea", "user:li"),
            compensating_controls=("manual-review-every-decision",),
            status="approved",
            expires_at=datetime(2026, 7, 14, tzinfo=UTC),
        )
        result = decide_approval(
            PRINCIPAL,
            REQUEST,
            POLICY,
            (GRANT,),
            tuple(review for review in REVIEWS if review.control_id != "privacy-impact"),
            (expired,),
            NOW,
        )
        self.assertEqual(result.status, "denied")
        self.assertEqual(result.code, "exception_expired")
        self.assertIn("new time-bounded exception", result.recovery)

    def test_non_exceptionable_control_requires_a_review(self):
        exception = ExceptionApproval(
            exception_id="exception-data-use-1",
            request_id=REQUEST.request_id,
            control_id="data-usage-authorization",
            owner_subject="user:omar",
            approved_by=("user:bea", "user:li"),
            compensating_controls=("manual-review-every-decision",),
            status="approved",
            expires_at=datetime(2026, 8, 1, tzinfo=UTC),
        )
        result = decide_approval(
            PRINCIPAL,
            REQUEST,
            POLICY,
            (GRANT,),
            tuple(
                review for review in REVIEWS
                if review.control_id != "data-usage-authorization"
            ),
            (exception,),
            NOW,
        )
        self.assertEqual(result.code, "non_exceptionable_control")

    def test_past_requested_window_is_denied(self):
        stale_request = replace(
            REQUEST,
            requested_valid_until=datetime(2026, 7, 14, tzinfo=UTC),
        )
        result = decide_approval(
            PRINCIPAL, stale_request, POLICY, (GRANT,), REVIEWS, (), NOW,
        )
        self.assertEqual(result.code, "invalid_requested_window")

    def test_request_cannot_select_an_older_policy(self):
        stale_policy_request = replace(REQUEST, policy_version="pricing-risk/v5")
        result = decide_approval(
            PRINCIPAL, stale_policy_request, POLICY, (GRANT,), REVIEWS, (), NOW,
        )
        self.assertEqual(result.code, "policy_contract_mismatch")

    def test_request_cannot_downgrade_policy_risk_or_authority(self):
        low_risk_request = replace(REQUEST, risk_tier="low")
        rogue_principal = replace(
            PRINCIPAL,
            subject="user:rogue",
            groups=frozenset({"rogue-approvers"}),
        )
        rogue_grant = replace(
            GRANT,
            grant_id="grant-rogue-low-risk",
            principal_group="rogue-approvers",
            risk_tiers=frozenset({"low"}),
        )
        result = decide_approval(
            rogue_principal,
            low_risk_request,
            POLICY,
            (rogue_grant,),
            REVIEWS,
            (),
            NOW,
        )
        self.assertEqual(result.code, "policy_contract_mismatch")


if __name__ == "__main__":
    unittest.main()
```

Expected output from the combined mechanism and test blocks is:

```console
.........
----------------------------------------------------------------------
Ran 9 tests

OK
```

These cases cover ordinary approval and the boundaries where governance often fails. They also prove that an exception shortens approval validity and that a denial tells the workflow where to send the request next.

## Audit Events Preserve Decision History
<!-- section-summary: Append-only events connect policy, identity, authority, evidence, exceptions, decisions, reviews, and release actions over time. -->

An audit trail should record every state change around authority, including policy publication, authority grant creation or revocation, request submission, control review, exception decision, final approval, reassessment, suspension, revocation, expiry, and release execution. Each event needs a timestamp, event type, trusted actor identity, request and decision IDs, system and model identity, policy version, before and after state, evidence references, and a correlation ID.

The final decision event can store the exact input digest used by the decision service. A later investigation can retrieve the immutable policy version, authority grant, review records, and exception records that produced the result. Platform logs then show whether the release operator deployed within that scope.

Retention and access follow the organization's risk, legal, privacy, and incident-response requirements. An append-only database table supports operational queries, while a write-protected archive can support longer retention. Sensitive review evidence may require narrower access than decision metadata, so the audit event can carry a digest and governed reference instead of copying the evidence body.

## The Governance Loop Keeps Authority Current
<!-- section-summary: Policy, independent review, scoped authority, exceptions, reassessment, and audit work as one continuing governance loop. -->

Approval authority answers who may accept residual risk for a declared model use. Separation of duties keeps evidence production, review, approval, exception ownership, and release execution independently accountable. A scoped grant limits the decision to the exact system, action, environment, risk tier, policy, and time window.

Exceptions preserve a visible control gap with compensating controls, distinct approvers, an owner, and an expiry. Periodic and event-driven reassessment compare a live system with its original decision. Audit events connect each change so a future reviewer can explain who decided, under which authority, what expired, and how the organization responded.

## References

- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) - Current NIST core outcomes for governance roles, periodic review, monitoring, accountability, and risk decisions.
- [NIST AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/) - Suggested actions and documentation practices for applying the AI RMF outcomes.
- [NIST CSRC: Separation of Duty](https://csrc.nist.gov/glossary/term/Separation_of_Duty) - NIST definition and static, dynamic, and two-person separation examples.
- [NIST CSRC: Least Privilege](https://csrc.nist.gov/glossary/term/least_privilege) - NIST definitions for restricting authorizations to assigned tasks.
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) - Identity token claims and validation requirements for issuer, audience, signature, and expiry.
