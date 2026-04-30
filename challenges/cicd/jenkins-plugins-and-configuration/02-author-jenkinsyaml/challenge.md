---
title: "Author a CasC jenkins.yaml"
sectionSlug: anatomy-of-jenkinsyaml
order: 2
---

The polaris team is replacing UI-driven controller config with Configuration as Code. The starting `jenkins.yaml` only sets the system message. Your job is to add the four blocks that codify the rest of the controller's identity:

1. **Add the `jenkins.numExecutors` field** at the top of the `jenkins:` mapping with value `0` so the controller does not run builds itself.
2. **Add `jenkins.mode: EXCLUSIVE`** so labeled builds only land on labeled agents.
3. **Add a `jenkins.securityRealm.local`** with `allowsSignup: false` and a single user named `polaris-admin` with password `${POLARIS_ADMIN_PASSWORD}`. (The actual password resolves from an env var at boot.)
4. **Add a `jenkins.authorizationStrategy.roleBased`** with one global role `admin` granting permission `Overall/Administer` to user `polaris-admin`.

Keep the existing `jenkins.systemMessage` field. The grader checks the YAML structure (paths and types), not formatting.
