---
title: "Ansible in CI"
description: "Configure secure, automated Ansible execution pipelines within continuous integration runners."
overview: "Continuous integration pipelines act as automated control nodes. Securing these environments requires isolated credential management, host key verification, and clean execution logs."
tags: ["ansible", "ci", "automation", "security"]
order: 2
id: article-infrastructure-as-code-ansible-in-ci
aliases:
  - ansible-in-ci
  - infrastructure-as-code/ansible/ansible-in-ci.md
---

## Table of Contents

1. [The Runner as a Control Node](#the-runner-as-a-control-node)
2. [Pin the Runtime](#pin-the-runtime)
3. [Handle Inventory and Targets Deliberately](#handle-inventory-and-targets-deliberately)
4. [Manage Credentials and Host Keys](#manage-credentials-and-host-keys)
5. [Build the Pipeline Gates](#build-the-pipeline-gates)
6. [Keep Logs Useful and Safe](#keep-logs-useful-and-safe)
7. [Roll Out from CI](#roll-out-from-ci)
8. [Failure Reading and Recovery](#failure-reading-and-recovery)
9. [Putting It All Together](#putting-it-all-together)
10. [References](#references)

## The Runner as a Control Node
<!-- section-summary: A CI runner can run Ansible like any other control node, so it needs the same attention to tools, credentials, network access, and logs. -->

Running Ansible in CI means the pipeline runner acts as the control node. It checks out the repository, installs Ansible and collections, reads inventory, decrypts Vault content when allowed, connects to managed hosts, and stores the job output. That is powerful because deployments run as repeatable jobs instead of private terminal sessions.


![CI Runner Control Node](/content-assets/articles/article-infrastructure-as-code-ansible-in-ci/ci-runner-control-node.png)

*The CI runner map shows the pipeline acting as the Ansible control node, with a pinned image, bounded inventory, credentials, and managed hosts.*

The orders platform is a good example. A pull request changes an Nginx template and a systemd override. CI should run linting and syntax checks before merge. After approval, a deployment job should preview one production host, apply the canary, and then roll through the rest of `orders_web` in controlled batches.

The runner has to be treated like production infrastructure. Its Ansible version, Python version, collection versions, SSH configuration, Vault password source, network access, and host key data all affect the result. A job that works only because one runner image has an old collection cached is a deployment risk.

CI gives the team a clean place to encode the process. The pipeline can show which inventory it used, which limit it selected, which playbook ran, who approved the apply job, and which commit produced the deployment. That evidence is much stronger than a message saying someone ran a playbook from a laptop.

## Pin the Runtime
<!-- section-summary: CI should use pinned Ansible, collections, Python dependencies, and execution environments so automation behavior stays consistent between runs. -->

Start by pinning the runtime. At minimum, pin `ansible-core`, `ansible-lint`, Python dependencies, and Ansible collections. A playbook can change behavior when a module changes, a collection releases a new version, or a Python library dependency updates.

```bash
python -m pip install -r requirements.txt
ansible-galaxy collection install -r requirements.yml
```

The Python requirements might look like this:

```requirements.txt
ansible-core==2.19.1
ansible-lint==25.8.2
jmespath==1.0.1
```

The collection requirements can pin exact versions too:

```yaml
collections:
  - name: ansible.posix
    version: "==2.1.0"
  - name: community.general
    version: "==11.4.0"
```

For larger teams, an **execution environment** is often a better long-term shape. An execution environment is a container image that packages Ansible, collections, Python dependencies, and system packages needed by automation. The CI job runs Ansible inside that image, so the control node has a reproducible runtime.

```yaml
name: orders-ansible-ee
dependencies:
  galaxy: requirements.yml
  python: requirements.txt
  system: bindep.txt
```

This pattern lines up with Red Hat Ansible Automation Platform as well. Automation Platform uses execution environments to run jobs with defined automation dependencies. Even when a team uses a plain CI system rather than Automation Platform, the same idea applies: define the runner environment instead of inheriting it by accident.

## Handle Inventory and Targets Deliberately
<!-- section-summary: CI deployment jobs should make the inventory, playbook, and limit visible before any production change happens. -->

Target selection deserves its own gate. A production job should show the inventory, playbook, and limit before the apply step. If the job is about to touch `inventories/prod` and the whole `orders_web` group, everyone approving the job should see that clearly.

Start with a visible inventory graph:

```bash
ansible-inventory -i inventories/prod --graph orders_web
```

Then run a preview against the selected limit:

```bash
ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit "$ANSIBLE_LIMIT" \
  --check \
  --diff \
  --vault-id prod@"$VAULT_PASS_FILE"
```

Make `ANSIBLE_LIMIT` an explicit job input. For the first production run, require a single host such as `orders-web-01`. For later batch runs, allow a reviewed group expression such as `orders_web:!orders-web-01`. The job log should record the exact string.

An assertion inside the playbook can enforce the same rule from the Ansible side:

```yaml
- name: Require an explicit production limit
  ansible.builtin.assert:
    that:
      - ansible_limit is defined
      - ansible_limit | length > 0
    fail_msg: "Production deployments require --limit in CI"
```

That guardrail protects against a misconfigured pipeline variable. It also helps local operators, because the playbook carries the production rule instead of relying only on CI configuration.

## Manage Credentials and Host Keys
<!-- section-summary: CI needs scoped credentials, temporary secret files, strict file permissions, and intentional SSH host key verification. -->

CI usually needs several credentials: SSH private keys, Vault passwords, become passwords, cloud tokens, API credentials, or automation platform tokens. Store those values in the CI secret store or an external secret manager. Write them to temporary files only when tools require files, restrict permissions, and delete them when the job exits.

For SSH private keys, a temporary key file is simple and predictable:

```bash
set +x
install -m 0700 -d "$RUNNER_TEMP/ansible-secrets"
install -m 0600 /dev/null "$RUNNER_TEMP/ansible-secrets/deploy_key"
printf '%s\n' "$ANSIBLE_SSH_PRIVATE_KEY" > "$RUNNER_TEMP/ansible-secrets/deploy_key"
trap 'rm -rf "$RUNNER_TEMP/ansible-secrets"' EXIT
```

Point Ansible or SSH at that key through inventory variables, an SSH config file, or `ANSIBLE_PRIVATE_KEY_FILE`. Keep the choice consistent across the project so people know where to look when authentication fails.

```bash
export ANSIBLE_PRIVATE_KEY_FILE="$RUNNER_TEMP/ansible-secrets/deploy_key"
```

Vault password handling follows the same pattern:

```bash
install -m 0600 /dev/null "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
printf '%s\n' "$ANSIBLE_PROD_VAULT_PASSWORD" > "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
export VAULT_PASS_FILE="$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
```

SSH host key verification should be deliberate. Disabling host key checking may make a job pass quickly, but it removes protection against connecting to the wrong machine. A better pattern is to provide a reviewed `known_hosts` file or generate one from trusted infrastructure data before the run.

```bash
install -m 0600 ci/known_hosts "$RUNNER_TEMP/known_hosts"
export ANSIBLE_SSH_COMMON_ARGS="-o UserKnownHostsFile=$RUNNER_TEMP/known_hosts -o StrictHostKeyChecking=yes"
```

When a host key mismatch appears, stop and investigate. It can mean a rebuilt host, stale DNS, stale inventory, or a security problem. Updating `known_hosts` should be a reviewed infrastructure action, not a panic line added to make the pipeline green.

## Build the Pipeline Gates
<!-- section-summary: A strong pipeline separates static checks, preview, approval, canary apply, and full rollout instead of hiding everything in one deploy button. -->

A reliable CI deployment pipeline is staged. Each stage answers a different question. Static checks ask whether the content is well-formed. Preview asks what one target would change. Approval asks whether a human accepts the evidence. Apply asks Ansible to make the change. Verification asks whether the service is healthy after the change.


![Pipeline Gate Map](/content-assets/articles/article-infrastructure-as-code-ansible-in-ci/pipeline-gate-map.png)

*The gate map shows lint, syntax-check, check plus diff, approval, limited apply, and log scrubbing before production changes widen.*

Here is a generic CI shape for the orders platform:

```yaml
stages:
  - validate
  - preview
  - deploy_canary
  - deploy_remaining

validate:
  stage: validate
  script:
    - ansible-lint .
    - ansible-playbook -i inventories/prod orders.yml --syntax-check --vault-id prod@"$VAULT_PASS_FILE"

preview_orders:
  stage: preview
  script:
    - ansible-inventory -i inventories/prod --graph orders_web
    - ansible-playbook -i inventories/prod orders.yml --limit "$ANSIBLE_LIMIT" --check --diff --vault-id prod@"$VAULT_PASS_FILE"

deploy_canary:
  stage: deploy_canary
  when: manual
  script:
    - ansible-playbook -i inventories/prod orders.yml --limit orders-web-01 --vault-id prod@"$VAULT_PASS_FILE"

deploy_remaining:
  stage: deploy_remaining
  when: manual
  script:
    - ansible-playbook -i inventories/prod orders.yml --limit 'orders_web:!orders-web-01' --vault-id prod@"$VAULT_PASS_FILE"
```

The exact syntax changes across CI systems, but the gates are the important part. Validation runs on every pull request. Preview records evidence. Manual approval sits between preview and apply. Canary apply proves one host. Remaining rollout uses the playbook's `serial` and health checks.

For GitHub Actions, the same shape can use environments for approval and protected secrets:

```yaml
jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ansible-playbook -i inventories/prod orders.yml --limit orders-web-01 --check --diff --vault-id prod@"$VAULT_PASS_FILE"

  deploy-canary:
    needs: preview
    environment: production
    concurrency: orders-production
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ansible-playbook -i inventories/prod orders.yml --limit orders-web-01 --vault-id prod@"$VAULT_PASS_FILE"
```

The `environment: production` line can connect the job to protected environment approval and environment-scoped secrets. The `concurrency` line prevents two production orders deployments from running at the same time. If the job also needs cloud credentials, OIDC-based short-lived credentials are usually safer than long-lived cloud keys stored as repository secrets.

The CI vendor is secondary here. Ansible needs the same careful controls every time: pinned runtime, explicit target, secret setup, preview, approval, apply, concurrency control, and verification.

## Keep Logs Useful and Safe
<!-- section-summary: CI logs should show target choices, changed tasks, safe diffs, and health evidence while keeping secrets out of command output and artifacts. -->

Logs are part of the deployment record. They should show the commit, inventory, limit, playbook, check output, safe diffs, changed task summary, and health checks. That information helps reviewers and incident responders understand what happened.

Logs should leave out Vault passwords, rendered secret files, private keys, tokens, and raw environment dumps. Use `set +x` around secret setup, avoid `env` dumps in production jobs, and keep secret-bearing Ansible tasks marked with `no_log: true` and `diff: false`.

Ansible can include module arguments in output through configuration settings such as `display_args_to_stdout`. That can help distinguish similar tasks, but it should be reviewed carefully in projects that pass sensitive variables. More descriptive output is useful only when it stays within the project's secret boundaries.

Artifacts need the same review. Saving the full workspace after a failed job can capture temporary secret files, rendered configs, SSH keys, Vault password files, or `.retry` files. If a job stores artifacts, explicitly choose safe files such as lint reports, syntax-check output, or redacted deployment summaries.

For secret-bearing failures, prefer a short safe error message plus a link to rerun instructions. The person debugging the issue can rerun with the right access in a controlled environment. The shared CI log needs to stay free of production secret values.

## Roll Out from CI
<!-- section-summary: CI rollouts should use the same canary, serial, health check, and rollback controls as a careful human operator. -->

Once the pipeline is ready, the deployment should still look like a normal safe Ansible rollout. CI is the control node, and the playbook should keep using `--limit`, `serial`, health checks, delegated load balancer operations, and clear failure thresholds.

For the first production apply:

```bash
ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders-web-01 \
  --vault-id prod@"$VAULT_PASS_FILE"
```

For the remaining hosts:

```bash
ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit 'orders_web:!orders-web-01' \
  --vault-id prod@"$VAULT_PASS_FILE"
```

The playbook should own the host-by-host safety:

```yaml
- name: Roll orders web from CI
  hosts: orders_web
  become: true
  serial: 2
  any_errors_fatal: true
  tasks:
    - name: Render orders Nginx site
      ansible.builtin.template:
        src: orders-nginx.conf.j2
        dest: /etc/nginx/conf.d/orders.conf
      notify: Reload nginx

    - name: Validate Nginx config
      ansible.builtin.command:
        cmd: nginx -t
      register: nginx_validate
      changed_when: false
      failed_when: nginx_validate.rc != 0

    - name: Flush reload before health check
      ansible.builtin.meta: flush_handlers

    - name: Check orders health
      ansible.builtin.uri:
        url: "http://127.0.0.1:8080/health"
        status_code: 200
        return_content: false
      changed_when: false

  handlers:
    - name: Reload nginx
      ansible.builtin.service:
        name: nginx
        state: reloaded
```

A healthy CI pattern treats "the job exited 0" as only one signal. A job can succeed while an app is unhealthy if the playbook lacks verification. Put the verification into the playbook so local runs, CI runs, and automation platform runs all share the same safety logic.

## Failure Reading and Recovery
<!-- section-summary: CI failure handling should identify whether the problem is the runner, credentials, inventory, playbook preview, remote host, or service health. -->

When an Ansible CI job fails, first locate the boundary. A failure during dependency installation points at the runner image or package indexes. A Vault decryption error points at secret setup or the wrong Vault ID. An SSH unreachable error points at network access, host keys, inventory, or the deploy key. A task failure after connection usually points at the remote host or playbook logic.

Keep recovery commands narrow. If the canary failed, rerun or roll back the canary before touching the rest of the group. If the remaining rollout failed on `orders-web-04`, use `--limit orders-web-04` or the failed batch while you investigate. CI makes reruns easy, so the pipeline needs guardrails that keep reruns scoped.

For config rollback, revert the change and rerun against the affected target:

```bash
git revert <change-commit>

ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders-web-04 \
  --vault-id prod@"$VAULT_PASS_FILE"
```

For credential exposure, treat the CI log or artifact as part of the incident. Rotate the exposed secret, remove or restrict the artifact if possible, and fix the playbook or pipeline boundary that printed it. A later successful run leaves the old log behind, so the exposure still needs cleanup.

For host key mismatches, avoid automatically deleting known-host entries. Check whether the host was rebuilt, whether DNS points somewhere unexpected, and whether inventory has the right address. After the infrastructure state is confirmed, update the managed `known_hosts` source through review.

## Putting It All Together
<!-- section-summary: A production-ready Ansible CI pipeline uses a pinned control node, scoped secrets, host key verification, preview, approval, canary apply, and serial rollout. -->

The complete orders CI story is straightforward when each part has a job. The runtime is pinned through requirements or an execution environment. Secrets come from the CI secret store and live only in temporary files during the job. SSH host keys are verified through a managed `known_hosts` file. Validation and preview run before approval. Apply starts with one host, then the playbook rolls the rest in batches.


![CI Summary](/content-assets/articles/article-infrastructure-as-code-ansible-in-ci/ci-summary.png)

*The summary turns Ansible in CI into five guardrails: pin runtime, bound inventory, use a secret store, gate apply, and roll out.*

```bash
set +x
install -m 0700 -d "$RUNNER_TEMP/ansible-secrets"
install -m 0600 /dev/null "$RUNNER_TEMP/ansible-secrets/deploy_key"
install -m 0600 /dev/null "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
printf '%s\n' "$ANSIBLE_SSH_PRIVATE_KEY" > "$RUNNER_TEMP/ansible-secrets/deploy_key"
printf '%s\n' "$ANSIBLE_PROD_VAULT_PASSWORD" > "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
trap 'rm -rf "$RUNNER_TEMP/ansible-secrets"' EXIT

export ANSIBLE_PRIVATE_KEY_FILE="$RUNNER_TEMP/ansible-secrets/deploy_key"
export VAULT_PASS_FILE="$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
export ANSIBLE_SSH_COMMON_ARGS="-o UserKnownHostsFile=$RUNNER_TEMP/known_hosts -o StrictHostKeyChecking=yes"

ansible-lint .
ansible-playbook -i inventories/prod orders.yml --syntax-check --vault-id prod@"$VAULT_PASS_FILE"
ansible-playbook -i inventories/prod orders.yml --limit orders-web-01 --check --diff --vault-id prod@"$VAULT_PASS_FILE"
ansible-playbook -i inventories/prod orders.yml --limit orders-web-01 --vault-id prod@"$VAULT_PASS_FILE"
```

The deployment record now tells a clear story. It shows the commit, the pinned runtime, the target inventory, the canary limit, the preview, the approval, and the real apply. If something fails, the team knows whether to inspect the runner, credentials, target selection, remote host, or service health.

That is the main shift when Ansible moves into CI. The pipeline acts as the repeatable control node and the written deployment process for the team. The command matters, and the gates around the command matter just as much.

---

**References**

- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official command reference for playbook execution, inventory, limits, check mode, diff mode, and Vault options.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Documents preview behavior used in CI review gates.
- [Using encrypted variables and files](https://docs.ansible.com/projects/ansible/latest/vault_guide/vault_using_encrypted_content.html) - Covers Vault password files, prompts, and Vault IDs for non-interactive runs.
- [Logging Ansible output](https://docs.ansible.com/projects/ansible/latest/reference_appendices/logging.html) - Documents Ansible output logging settings and the need to protect sensitive output with `no_log`.
- [Controlling playbook execution: strategies and more](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_strategies.html) - Covers `serial`, `throttle`, `run_once`, and execution behavior used by CI rollouts.
- [Ansible Lint Documentation](https://docs.ansible.com/projects/lint/) - Official Ansible linting documentation for checking playbooks, roles, and collections in CI.
- [Creating and using execution environments](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6/html/creating_and_using_execution_environments/index) - Red Hat Ansible Automation Platform documentation for defining and using execution environments.
