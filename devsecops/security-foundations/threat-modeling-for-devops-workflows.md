---
title: "Threat Modeling"
description: "Find realistic ways a delivery workflow can be abused, then choose controls that change the outcome."
overview: "Threat modeling turns the delivery trust model into a practical review conversation. This article follows a GitHub Actions workflow, uses the TanStack npm compromise as a case study, and shows how to move from vague worry to specific controls."
tags: ["threat-modeling", "pipelines", "risk", "supply-chain"]
order: 2
id: article-devsecops-security-foundations-threat-modeling-devops-workflows
aliases:
  - threat-modeling-for-devops-workflows
  - article-devsecops-security-foundations-threat-modeling-devops-workflows
  - devsecops/security-foundations/threat-modeling-for-devops-workflows.md
---

## Table of Contents

1. [What Is Threat Modeling?](#what-is-threat-modeling)
2. [Start With One Path](#start-with-one-path)
3. [Name the Boundary](#name-the-boundary)
4. [Turn Worry Into Scenarios](#turn-worry-into-scenarios)
5. [Case Study: TanStack](#case-study-tanstack)
6. [Controls That Change the Story](#controls-that-change-the-story)
7. [Review Evidence](#review-evidence)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Is Threat Modeling?

Threat modeling is a structured way to ask what can go wrong before the wrong thing happens. In DevSecOps work, the object under review is usually a delivery path: a pull request, workflow, package publish, container image, Terraform plan, Kubernetes deployment, or production access path.

The output should be plain. A good threat model does not need a long template before it is useful. It needs a path, a boundary, a realistic attacker action, and a control that would change the result.

For `devpolaris-orders-api`, the starting question is simple:

```text
Can untrusted code or an unexpected identity reach a production-changing step?
```

That question is useful because it names both sides of the problem. "Untrusted code" includes code from forks, generated files, package install scripts, cached dependencies, and third-party actions. "Production-changing step" includes publishing a package, pushing an image, deploying to a cloud service, changing an IAM role, or writing a Kubernetes manifest into the cluster.

Threat modeling makes security practical because it keeps review connected to a concrete path. Instead of asking whether the whole pipeline is secure, ask which step accepts input, which step receives power, and whether those two steps can touch each other.

## Start With One Path

Start with the normal path before inventing attacker paths. The normal path for the orders service looks like this:

```text
pull request
  -> test workflow
  -> merge to main
  -> build image
  -> publish image
  -> approve production
  -> deploy service
```

Each arrow is a handoff. The pull request hands source code to the test workflow. The merge hands reviewed code to the build workflow. The build hands an image digest to the registry. The deployment hands that digest to production.

Now add the trust level beside each step.

| Step | Trust level | Reason |
|-----------|-------------|--------|
| Pull request from fork | Untrusted | The author controls the code and scripts in the branch. |
| Test workflow | Low power | It should read code and report results. |
| Merge to `main` | Trusted source | Branch protection and review have accepted the change. |
| Build workflow | Trusted builder | It creates the artifact the team may deploy. |
| Publish image | Registry write | It changes what later deployments can pull. |
| Production approval | Human gate | It allows the deploy job to continue. |
| Deploy service | Production write | It changes the running system. |

This table is small, but it changes the conversation. A low-power test job can run untrusted code if it has no secrets, no write token, no shared trusted cache, and no path to publishing. A trusted builder can publish artifacts if it only consumes reviewed source and controlled dependencies. The threat model asks whether those assumptions hold.

## Name the Boundary

A boundary is where one trust level meets another. The most important boundaries in CI/CD are usually:

- Fork code enters a base repository workflow.
- A job receives a token.
- A cache or artifact is reused by a later job.
- A third-party action runs inside the workflow.
- A package install script runs during dependency installation.
- A publish or deploy step receives registry or cloud authority.

The boundary is where the reviewer should slow down. Here is a risky workflow shape:

```yaml
on:
  pull_request_target:
    branches: ["main"]

permissions:
  contents: write
  id-token: write

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: refs/pull/${{ github.event.pull_request.number }}/merge
      - run: npm ci
      - run: npm run benchmark
```

The first boundary is `pull_request_target`. That event runs with the base repository context. The second boundary is the checkout ref, which pulls pull request code into that context. The third boundary is `id-token: write`, which allows a job to request an OIDC token. The fourth boundary is `npm ci`, because dependency lifecycle scripts can execute code during installation.

None of these fields is automatically bad in every workflow. The problem is their combination. The threat model should describe that combination in one sentence:

```text
Untrusted pull request code can run in a base repository workflow that can request an OIDC token.
```

That sentence is specific enough to fix.

## Turn Worry Into Scenarios

A threat scenario should sound like something a reviewer can test. Avoid broad statements such as "attackers may compromise CI." Write a short path instead.

| Vague worry | Useful scenario | First evidence to inspect |
|-------------|-----------------|---------------------------|
| CI could be abused | Fork code runs in `pull_request_target` and receives a writable token | Event, checkout ref, permissions |
| Dependencies are risky | A package install script reads environment variables during `npm ci` | Lockfile, lifecycle scripts, workflow env |
| Caches are dangerous | A pull request job writes a cache later restored by a release job | Cache key, event scope, restore path |
| Third-party actions are risky | A mutable action tag changes after review | Action ref and commit SHA |
| Publishing could be hijacked | Any code path in the release job can reach registry credentials | Publish identity, token scope, step isolation |

The useful scenario contains a verb. Fork code runs. A package script reads. A cache is restored. A tag changes. A code path reaches. Verbs make the review concrete.

For beginner teams, three questions are enough for a first pass:

```text
What input enters this step?
What power does this step receive?
What could connect the input to the power?
```

If those questions are hard to answer, the workflow is too hard to review.

## Case Study: TanStack

In May 2026, TanStack published a postmortem for an npm supply-chain compromise affecting TanStack Router and Start packages. The postmortem described 84 malicious versions across 42 packages. The attack combined a `pull_request_target` workflow pattern, cache poisoning across a fork and base repository boundary, and extraction of an OIDC token from the GitHub Actions runner process. The compromised versions were deprecated quickly, and TanStack later published hardening follow-up work.

The useful lesson for this article is the chain. A single weak boundary was not the whole story. The attacker needed a sequence:

```text
fork pull request code
  -> base repository workflow context
  -> poisoned dependency cache
  -> release workflow restore
  -> code execution on trusted runner
  -> OIDC token usable for npm publishing
  -> malicious package versions
```

Read that chain like a filesystem path. Each segment exists because the previous segment handed something to the next one. Fork code reached a workflow context. The workflow wrote a cache. The release workflow trusted the cache. The trusted runner had publishing identity available. The registry accepted that identity.

This is why threat modeling works best as a path exercise. If the review only asked whether OIDC was enabled, it would miss the cache. If it only asked whether the package publish step ran, it would miss code running elsewhere in the same trusted workflow. If it only asked whether npm tokens were stored as secrets, it would miss trusted publishing through OIDC.

The case also gives a healthy response pattern. The useful hardening was structural: remove or restrict dangerous workflow events, separate untrusted work from trusted publishing, pin third-party actions, reduce cache trust across boundaries, add ownership around sensitive workflow paths, and monitor publishes.

## Controls That Change the Story

A control is useful when it changes the scenario. It should break the chain, reduce the blast radius, or produce evidence early enough to matter.

| Scenario | Control that changes it | New result |
|----------|--------------------------|------------|
| Fork code runs in trusted context | Use `pull_request` for untrusted validation and avoid checking out fork code in `pull_request_target` | Fork code gets a lower-trust context. |
| Untrusted job writes cache for release | Separate cache scopes or disable cache writes across trust boundaries | Release job does not restore attacker-controlled cache. |
| Third-party action tag moves | Pin actions to full commit SHAs and review updates | Reviewed action content stays stable. |
| Any release code path can publish | Isolate publish identity to the narrow publish job and verify provenance | Unexpected code paths are easier to detect. |
| Workflow changes merge casually | CODEOWNERS and branch rules require platform/security review | Boundary changes get the right reviewers. |

Notice that several controls are boring. They are not new tools. They are careful boundaries, scoped identity, immutable references, and ownership. The point of the threat model is to place those controls where the delivery path actually needs them.

## Review Evidence

The best threat model leaves a small review artifact behind. It should be short enough that a future engineer will read it.

```text
Workflow: .github/workflows/release.yml
Reviewed path: fork PR -> release publish
Boundary: untrusted code must not reach publish identity
Scenario: PR code writes a dependency cache restored by release
Control: release job uses separate cache key and no PR-written cache scope
Evidence: cache restore key includes event name and trusted ref
Owner: platform-team
Next review: before changing release workflow permissions
```

The `Workflow` line names the file. `Reviewed path` names the normal path under review. `Boundary` names the rule the team wants to preserve. `Scenario` explains what could go wrong. `Control` explains what changes the outcome. `Evidence` tells the next reviewer where to check. `Owner` says who maintains the boundary.

This artifact is much more useful than a generic "CI reviewed" note. It lets a future reviewer ask whether the control still exists after the workflow changes.

## Putting It All Together

Threat modeling starts with the delivery path from the previous article. Draw one path, label the trust level at each step, and slow down wherever trust crosses a boundary. Then write scenarios with verbs: untrusted code runs, a cache is restored, a token is requested, an action tag changes, a package is published.

The TanStack case shows why this matters. The compromise moved across several handoffs before the malicious versions appeared in npm. Each handoff looked like an implementation detail until the whole chain was visible.

For `devpolaris-orders-api`, the practical habit is:

- Start with one delivery path.
- Name the boundary where trust changes.
- Write the attacker path as a short sequence.
- Choose controls that break the sequence.
- Leave evidence that future reviewers can read.

## What's Next

The next article focuses on the permission side of the same model. Once a threat model names which actor might reach which target, least privilege decides how narrow that actor's real access should be.

---

**References**

- [TanStack npm supply-chain compromise postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) - TanStack documents the May 2026 attack chain involving `pull_request_target`, cache poisoning, OIDC token extraction, and malicious npm publishes.
- [Hardening TanStack after the npm compromise](https://tanstack.com/blog/incident-followup) - TanStack describes follow-up hardening work after the compromise.
- [GitHub Actions secure use reference](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/using-githubs-security-features-to-secure-your-use-of-github-actions) - GitHub explains third-party action risk, token scope, and action pinning.
- [OWASP Threat Modeling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html) - OWASP provides a practical structure for threat modeling conversations.
