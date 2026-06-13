---
title: "Ansible Workflow"
description: "Run Ansible in a safe order: read inventory, test access, preview supported changes, apply, read the recap, and rerun."
overview: "A first Ansible workflow should prove each layer before it changes machines."
tags: ["ansible", "workflow", "check-mode", "diff-mode"]
order: 2
id: article-infrastructure-as-code-ansible-workflow
---

## Table of Contents

1. [The Run Order](#the-run-order)
2. [Prepare the Automation Repo](#prepare-the-automation-repo)
3. [Confirm Inventory and Variables](#confirm-inventory-and-variables)
4. [Prove Connection and Privilege](#prove-connection-and-privilege)
5. [Validate the Playbook Shape](#validate-the-playbook-shape)
6. [Preview Supported Changes](#preview-supported-changes)
7. [Apply One Host First](#apply-one-host-first)
8. [Verify the Service](#verify-the-service)
9. [Widen the Rollout](#widen-the-rollout)
10. [Read Failures Like Signals](#read-failures-like-signals)
11. [Roll Back Safely](#roll-back-safely)
12. [Move the Workflow Into CI or Automation Platform](#move-the-workflow-into-ci-or-automation-platform)
13. [Putting It All Together](#putting-it-all-together)
14. [What's Next](#whats-next)
15. [References](#references)

## The Run Order
<!-- section-summary: A safe Ansible workflow proves the target set, access path, planned change, real canary, verification, and rollback path in order. -->

An **Ansible workflow** is the operating order around a playbook run. The playbook says what should happen to the systems. The workflow decides how the team proves the target, previews the change, limits the first real apply, verifies the service, and handles a bad result.

Let's keep using the orders platform from the first article. The production web fleet has `web-01` and `web-02` behind a load balancer. The team needs to change the Nginx proxy timeout from `30s` to `45s` because checkout requests sometimes wait on a slow payment provider. The YAML change is small, but the production blast radius depends on the workflow.

A first production workflow has a steady rhythm. The team checks the repo state, confirms the inventory group, proves Ansible can connect, proves privilege escalation, validates the playbook, previews supported changes, applies one host, verifies the service, reads the recap, runs again to confirm the state settles, and then widens the rollout. Each layer answers a different question before the next layer adds more risk.

This workflow gives production runs a visible shape. Ansible can target many hosts, and the operator can still choose one host, one tag, one batch, or one environment for the next step. Every command shows the target, the inventory, and the amount of risk being accepted.

## Prepare the Automation Repo
<!-- section-summary: The repo should tell the operator which inventory, config, dependencies, and playbook version the run will use. -->

The first safety check happens before Ansible touches a host. The team should know which Git commit they are running, which inventory they are using, which collections are installed, and which config file Ansible will read. A production incident becomes much easier to understand when the run points to a commit and a job record instead of a private working tree.

For a small orders repo, the structure might look like this. The important part is the separation between playbooks, inventories, environment variables, roles, templates, and handlers. The example below uses that split.

```yaml
site.yml
ansible.cfg
requirements.yml
inventories/
  staging/
    hosts.yml
    group_vars/
      web.yml
  prod/
    hosts.yml
    group_vars/
      web.yml
roles/
  orders_web/
    tasks/
      main.yml
    templates/
      orders-api.conf.j2
    handlers/
      main.yml
```

The `ansible.cfg` file keeps common defaults close to the project. It can point to the default inventory for local development, set the roles path, and tune normal execution settings. Production teams still pass `-i inventories/prod` explicitly in release commands so the target environment stays visible in the command history and job output.

```ini
[defaults]
inventory = inventories/staging
roles_path = roles
retry_files_enabled = False
forks = 10

[privilege_escalation]
become = False
```

Dependencies should be installed before the run. Collections from `requirements.yml` and Python dependencies for the execution environment should be stable enough that the same playbook behaves the same way in CI, on an engineer laptop, and in an automation controller job. In Red Hat Ansible Automation Platform, an execution environment image gives this a stronger production boundary because the job runs with a known Ansible runtime and known collections.

The repo check should also record the exact commit. A small release note can say: commit `a1b2c3d`, inventory `inventories/prod`, playbook `site.yml`, collection lock from `requirements.yml`, and operator or CI job that launched the run. That record turns a later incident review into evidence instead of memory. If a canary fails, the team can compare the failing job to the last healthy job and see whether the content, inventory, runtime, or release value changed.

## Confirm Inventory and Variables
<!-- section-summary: Inventory inspection confirms which hosts and variable values Ansible will use before tasks run. -->

Inventory is the first runtime safety boundary. It decides which machines Ansible can see and how Ansible reaches them. Before a production change, the team should confirm the group resolves to the expected hosts and that the host variables contain the expected connection and app settings.

The web group can be inspected as a graph. This gives the operator a quick view of group membership before a task runs. The command prints the selected group shape.

```bash
ansible-inventory -i inventories/prod --graph web
```

For the timeout change, the team expects `web-01` and `web-02`. If `web-stg-01` appears under the production inventory, the problem is visible before a task reaches a machine. If `web-03` is missing after a scale-out, the team can fix inventory before one host misses the config update.

Host variables deserve a second look because they often explain surprising runs. The command below shows the compiled values for one host after inventory files, group variables, host variables, and plugins have been processed. This is the place to catch a wrong remote user, interpreter path, or environment value:

```bash
ansible-inventory -i inventories/prod --host web-01
```

The output should show values such as `ansible_host`, `ansible_user`, `ansible_python_interpreter`, and the application variables used by the template. For the orders platform, the team should see the production server name and the new timeout value. Those two values prove the template will render for production rather than staging:

```yaml
orders_api_server_name: orders.example.com
orders_api_proxy_timeout: 45s
```

The playbook target can also be listed before tasks run. This keeps target selection separate from task execution. The command below asks Ansible which hosts the playbook would select.

```bash
ansible-playbook -i inventories/prod site.yml --limit web --list-hosts
```

This command gives the operator one more chance to catch a bad target pattern. It is especially useful when dynamic inventory is involved because cloud tags and inventory plugins can produce a host set that differs from what a person expected.

## Prove Connection and Privilege
<!-- section-summary: Connection and privilege checks separate SSH or sudo problems from playbook logic. -->

After the target set looks right, the next question is basic access. The `ansible.builtin.ping` module checks whether Ansible can connect to the host, authenticate, run a tiny module, and receive a structured response. It checks Ansible module execution rather than ICMP packets.

```bash
ansible -i inventories/prod web -m ansible.builtin.ping
```

A successful result tells the team that the control node can reach the managed nodes through the configured connection path. A failure here still says nothing about the Nginx playbook. The problem likely sits in SSH keys, host key checking, DNS, bastion routing, firewall rules, the remote user, or Python discovery.

Privilege needs its own proof because the orders Nginx change writes under `/etc` and reloads a system service. The team can check the effective user through a small ad hoc command. That turns sudo access into a clear pass or fail before the real playbook runs:

```bash
ansible -i inventories/prod web -b -m ansible.builtin.command -a whoami
```

If the output returns `root`, the become path works for those hosts. If the output fails, the team can fix sudo policy, `ansible_become_user`, password prompts, or automation controller credentials before the playbook mixes privilege problems with template and service behavior.

Production teams often keep this check in their runbook because it saves time during incidents. A broken sudo rule should be fixed as an access problem before anyone treats it as an application deployment bug. The separation makes the next step cleaner.

## Validate the Playbook Shape
<!-- section-summary: Syntax checks and task listings catch playbook structure problems before any host changes. -->

Once access works, the team can validate the playbook shape. A syntax check catches YAML mistakes, missing includes, and some playbook structure errors. It gives fast feedback before a preview or real run spends time connecting to every host.

```bash
ansible-playbook -i inventories/prod site.yml --syntax-check
```

The task list is useful when a playbook has roles, tags, or includes. It shows the operator which task names Ansible plans to run for the selected target. For the orders timeout change, the list should include the template task and the Nginx reload handler path, while unrelated worker tasks should stay out of the selected web run.

```bash
ansible-playbook -i inventories/prod site.yml --limit web-01 --list-tasks
```

Tags can make large playbooks easier to operate when the tag design is clear. For example, a role might tag Nginx config tasks as `nginx_config` and application deployment tasks as `orders_deploy`. Tags should match operational jobs a human actually wants to run, because a tag that selects half of a dependency chain can produce a confusing partial run.

```bash
ansible-playbook -i inventories/prod site.yml --limit web-01 --tags nginx_config --list-tasks
```

This stage also catches repo hygiene problems. Missing roles, missing collections, and broken variable includes should fail here or during preview instead of during the first production apply. The operator now has a known commit, a known inventory, working access, and a playbook that at least loads.

## Preview Supported Changes
<!-- section-summary: Check mode and diff mode show planned changes where modules can predict safely, and their limits should be read honestly. -->

**Check mode** asks Ansible to predict changes without applying them. **Diff mode** asks supported modules to show before-and-after details. Together, they provide review evidence before the real run, especially for file and template changes.

For the orders timeout change, the preview can target one host. The command keeps the evidence small enough for a human to review. The output should explain exactly which supported tasks expect change.

```bash
ansible-playbook -i inventories/prod site.yml --limit web-01 --check --diff
```

The expected result is narrow. The template task should report a planned change to `/etc/nginx/conf.d/orders-api.conf`, and the diff should show `proxy_read_timeout` moving from `30s` to `45s`. Package and service tasks should usually report `ok` or predictable status for a config-only change.

Preview output has limits, and those limits are part of the workflow. Some modules support check mode fully, some support it partially, and command-style tasks often need explicit choices because their effects live outside module knowledge. Registered variables can also make check-mode behavior different when a later task depends on a result that a skipped task would normally create.

Diff output can reveal secrets when templates contain credentials, tokens, or private config. Sensitive tasks should set `diff: false`, and secrets should live in a proper secret path such as Ansible Vault, automation controller credentials, or an external secret manager. The preview should help the team review the change without printing production secrets into logs.

```yaml
- name: Render private app config
  ansible.builtin.template:
    src: orders-secrets.env.j2
    dest: /etc/orders-api/secrets.env
    owner: root
    group: orders
    mode: "0640"
  diff: false
```

The preview stage gives the operator evidence. A real canary still matters because service reloads, package hooks, external APIs, and validation commands can behave differently once the change actually applies. The team should treat preview as one layer in the workflow, then prove the real behavior on one host.

## Apply One Host First
<!-- section-summary: A canary run proves the real task behavior on one host before the fleet receives the change. -->

The first real production apply should touch one host when the service shape allows it. The `--limit` flag narrows the playbook target at runtime. The playbook can know about the whole `web` group while the first real command applies only to `web-01`.

```bash
ansible-playbook -i inventories/prod site.yml --limit web-01 --diff
```

This run writes the Nginx config, triggers any handlers, and reloads Nginx if the template changed. The recap should show the template task as changed and the handler as changed. A second run against the same host should usually settle to `ok` for the template because the file already matches the requested state.

```bash
ansible-playbook -i inventories/prod site.yml --limit web-01
```

That second run is the idempotency check. If the template still changes, the file may include a timestamp, random value, host-specific value, or changing whitespace. If a command task changes every time, it may need `creates`, `removes`, `changed_when`, or a module replacement.

Some services need load balancer coordination before the canary. The team may drain `web-01`, run the playbook, verify locally, and then return the host to service. Ansible can orchestrate those steps if the team has modules or API calls for the load balancer, but the first beginner habit is simpler: choose one host, make the run observable, and verify before widening.

## Verify the Service
<!-- section-summary: Verification checks the system and the user-facing service after Ansible reports success. -->

Ansible success means the playbook tasks completed according to their modules. The application still deserves direct verification. For the orders web fleet, the team should check the local service, the Nginx config syntax, the health endpoint, and a user-facing path through the load balancer.

The host-local checks can use ad hoc commands. These checks prove the machine-level service state after the canary apply. The commands stay narrow because they target only the canary host.

```bash
ansible -i inventories/prod web-01 -b -m ansible.builtin.command -a "systemctl is-active nginx"
ansible -i inventories/prod web-01 -b -m ansible.builtin.command -a "nginx -t"
ansible -i inventories/prod web-01 -b -m ansible.builtin.command -a "systemctl is-active orders-api"
```

The user-facing checks can run from the operator environment or a monitoring runner. These checks prove the service path that users and upstream systems depend on. The health endpoint should pass before the rollout grows.

```bash
curl -fsS https://orders.example.com/health
curl -fsS https://orders.example.com/api/orders/health
```

The playbook can also include verification tasks when the check belongs to every run. A syntax check before reload is a good pattern for service config changes. The task should avoid noisy change reporting because a verification command should usually report `ok` when the check passes.

```yaml
- name: Check Nginx configuration syntax
  ansible.builtin.command: nginx -t
  changed_when: false
```

Verification should happen before widening the rollout. A green recap from Ansible plus a failing health endpoint means the system still has a problem. The recap tells the team the automation completed; service checks tell the team the platform is healthy for users.

## Widen the Rollout
<!-- section-summary: The rollout can expand through limits, serial batches, and failure controls after the canary proves healthy. -->

After `web-01` passes verification, the team can widen the rollout to the rest of the group. A simple pattern is to exclude the canary host and run the remaining web hosts. That avoids repeating the canary while still using the same reviewed playbook:

```bash
ansible-playbook -i inventories/prod site.yml --limit "web:!web-01" --diff
```

For larger fleets, the playbook can define **serial** batches so Ansible processes a few hosts at a time. Serial rollout protects the service when one host failure should stop the batch before every host changes. It also gives monitoring and load balancers time to show problems while the affected set is still small.

```yaml
- name: Configure orders web servers
  hosts: web
  become: true
  serial: 2
  any_errors_fatal: true
  roles:
    - orders_web
```

The `serial: 2` line tells Ansible to work through two web hosts at a time. The `any_errors_fatal: true` line makes a failure stop the play more aggressively across the current operation. A small web fleet might use `serial: 1`, while a larger fleet might use batches of 5 or 10 depending on capacity and service risk.

The `forks` setting controls how many hosts Ansible can work on in parallel at the engine level. `serial` controls the rollout batch for a play. Those two knobs answer different questions: how much parallelism the runner can use, and how much of this service should change at once.

## Read Failures Like Signals
<!-- section-summary: The failure category usually points to the broken layer: target selection, connection, privilege, preview, module behavior, or service validation. -->

A failed run should be read by layer. The play recap separates `unreachable` from `failed`, and task messages usually name the module and host that had the problem. That structure helps the team avoid guessing.

`unreachable` points to connection setup. The likely causes are wrong host address, missing SSH key, changed host key, broken bastion route, firewall rules, wrong remote user, or interpreter discovery trouble. A narrow verbose ping gives better evidence. It keeps the investigation focused on one host and one connection path:

```bash
ansible -i inventories/prod web-02 -m ansible.builtin.ping -vvv
```

Privilege failures show up around sudo, protected file paths, or permission denied messages. The `whoami` check with `-b` can confirm whether Ansible can become root. In automation controller, the same issue may sit in the selected credential or in whether the job template allows privilege escalation prompts.

Template and variable failures usually name the missing variable or the file that failed to render. The team should check `group_vars`, host variables, and environment-specific values before changing task logic. A production variable typo can make a correct role fail only in one inventory.

Service failures usually happen after the file was changed. For Nginx, `nginx -t` tells the team whether syntax is valid, and systemd status or logs can show why reload failed. A handler failure means the config may already be written, so verification and rollback should come before another full-fleet run.

Check-mode surprises also have a pattern. A task may skip because the module lacks full check-mode support, or a later task may lack a registered value from an earlier task. That output should reduce confidence in the preview for that task, and the canary apply should carry more weight.

## Roll Back Safely
<!-- section-summary: Rollback should use the same reviewed automation path, with a narrow target first and verification after the revert. -->

Rollback should be concrete before the production apply starts. For a config-only change, the clean rollback is usually a Git revert plus the same playbook run against the affected host. That keeps the fix visible, reviewed, and repeatable.

```bash
git revert <change-commit>
ansible-playbook -i inventories/prod site.yml --limit web-01 --diff
ansible -i inventories/prod web-01 -b -m ansible.builtin.command -a "nginx -t"
curl -fsS https://orders.example.com/health
```

For a bad application artifact, rollback might mean setting the previous version variable and running the deployment role against the canary host first. The exact command depends on the team's deploy design, but the operating shape stays the same: narrow target, known previous version, service verification, then wider rollout.

```bash
ansible-playbook -i inventories/prod site.yml --limit web-01 --tags orders_deploy -e orders_api_version=2026.06.12
```

For a bad data migration, rollback needs more care because a playbook may have changed state outside the host filesystem. The runbook should name the database backup, the restore procedure, the migration owner, and the verification query before the deployment starts. Ansible can orchestrate pieces of that process, but the team still needs a real data recovery plan.

Rollback can also use Ansible error-handling features for local cleanup. Blocks and rescue sections can group tasks and define recovery actions when a task fails. That is useful for temporary files, load balancer drain steps, or local service restoration, while human approval still belongs around risky data or fleet-wide rollback.

For the orders platform, the rollback table can be written before the release. A bad Nginx template means revert the Git change, rerun `site.yml` against the canary, run `nginx -t`, and check the public health endpoint. A bad package release means restore `orders_api_version` to the previous approved value, run the deploy tag on one host, then widen only after health checks pass. A bad migration means stop the rollout, call the database restore owner, confirm the backup timestamp, and run the verification query before any application hosts move again.

## Move the Workflow Into CI or Automation Platform
<!-- section-summary: The same workflow can become a CI pipeline or an automation controller job template with approvals and recorded output. -->

After the team trusts the manual sequence, the same workflow can move into CI. CI can install collections, run `ansible-lint`, run syntax checks, list hosts for the selected inventory, and run staging previews. A protected production job can require approval before it runs the canary and full rollout commands.

A simple CI command sequence might look like this. The same commands from the manual workflow become repeatable checks in the pipeline. The staging preview gives reviewers evidence before a protected production job runs.

```bash
ansible-galaxy collection install -r requirements.yml
ansible-playbook -i inventories/staging site.yml --syntax-check
ansible-playbook -i inventories/staging site.yml --limit web --check --diff
```

Red Hat Ansible Automation Platform gives the same idea a managed interface. A project syncs the automation repo, an inventory defines the host set, credentials provide access without exposing secrets to every operator, an execution environment supplies the runtime, and a job template stores the playbook plus allowed prompts. The job output records who launched it, when it ran, which hosts changed, and where it failed.

For the orders platform, the production job template might prompt for `orders_api_version`, allow a `limit` value, require an approval step, and run through a tested execution environment. That makes the safe workflow easier for on-call engineers because the risky choices are explicit instead of hidden in a long terminal command.

Automation should keep the same guardrails as the manual version. The pipeline should still make the target visible, run a canary, verify service health, and stop on meaningful failures. Automating an unsafe sequence only makes the unsafe sequence faster.

## Putting It All Together
<!-- section-summary: The full workflow moves from repo proof to inventory proof, access proof, preview evidence, canary apply, verification, rollout, and rollback. -->

The orders team can now run the Nginx timeout change in a clean order. They confirm the Git commit and dependencies, inspect `inventories/prod`, list the selected web hosts, inspect `web-01` variables, prove module execution, prove `become`, run syntax and task-list checks, preview `web-01` with check and diff mode, and then apply `web-01`.

After the canary, they verify Nginx, verify the orders API, read the recap, and run the same playbook again against `web-01` to confirm idempotency. If the service is healthy, they widen the rollout with `--limit "web:!web-01"` or let `serial` move through batches. If the service is unhealthy, they revert the Git change, run the same playbook narrowly, and verify again.

That workflow is the practical difference between "we ran Ansible" and "we operated production carefully." The playbook gives the desired state. The workflow gives the evidence, order, and blast-radius control around that desired state.

## What's Next

This workflow started with inventory because every safe Ansible run depends on a trustworthy host map. The next article goes deeper into inventory structure, host names, groups, variables, static files, dynamic inventory, and the difference between a host's automation name and its network address.

The host map gives every later command its boundary. A playbook can be correct, and safe operation still starts by knowing exactly which systems will receive it.

---

**References**

- [Ansible documentation](https://docs.ansible.com/projects/ansible/latest/index.html) - Main entry point for current Ansible community documentation.
- [Getting started with Ansible](https://docs.ansible.com/projects/ansible/latest/getting_started/index.html) - Defines the basic Ansible components: control node, inventory, and managed nodes.
- [Building an inventory](https://docs.ansible.com/projects/ansible/latest/getting_started/get_started_inventory.html) - Shows beginner inventory creation, inventory verification, and a first module ping.
- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html) - Explains inventory formats, groups, host variables, and organization patterns.
- [Working with dynamic inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_dynamic_inventory.html) - Covers dynamic inventory sources for changing infrastructure.
- [Ansible playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_intro.html) - Documents playbooks, plays, task execution, idempotency, check mode, and syntax verification.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - CLI reference for playbook execution flags such as inventory, limit, tags, syntax check, check mode, and diff mode.
- [ansible-inventory](https://docs.ansible.com/projects/ansible/latest/cli/ansible-inventory.html) - CLI reference for inspecting compiled inventory with list, graph, and host output.
- [Introduction to ad hoc commands](https://docs.ansible.com/projects/ansible/latest/command_guide/intro_adhoc.html) - Explains one-off module commands used for ping, privilege checks, and service verification.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Documents preview behavior, diff output, module support limits, and `diff: false`.
- [Controlling playbook execution: strategies and more](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_strategies.html) - Covers strategies, forks, serial batches, and execution control keywords.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Documents failed and unreachable host behavior, handlers on failure, blocks, and rescue patterns.
- [Ansible Configuration Settings](https://docs.ansible.com/projects/ansible/latest/reference_appendices/config.html) - Reference for `ansible.cfg` settings and precedence.
- [Red Hat Ansible Automation Platform job templates](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.5/html/using_automation_execution/controller-job-templates) - Describes reusable job templates with playbooks, inventory, credentials, and runtime parameters.
- [Red Hat Ansible Automation Platform best practices](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.5/html/using_automation_execution/assembly-controller-best-practices) - Covers source control, inventory, variable management, scale, and CI/CD guidance for automation controller.
