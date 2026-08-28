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

1. [What Can a Preview Actually Prove?](#what-can-a-preview-actually-prove)
2. [How Does Check Mode Predict Change?](#how-does-check-mode-predict-change)
3. [What Does Diff Mode Add?](#what-does-diff-mode-add)
4. [Why Do Module Support Limits Matter?](#why-do-module-support-limits-matter)
5. [What Makes a Task Preview-Friendly?](#what-makes-a-task-preview-friendly)
6. [How Should Review and CI Use Preview?](#how-should-review-and-ci-use-preview)
7. [How Do You Read Preview and Plan Rollback?](#how-do-you-read-preview-and-plan-rollback)
8. [What Is a Reliable Preview Workflow?](#what-is-a-reliable-preview-workflow)
9. [Check Your Answers](#check-your-answers)

After Vault and output boundaries, the next safety question is simple: what will this playbook change? Ansible gives you two preview tools for that question. **Check mode** asks supported tasks to predict changes without applying them. **Diff mode** asks supported tasks to show before-and-after details.

![Check Diff Preview Map](/content-assets/articles/article-infrastructure-as-code-ansible-check-diff-mode/check-diff-preview-map.png)

*The preview map separates check mode predictions, diff output, unsupported-module limits, and review evidence.*

Let's keep using the production application platform. A pull request changes an Nginx timeout, updates `/etc/application/application.env`, and adds a systemd drop-in for worker memory limits. Before the team touches production, reviewers want to see the target host, the tasks that would change, and the file diffs that are safe to show.

The first preview command might run against one canary host:

```bash
ansible-playbook \
  -i inventories/prod \
  application.yml \
  --limit application-web-01 \
  --check \
  --diff \
  --vault-id prod@prompt
```

Treat the output as **deployment evidence**. It is stronger than a guess because it comes from the current playbook and current host state. It is still a preview, so it needs a real canary, health checks, and a rollback path before the team calls the deployment safe.

Keep these questions in view as you work through the lesson:

1. **What Can a Preview Actually Prove?**
2. **How Does Check Mode Predict Change?**
3. **What Does Diff Mode Add?**
4. **Why Do Module Support Limits Matter?**
5. **What Makes a Task Preview-Friendly?**
6. **How Should Review and CI Use Preview?**
7. **How Do You Read Preview and Plan Rollback?**
8. **What Is a Reliable Preview Workflow?**

## What Can a Preview Actually Prove?
<!-- section-summary: Check mode and diff mode give reviewers useful evidence about a likely change before the first production host changes. -->

A preview-first approach keeps the team honest about what the evidence proves. Preview output can catch obvious mistakes, such as a wrong file path or an unexpected template change. Commands, external API calls, package upgrades, handlers, and runtime side effects still need canary evidence.

The fundamental distinction is between **prediction** and **execution**. A normal task observes state, decides whether change is needed, mutates when necessary, and reports the result. Check mode removes or simulates the mutation step where the module knows how. Diff mode describes a candidate delta where the module can expose one safely.

Prediction requires knowledge. A template module understands both desired content and the current destination, so it can compare them. A generic command module sees only an executable and arguments; it cannot know whether the program will edit files, contact an API, or do nothing. Preview quality therefore comes from module semantics, not from the `--check` flag alone.

Check mode is not a virtual machine, transaction, or sandbox. It does not execute all side effects against an isolated copy of the host and roll them back. It asks each task to participate in prediction. Unsupported work may skip, return incomplete data, or need an explicit observation path.

Distinguish three states in the output:

```text
predicted unchanged → supported task expects no mutation
predicted changed   → supported task expects mutation
unknown or skipped  → preview lacks evidence for this task
```

The third state must not be interpreted as unchanged. A play recap with `changed=0` can still contain skipped commands that will mutate during the real run.

## How Does Check Mode Predict Change?
<!-- section-summary: Check mode runs a playbook in prediction mode for modules that can describe their changes without applying them. -->

Check mode runs with `--check` or `-C`. In this mode, Ansible asks modules to report what they would change while avoiding the actual change where the module supports that behavior.

```bash
ansible-playbook -i inventories/prod application.yml --limit application-web-01 --check
```

File-oriented modules often give useful check-mode output. A template task can render the candidate content locally, compare it with the remote file, and report `changed` when the rendered content differs. A package task may be able to report whether a package would be installed or updated, depending on the platform and module.

Here is a normal config task for the application API:

```yaml
- name: Render application Nginx site
  ansible.builtin.template:
    src: application-nginx.conf.j2
    dest: /etc/nginx/conf.d/application.conf
    owner: root
    group: root
    mode: "0644"
  notify: Reload nginx
```

In check mode, this task can usually say whether `/etc/nginx/conf.d/application.conf` would change. With diff mode added, it can show the exact safe text change, such as `proxy_read_timeout` moving from `30s` to `45s`.

Some tasks need special check-mode behavior. Ansible exposes `ansible_check_mode`, a boolean that is true during a check-mode run. Use it when a task should skip a side effect during preview or when a task should explain why preview cannot run a particular operation.

```yaml
- name: Run application database migration
  ansible.builtin.command:
    cmd: applicationctl migrate
  when: not ansible_check_mode
```

That skip is honest. A migration changes database state, and the preview should record that limitation clearly. The rollout plan should say when the migration will run for real.

Modules can provide full, partial, or no check-mode support. Full support normally compares desired and current state without mutation. Partial support may predict only some options or depend on external behavior. No support usually means the task skips or cannot provide a meaningful prediction. Review each module's capability metadata rather than assuming all modules behave like `template`.

Registered variables expose another prediction problem. If a task skips in check mode, its result may lack `stdout`, `rc`, or other fields that a later condition expects. The later branch can fail or choose a different path from a real run. Separate safe observation from mutation so later decisions still have the evidence they need.

Task-level `check_mode: false` forces a task to execute normally even during a check run. Reserve it for genuinely read-only discovery and validation. `check_mode: true` forces prediction behavior even in a normal run and can support a dedicated “would change?” probe. Both settings override the global mode for that task, so they deserve explicit names and review.

`ansible_check_mode` lets conditions and messages acknowledge preview state. Use it to skip an unavoidable side effect, select a safe dry-run option offered by an external tool, or assert that required evidence remains available. Avoid scattering it through every task; module-native check support is easier to reason about.

## What Does Diff Mode Add?
<!-- section-summary: Diff mode shows before-and-after content for supported tasks, which is useful for review and dangerous for secret-bearing files. -->

Diff mode runs with `--diff`. It can run by itself during a real run, or together with `--check` during a preview. The most common production use is `--check --diff`, because it gives reviewers likely changes and safe file diffs before the canary.

```bash
ansible-playbook \
  -i inventories/prod \
  application.yml \
  --limit application-web-01 \
  --check \
  --diff
```

Diff mode is excellent for readable configuration. If a template changes an Nginx timeout, a systemd unit, a log level, or a managed block in a config file, reviewers can see the exact text. This is much more useful than seeing only a count of changed tasks.

Diff mode needs boundaries around secrets. The application environment file contains database credentials and webhook secrets, so its task should opt out of diff output and mask the task result.

```yaml
- name: Render application secret environment file
  ansible.builtin.template:
    src: application.env.j2
    dest: /etc/application/application.env
    owner: root
    group: application
    mode: "0640"
  diff: false
  no_log: true
  notify: Restart application app
```

This lets the team keep `--diff` turned on for the playbook while hiding the one file that should stay quiet. That is usually better than turning off diff mode globally and losing review evidence for safe config changes.

For generated files that contain a mix of secret and non-secret values, split the templates when you can. Put public app settings in one file and secret values in another restricted file. The public file can produce helpful diffs, and the secret file can stay hidden.

Diff is an independent capability from check mode. A module may predict that it would change without producing a useful before-and-after representation. Another module may show a diff during a real mutation. Read the module's support rather than treating `--check --diff` as one indivisible guarantee.

Check plus diff is more useful than check alone because it answers both “would this task change?” and “what candidate state differs?” A `changed` result without content may still hide a wrong port, deleted block, or broad regex match. The safe diff turns that status into reviewable evidence.

Diff output can be dangerous even when the source secret is encrypted. Once a template renders, the candidate and current content are plaintext. CI logs, callback plugins, job artifacts, terminal recording, and chat copies can retain those values. `diff: false` and `no_log: true` solve output problems that Vault does not.

For a mixed file, splitting secret material also improves change review. A public config can retain detailed diff evidence, while a small protected environment or credential file stays opaque. Reviewers then know an opaque file may change without losing visibility into unrelated settings.

## Why Do Module Support Limits Matter?
<!-- section-summary: Preview quality depends on module behavior, remote state, registered variables, conditionals, and commands that Ansible cannot safely predict. -->

Check mode and diff mode depend on the module. Some modules support both well. Some modules support check mode but produce limited detail. Some modules skip work because prediction would be unsafe or unreliable. Command and shell tasks are the classic example because Ansible sees only the executable and arguments.

This task gives Ansible very little to predict:

```yaml
- name: Restart application workers through custom script
  ansible.builtin.command:
    cmd: /usr/local/bin/application-worker-restart
```

The command might restart a service, edit files, call an API, or do nothing. Ansible sees the command line, not the program's internal plan. If this task matters, wrap it in clearer Ansible modules where possible or make the command support its own safe validation flag.

Registered variables can also affect preview. A task may register a result, and a later task may use that result in a condition. In check mode, the earlier task may skip or return different data, so the later condition can behave differently from a real run.

```yaml
- name: Check current application schema version
  ansible.builtin.command:
    cmd: applicationctl schema-version
  register: application_schema
  changed_when: false
  check_mode: false

- name: Run application migration when schema is old
  ansible.builtin.command:
    cmd: applicationctl migrate
  when:
    - not ansible_check_mode
    - application_schema.stdout is version("2026.06", "<")
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

A subtle false confidence appears when all preview-supported tasks pass while the one decisive task skips. For example, check mode can show a perfect config diff and skip the command that migrates shared data. The successful preview covers the file path; it says nothing about migration compatibility or reversibility.

Review module capabilities, not only the recap. Document which tasks offer full prediction, which observations are forced to run, which tasks deliberately skip, and which external tools provide their own dry-run flags. The deployment approver needs a map of blind spots, not a green job with unexplained `skipping` lines.

Repository and API state can change between preview and apply. A package solver may choose a newer artifact, a cloud resource may change, or another deployment may modify the same file. Keep the interval bounded, pin versions where possible, and preview against the same inventory and canary used for the real command.

Commands and shell weaken preview because `changed_when` only changes Ansible's report; it does not teach Ansible how to simulate the program. `creates` and `removes` can provide coarse guards, and a tool's native `--dry-run` may provide better evidence. When a purpose-built Ansible module exists, its structured desired-state contract is usually stronger.

## What Makes a Task Preview-Friendly?
<!-- section-summary: Preview-friendly playbooks use idempotent modules, explicit changed_when and failed_when rules, safe assertions, and narrow check-mode overrides. -->

A playbook previews well when tasks describe desired state. Modules like `template`, `copy`, `file`, `service`, `package`, `lineinfile`, and `blockinfile` give Ansible structured intent. That structure helps Ansible decide whether a change is needed and whether a diff can be shown.


![Preview Friendly Task Flow](/content-assets/articles/article-infrastructure-as-code-ansible-check-diff-mode/preview-friendly-task-flow.png)

*The task flow shows how state modules, truthful changed_when, validation, safe diffs, and CI artifacts make previews more useful.*

For command and shell tasks, define success and change carefully. A command that returns `0` and prints "already configured" should report unchanged when the system already matches the target state. A command that returns a special code for "needs change" should use `changed_when` and `failed_when` so the preview and the real run tell a clear story.

```yaml
- name: Validate application Nginx config
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
    fail_msg: "Production application deployments require --limit for the first run"
```

Use `check_mode: false` sparingly. It tells a task to run during check mode, so it should be reserved for read-only checks or safe discovery tasks. A task that creates tickets, changes load balancer membership, rotates credentials, or writes database state should skip during preview or provide a separate dry-run command.

Use `check_mode: true` when you want a task to act like a prediction task even during a normal run. This can be helpful for a validation step that only reports potential change and never applies it. In most production playbooks, clear normal tasks plus `--check` are easier for beginners to understand.

Preview-friendly tasks have deterministic desired state. Stable inputs let a module render the same candidate twice and compare it meaningfully. Timestamps, random values, unordered generated data, or environment-dependent commands make every preview look changed and reduce the signal reviewers need.

Idempotence and previewability are closely related because both require a way to compare current and desired state. They are not identical: a task can be idempotent at runtime but lack a safe simulation, and a task can predict a change but still fail during real mutation. Treat each as separate evidence.

Separate observation from mutation. A read-only schema query can run during check mode and register a version. A later migration task can state that it will not run until apply. This preserves decision data without pretending the mutation is simulated.

Use module-native `validate` where available. A template or copy module can write candidate content to a temporary path and run a parser before replacement. That validation can work during preview and catches syntax errors without activating the candidate. It is stronger than writing a broken file and checking afterward.

`changed_when` makes result reporting truthful; it does not prevent side effects or create prediction support. A command with `changed_when: false` can still mutate the system. Similarly, `failed_when` defines how Ansible interprets the result, not whether the command was safe to execute during preview.

## How Should Review and CI Use Preview?
<!-- section-summary: CI preview should show target selection, syntax, lint, check-mode output, safe diffs, and an approval boundary before apply. -->

CI is a good place to make preview repeatable. A pull request can run syntax checks and linting. A protected deployment job can run `--check --diff` against a canary host, store the safe output, and require approval before the real apply.

A simple review sequence for the application platform can look like this:

```bash
ansible-playbook -i inventories/prod application.yml --syntax-check --vault-id prod@prompt
ansible-inventory -i inventories/prod --graph application_web
ansible-playbook -i inventories/prod application.yml --limit application-web-01 --check --diff --vault-id prod@prompt
```

The syntax check catches parse problems. The inventory graph shows the target group. The check-and-diff run shows likely host changes. Together, they give a reviewer concrete evidence before a production canary.

In CI, the same flow should make the selected inventory, playbook, and limit visible. Hiding target selection inside a script makes review weaker. A deployment record should show whether the job pointed at `inventories/staging`, `inventories/prod`, one canary host, or a whole group.

```yaml
preview_application_prod:
  stage: preview
  script:
    - ansible-playbook -i inventories/prod application.yml --syntax-check --vault-id prod@"$VAULT_PASS_FILE"
    - ansible-inventory -i inventories/prod --graph application_web
    - ansible-playbook -i inventories/prod application.yml --limit "$ANSIBLE_LIMIT" --check --diff --vault-id prod@"$VAULT_PASS_FILE"
```

Secret-bearing tasks still need `no_log: true` and `diff: false`. CI logs last longer than terminal output, so safe diffs matter even more in the pipeline. The best preview job shows ordinary config diffs and censors secret files by design.

Review should cover the inventory source, selected host set, dependency versions, predicted changes, safe diffs, skipped tasks, warnings, and known unsupported operations. Store only sanitized evidence. A preview artifact that leaks credentials is not made safe by an approval gate.

Run syntax and static checks before contacting production. Then inspect inventory and list hosts, because a precise diff against the wrong environment is still dangerous. Use the same Vault IDs, execution environment, collection versions, and non-secret runtime inputs that apply will use.

Preview should be close enough to apply that remote state remains comparable, but it should remain a distinct approval step. The job record can link the reviewed preview to the commit, inventory, canary, limit, and dependency image used for the real run.

When a task is intentionally invisible—such as a secret template—make that boundary explicit in review. The approver should see that a protected file is expected to change, which inputs drive it, and how the canary verifies its consumer without seeing the plaintext delta.

## How Do You Read Preview and Plan Rollback?
<!-- section-summary: Preview output should lead into a real canary, health checks, rollback commands, and clear interpretation of skipped or changed tasks. -->

Read preview output like a deployment rehearsal. A `changed=0` preview can mean the host already matches the desired state. It can also mean a task skipped because the module has limited check-mode support. Look at skipped tasks and warnings before trusting the recap.

A preview failure is useful. A missing variable, missing template, undefined host group, syntax issue, or failed assertion should stop the process before a host changes. Fix the playbook or inventory, then rerun the same preview command so the evidence stays comparable.

After preview passes, run a real canary and verify behavior:

```bash
ansible-playbook \
  -i inventories/prod \
  application.yml \
  --limit application-web-01 \
  --vault-id prod@prompt
```

Rollback should be written before apply. For a template change, rollback may be reverting the commit and rerunning the playbook against the same limit. For a package change, rollback may mean pinning the previous package version and rerunning the role. For a database migration, rollback may require an application-specific restore or forward-fix plan because check mode gives little evidence about database reversibility.

Separate validation from change so common failures have clear causes. If `nginx -t` fails, the rendered config is invalid. If a health check fails after a handler flush, the service started with bad behavior or cannot reach a dependency. If check mode skips a command, the preview has a known blind spot and the canary must cover it.

## What Is a Reliable Preview Workflow?
<!-- section-summary: A good preview workflow combines check mode, diff mode, secret boundaries, safe validations, and a canary that proves the prediction. -->

Here is a compact application deployment flow that uses preview as evidence and then applies safely:


![Check Diff Summary](/content-assets/articles/article-infrastructure-as-code-ansible-check-diff-mode/check-diff-summary.png)

*The summary keeps preview work grounded: preview, read limits, review diffs, and apply carefully.*

```bash
ansible-playbook \
  -i inventories/prod \
  application.yml \
  --syntax-check \
  --vault-id prod@prompt

ansible-playbook \
  -i inventories/prod \
  application.yml \
  --limit application-web-01 \
  --check \
  --diff \
  --vault-id prod@prompt

ansible-playbook \
  -i inventories/prod \
  application.yml \
  --limit application-web-01 \
  --vault-id prod@prompt
```

The playbook supports that flow by using structured modules, safe diffs for readable files, censored secret tasks, explicit validation commands, and assertions for deployment guardrails. Preview output tells the reviewer what is likely to change. The canary tells the team what actually happened.

This is the right level of trust for dry runs. Use them every time for production changes, keep their limitations visible, and let them feed the next safety layer: rollout scope.

A useful confidence model is cumulative:

```text
module semantics
+ current host comparison
+ safe diff
+ explicit blind spots
+ validation
+ canary execution
+ service health
= deployment evidence
```

No single line turns prediction into certainty. Syntax check proves parsing. Inventory inspection proves targeting. Check mode proves supported predictions. Diff proves supported deltas. Validation proves candidate syntax. The canary proves real mutation on one target. Health checks prove selected behavior after mutation.

The practical evidence hierarchy moves from cheaper to stronger checks: parse, lint, inspect inventory, list hosts, check, diff, validate, apply to a canary, verify service behavior, then widen. A failure at an early step should stop the later, more expensive and risky steps.

A particularly dangerous preview is one that changes the decision path. Suppose a read-only command is skipped, so a registered result is empty and the migration condition becomes false. The preview reports no migration, but the real run executes the observation, discovers an old schema, and runs it. Force only the safe observation to execute during check mode, or make the preview state explicitly unknown rather than allowing missing data to masquerade as a negative decision.

Likewise, handlers may not provide the same evidence in preview as in apply. A template can predict `changed` and notify a restart, but the real restart, startup time, dependency access, and post-restart health remain unproved. Record that boundary in the deployment plan and ensure the canary flushes handlers before verification.

Preview evidence is strongest when repeated runs are deterministic. If the second check against an unchanged host still predicts the same file change, inspect unstable template inputs, ordering, newline behavior, timestamps, or non-idempotent generation. Noisy false changes train reviewers to ignore diffs, which makes the one dangerous delta easier to miss.

Preview answers “what might change?” The next question is “how many hosts should change right now?” The next article uses `--limit`, `serial`, health checks, and failure thresholds to keep the first real change inside a deliberate boundary.

A review can annotate preview coverage task by task: fully predicted, partially predicted, observation forced, deliberately skipped, or opaque external effect. This small coverage map prevents the visually largest diff from overshadowing a skipped high-risk operation. It also tells the canary which blind spots it must exercise.

If preview and apply are separate jobs, preserve their common inputs. Use the same commit, inventory snapshot where appropriate, execution image, dependency lock, variables, and limit. When any of those change, the earlier preview is evidence for a different execution and should be regenerated before approval.

Preview can also affect external systems when authors force tasks with `check_mode: false`. Mark those observations clearly and verify they are truly read-only under the credentials and endpoint used. A supposedly harmless status command that refreshes a token, acquires a lock, or creates an audit record is still a real side effect during the approval stage.

Conversely, some assertions and local calculations remain fully useful in check mode even when mutation skips. Use them to validate required inputs, target identity, version compatibility, and rollout policy. Good preview design maximizes safe evidence rather than merely maximizing the number of tasks that report green.

Prediction support belongs to each module and task path. State-oriented modules such as `ansible.builtin.apt`, `ansible.builtin.package`, `ansible.builtin.file`, `ansible.builtin.stat`, and `ansible.builtin.user` can provide stronger preview evidence when their documented check-mode support covers the chosen arguments. `ansible.builtin.command` and `ansible.builtin.shell` need explicit guards or native dry-run behavior, while waits and external service checks may need a real canary run. Treat a skipped or unsupported task as missing evidence, not as proof of no change.

## Check Your Answers

:::expand[What Can a Preview Actually Prove?]{kind="recap"}
A preview is module-provided prediction, not a sandboxed execution. Separate predicted unchanged, predicted changed, and unknown or skipped work.
:::

:::expand[How Does Check Mode Predict Change?]{kind="recap"}
Modules compare current and desired state where they support it. Use task overrides only for safe observation or explicit prediction, and preserve registered data needed by later decisions.
:::

:::expand[What Does Diff Mode Add?]{kind="recap"}
Diff shows supported candidate deltas and makes `changed` reviewable. Disable it for secret-bearing content because rendered plaintext can leak even when Vault protected the source.
:::

:::expand[Why Do Module Support Limits Matter?]{kind="recap"}
Full, partial, and absent support produce different evidence. Commands, external APIs, changing repositories, and skipped registered results create important blind spots.
:::

:::expand[What Makes a Task Preview-Friendly?]{kind="recap"}
Use deterministic desired state, structured idempotent modules, separate observations, native validation, truthful result rules, and explicit handling for unavoidable side effects.
:::

:::expand[How Should Review and CI Use Preview?]{kind="recap"}
Pin dependencies, show inventory and limits, review safe diffs and skipped tasks, sanitize artifacts, record blind spots, and bind approval to the exact preview context.
:::

:::expand[How Do You Read Preview and Plan Rollback?]{kind="recap"}
Treat warnings and skipped work as missing evidence, then run a real canary. Prepare recovery for files, packages, services, databases, and external effects before apply.
:::

:::expand[What Is a Reliable Preview Workflow?]{kind="recap"}
Move from syntax and target inspection through check, diff, validation, canary, health, and bounded rollout. Each stage proves a stronger but still limited claim.
:::

---

**References**

- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official Ansible guide for `--check`, `--diff`, `check_mode`, and `ansible_check_mode`.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Command reference for playbook execution flags including check mode, diff mode, inventory, limit, and Vault options.
- [ansible.builtin.assert module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/assert_module.html) - Documents assertion tasks for safe deployment guardrails.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Covers `failed_when`, `changed_when`, and failure behavior used to make preview output clearer.
- [Logging Ansible output](https://docs.ansible.com/projects/ansible/latest/reference_appendices/logging.html) - Explains Ansible output logging and why secret output needs care in CI logs.
