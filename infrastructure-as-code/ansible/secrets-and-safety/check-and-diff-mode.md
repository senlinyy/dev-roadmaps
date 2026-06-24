---
title: "Dry Runs and Diff Mode"
description: "Use Ansible check mode and diff mode as review evidence while knowing which predictions can be incomplete."
overview: "Check mode and diff mode help teams inspect planned Ansible changes before they touch hosts, while still treating preview output as evidence rather than certainty."
tags: ["ansible", "check-mode", "diff"]
order: 3
id: article-infrastructure-as-code-ansible-check-diff-mode
aliases:
  - check-diff-mode
  - infrastructure-as-code/ansible/check-and-diff-mode.md
---

## Table of Contents

1. [Preview as Deployment Evidence](#preview-as-deployment-evidence)
2. [Check Mode](#check-mode)
3. [Diff Mode](#diff-mode)
4. [Module Support Limits](#module-support-limits)
5. [Writing Preview-Friendly Tasks](#writing-preview-friendly-tasks)
6. [Using Preview in Review and CI](#using-preview-in-review-and-ci)
7. [Verification, Rollback, and Failure Reading](#verification-rollback-and-failure-reading)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)
10. [References](#references)

## Preview as Deployment Evidence
<!-- section-summary: Check mode and diff mode give reviewers useful evidence about a likely change before the first production host changes. -->

After Vault and output boundaries, the next safety question is simple: what will this playbook change? Ansible gives you two preview tools for that question. **Check mode** asks supported tasks to predict changes without applying them. **Diff mode** asks supported tasks to show before-and-after details.

Let's keep using the production orders platform. A pull request changes the Nginx timeout for `/checkout`, updates `/etc/orders/orders.env`, and adds a systemd drop-in for worker memory limits. Before the team touches production, reviewers want to see the target host, the tasks that would change, and the file diffs that are safe to show.

The first preview command might run against one canary host:

```bash
ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders-web-01 \
  --check \
  --diff \
  --vault-id prod@prompt
```

Treat the output as **deployment evidence**. It is stronger than a guess because it comes from the current playbook and current host state. It is still a preview, so it needs a real canary, health checks, and a rollback path before the team calls the deployment safe.

That attitude keeps people honest. Preview output can catch obvious mistakes, such as a wrong file path or an unexpected template change. Commands, external API calls, package upgrades, handlers, and runtime side effects still need canary evidence.

## Check Mode
<!-- section-summary: Check mode runs a playbook in prediction mode for modules that can describe their changes without applying them. -->

Check mode runs with `--check` or `-C`. In this mode, Ansible asks modules to report what they would change while avoiding the actual change where the module supports that behavior.

```bash
ansible-playbook -i inventories/prod orders.yml --limit orders-web-01 --check
```

File-oriented modules often give useful check-mode output. A template task can render the candidate content locally, compare it with the remote file, and report `changed` when the rendered content differs. A package task may be able to report whether a package would be installed or updated, depending on the platform and module.

Here is a normal config task for the orders API:

```yaml
- name: Render orders Nginx site
  ansible.builtin.template:
    src: orders-nginx.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
    owner: root
    group: root
    mode: "0644"
  notify: Reload nginx
```

In check mode, this task can usually say whether `/etc/nginx/conf.d/orders.conf` would change. With diff mode added, it can show the exact safe text change, such as `proxy_read_timeout` moving from `30s` to `45s`.

Some tasks need special check-mode behavior. Ansible exposes `ansible_check_mode`, a boolean that is true during a check-mode run. Use it when a task should skip a side effect during preview or when a task should explain why preview cannot run a particular operation.

```yaml
- name: Run orders database migration
  ansible.builtin.command:
    cmd: ordersctl migrate
  when: not ansible_check_mode
```

That skip is honest. A migration changes database state, and the preview should record that limitation clearly. The rollout plan should say when the migration will run for real.

## Diff Mode
<!-- section-summary: Diff mode shows before-and-after content for supported tasks, which is useful for review and dangerous for secret-bearing files. -->

Diff mode runs with `--diff`. It can run by itself during a real run, or together with `--check` during a preview. The most common production use is `--check --diff`, because it gives reviewers likely changes and safe file diffs before the canary.

```bash
ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders-web-01 \
  --check \
  --diff
```

Diff mode is excellent for readable configuration. If a template changes an Nginx timeout, a systemd unit, a log level, or a managed block in a config file, reviewers can see the exact text. This is much more useful than seeing only a count of changed tasks.

Diff mode needs boundaries around secrets. The orders environment file contains database credentials and webhook secrets, so its task should opt out of diff output and mask the task result.

```yaml
- name: Render orders secret environment file
  ansible.builtin.template:
    src: orders.env.j2
    dest: /etc/orders/orders.env
    owner: root
    group: orders
    mode: "0640"
  diff: false
  no_log: true
  notify: Restart orders app
```

This lets the team keep `--diff` turned on for the playbook while hiding the one file that should stay quiet. That is usually better than turning off diff mode globally and losing review evidence for safe config changes.

For generated files that contain a mix of secret and non-secret values, split the templates when you can. Put public app settings in one file and secret values in another restricted file. The public file can produce helpful diffs, and the secret file can stay hidden.

## Module Support Limits
<!-- section-summary: Preview quality depends on module behavior, remote state, registered variables, conditionals, and commands that Ansible cannot safely predict. -->

Check mode and diff mode depend on the module. Some modules support both well. Some modules support check mode but produce limited detail. Some modules skip work because prediction would be unsafe or unreliable. Command and shell tasks are the classic example because Ansible sees only the executable and arguments.

This task gives Ansible very little to predict:

```yaml
- name: Restart orders workers through custom script
  ansible.builtin.command:
    cmd: /usr/local/bin/orders-worker-restart
```

The command might restart a service, edit files, call an API, or do nothing. Ansible sees the command line, not the program's internal plan. If this task matters, wrap it in clearer Ansible modules where possible or make the command support its own safe validation flag.

Registered variables can also affect preview. A task may register a result, and a later task may use that result in a condition. In check mode, the earlier task may skip or return different data, so the later condition can behave differently from a real run.

```yaml
- name: Check current orders schema version
  ansible.builtin.command:
    cmd: ordersctl schema-version
  register: orders_schema
  changed_when: false
  check_mode: false

- name: Run orders migration when schema is old
  ansible.builtin.command:
    cmd: ordersctl migrate
  when:
    - not ansible_check_mode
    - orders_schema.stdout is version("2026.06", "<")
```

Notice the careful split. The read-only schema check can run even during check mode because `check_mode: false` tells Ansible to execute it normally. The migration still skips during check mode because it changes database state. The preview now has enough information to explain what would happen, while the dangerous action waits for the real rollout.

Package modules, cloud modules, and external API modules can also have preview gaps. A package repository may change between preview and apply. A cloud API may validate differently when a request is actually submitted. Preview gives review evidence, and the canary proves the real behavior on one target.

| Task type | Preview quality | What to check |
|---|---|---|
| `template`, `copy`, `file` | Usually strong | Diff, mode, owner, and secret boundaries |
| `lineinfile`, `blockinfile` | Usually strong for text edits | Regex scope and parser validation |
| `package` | Depends on package manager and repo state | Version pin and repository freshness |
| `command`, `shell` | Weak unless guarded | `creates`, `removes`, `changed_when`, and safe dry-run flags |
| Cloud or API modules | Varies by module and service | Module docs, canary resource, and rollback path |

## Writing Preview-Friendly Tasks
<!-- section-summary: Preview-friendly playbooks use idempotent modules, explicit changed_when and failed_when rules, safe assertions, and narrow check-mode overrides. -->

A playbook previews well when tasks describe desired state. Modules like `template`, `copy`, `file`, `service`, `package`, `lineinfile`, and `blockinfile` give Ansible structured intent. That structure helps Ansible decide whether a change is needed and whether a diff can be shown.

For command and shell tasks, define success and change carefully. A command that returns `0` and prints "already configured" should report unchanged when the system already matches the target state. A command that returns a special code for "needs change" should use `changed_when` and `failed_when` so the preview and the real run tell a clear story.

```yaml
- name: Validate orders Nginx config
  ansible.builtin.command:
    cmd: nginx -t
  register: nginx_validate
  changed_when: false
  failed_when: nginx_validate.rc != 0
```

Assertions make preview output more useful because they can fail early with a safe message. For example, a production deployment can assert that the operator selected a limit. This prevents a preview or real run from accidentally targeting every host when the process requires a canary first.

```yaml
- name: Require an explicit production limit
  ansible.builtin.assert:
    that:
      - ansible_limit is defined
      - ansible_limit | length > 0
    fail_msg: "Production orders deployments require --limit for the first run"
```

Use `check_mode: false` sparingly. It tells a task to run during check mode, so it should be reserved for read-only checks or safe discovery tasks. A task that creates tickets, changes load balancer membership, rotates credentials, or writes database state should skip during preview or provide a separate dry-run command.

Use `check_mode: true` when you want a task to act like a prediction task even during a normal run. This can be helpful for a validation step that only reports potential change and never applies it. In most production playbooks, clear normal tasks plus `--check` are easier for beginners to understand.

## Using Preview in Review and CI
<!-- section-summary: CI preview should show target selection, syntax, lint, check-mode output, safe diffs, and an approval boundary before apply. -->

CI is a good place to make preview repeatable. A pull request can run syntax checks and linting. A protected deployment job can run `--check --diff` against a canary host, store the safe output, and require approval before the real apply.

A simple review sequence for the orders platform can look like this:

```bash
ansible-playbook -i inventories/prod orders.yml --syntax-check --vault-id prod@prompt
ansible-inventory -i inventories/prod --graph orders_web
ansible-playbook -i inventories/prod orders.yml --limit orders-web-01 --check --diff --vault-id prod@prompt
```

The syntax check catches parse problems. The inventory graph shows the target group. The check-and-diff run shows likely host changes. Together, they give a reviewer concrete evidence before a production canary.

In CI, the same flow should make the selected inventory, playbook, and limit visible. Hiding target selection inside a script makes review weaker. A deployment record should show whether the job pointed at `inventories/staging`, `inventories/prod`, one canary host, or a whole group.

```yaml
preview_orders_prod:
  stage: preview
  script:
    - ansible-playbook -i inventories/prod orders.yml --syntax-check --vault-id prod@"$VAULT_PASS_FILE"
    - ansible-inventory -i inventories/prod --graph orders_web
    - ansible-playbook -i inventories/prod orders.yml --limit "$ANSIBLE_LIMIT" --check --diff --vault-id prod@"$VAULT_PASS_FILE"
```

Secret-bearing tasks still need `no_log: true` and `diff: false`. CI logs last longer than terminal output, so safe diffs matter even more in the pipeline. The best preview job shows ordinary config diffs and censors secret files by design.

## Verification, Rollback, and Failure Reading
<!-- section-summary: Preview output should lead into a real canary, health checks, rollback commands, and clear interpretation of skipped or changed tasks. -->

Read preview output like a deployment rehearsal. A `changed=0` preview can mean the host already matches the desired state. It can also mean a task skipped because the module has limited check-mode support. Look at skipped tasks and warnings before trusting the recap.

A preview failure is useful. A missing variable, missing template, undefined host group, syntax issue, or failed assertion should stop the process before a host changes. Fix the playbook or inventory, then rerun the same preview command so the evidence stays comparable.

After preview passes, run a real canary and verify behavior:

```bash
ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders-web-01 \
  --vault-id prod@prompt
```

Rollback should be written before apply. For a template change, rollback may be reverting the commit and rerunning the playbook against the same limit. For a package change, rollback may mean pinning the previous package version and rerunning the role. For a database migration, rollback may require an application-specific restore or forward-fix plan because check mode gives little evidence about database reversibility.

Separate validation from change so common failures have clear causes. If `nginx -t` fails, the rendered config is invalid. If a health check fails after a handler flush, the service started with bad behavior or cannot reach a dependency. If check mode skips a command, the preview has a known blind spot and the canary must cover it.

## Putting It All Together
<!-- section-summary: A good preview workflow combines check mode, diff mode, secret boundaries, safe validations, and a canary that proves the prediction. -->

Here is a compact orders deployment flow that uses preview as evidence and then applies safely:

```bash
ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --syntax-check \
  --vault-id prod@prompt

ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders-web-01 \
  --check \
  --diff \
  --vault-id prod@prompt

ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders-web-01 \
  --vault-id prod@prompt
```

The playbook supports that flow by using structured modules, safe diffs for readable files, censored secret tasks, explicit validation commands, and assertions for deployment guardrails. Preview output tells the reviewer what is likely to change. The canary tells the team what actually happened.

This is the right level of trust for dry runs. Use them every time for production changes, keep their limitations visible, and let them feed the next safety layer: rollout scope.

## What's Next

Preview answers "what might change?" The next question is "how many hosts should change right now?" The next article uses `--limit`, `serial`, health checks, and failure thresholds to keep the first real change inside a deliberate boundary.

---

**References**

- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official Ansible guide for `--check`, `--diff`, `check_mode`, and `ansible_check_mode`.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Command reference for playbook execution flags including check mode, diff mode, inventory, limit, and Vault options.
- [ansible.builtin.assert module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/assert_module.html) - Documents assertion tasks for safe deployment guardrails.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Covers `failed_when`, `changed_when`, and failure behavior used to make preview output clearer.
- [Logging Ansible output](https://docs.ansible.com/projects/ansible/latest/reference_appendices/logging.html) - Explains Ansible output logging and why secret output needs care in CI logs.
