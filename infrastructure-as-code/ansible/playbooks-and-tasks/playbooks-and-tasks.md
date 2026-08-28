---
title: "Playbooks and Tasks"
description: "Learn how playbooks group hosts and execute lists of state-aware tasks."
overview: "Discover the structural layers of Ansible automation, how playbooks map host targets to tasks, and how modules execute state-aware updates."
tags: ["ansible", "playbooks", "tasks", "modules"]
order: 1
id: article-infrastructure-as-code-ansible-playbook-structure
aliases:
  - article-infrastructure-as-code-ansible-tasks-modules
  - playbooks-and-tasks/playbook-structure.md
  - playbooks-and-tasks/tasks-and-modules.md
  - infrastructure-as-code/ansible/playbooks-and-tasks/playbook-structure.md
  - infrastructure-as-code/ansible/playbooks-and-tasks/tasks-and-modules.md
---

## Table of Contents

1. [What Is the Shape of a Playbook?](#what-is-the-shape-of-a-playbook)
2. [How Do Hosts, Plays, Tasks, and Modules Differ?](#how-do-hosts-plays-tasks-and-modules-differ)
3. [How Does Execution Produce Results?](#how-does-execution-produce-results)
4. [How Does One Playbook Serve a Fleet?](#how-does-one-playbook-serve-a-fleet)
5. [How Do You Run a Playbook Safely?](#how-do-you-run-a-playbook-safely)
6. [When Do You Need Handlers, Blocks, and Roles?](#when-do-you-need-handlers-blocks-and-roles)
7. [How Do You Diagnose and Roll Back Failures?](#how-do-you-diagnose-and-roll-back-failures)
8. [What Makes a Playbook an Operations Plan?](#what-makes-a-playbook-an-operations-plan)
9. [Check Your Answers](#check-your-answers)

An **Ansible playbook** is a YAML file that says what should happen to a set of managed machines. It usually lives in source control beside inventory, templates, roles, and release notes, so the team can review infrastructure changes in the same way they review application changes.

The main pieces have a simple relationship. A **playbook** contains one or more **plays**. A **play** selects hosts and sets shared behavior for those hosts. A **task** is one named step inside the play. Most tasks call an Ansible **module**, which is the small unit of code that inspects or changes something on the managed host.

For a beginner, this is the first important split. The playbook describes the workflow, while modules do the actual work. The `ansible.builtin.package` module manages packages, `ansible.builtin.template` renders files, and `ansible.builtin.service` controls services. The playbook gives those modules arguments and decides which hosts receive them.

Use one production-style system to make the execution model concrete. A small application platform has two web servers behind a load balancer and one background worker. The web servers run Nginx and an `application-api` systemd service. The worker server runs `application-worker`. The team wants one reviewed automation path for staging and production instead of a set of private SSH notes.

Keep these questions in view as you work through the lesson:

1. **What Is the Shape of a Playbook?**
2. **How Do Hosts, Plays, Tasks, and Modules Differ?**
3. **How Does Execution Produce Results?**
4. **How Does One Playbook Serve a Fleet?**
5. **How Do You Run a Playbook Safely?**
6. **When Do You Need Handlers, Blocks, and Roles?**
7. **How Do You Diagnose and Roll Back Failures?**
8. **What Makes a Playbook an Operations Plan?**

## What Is the Shape of a Playbook?
<!-- section-summary: A playbook is a YAML file that connects a group of hosts with an ordered list of automation steps. -->

The pieces connect like this. Inventory chooses `application_web`. The play selects that group. Each task calls one module. The module inspects the remote host, changes only what it needs to change, and returns a result. The playbook output is useful because every task has a name and every module reports a status.

The fundamental hierarchy is:

```text
playbook
├── play: target one host set and shared behavior
│   ├── task: assert or transition one part of state
│   │   └── module: perform the structured operation
│   └── handler: respond to a real change notification
└── another play: target another host set
```

A task is best read as one assertion about system state: a package is present, a directory has a mode, a file has rendered content, or a service is started. The task name explains intent; the module and arguments provide the mechanism.

YAML represents nested mappings and lists. A playbook is a list of play mappings, `tasks` is a list of task mappings, and a module's parameters form another mapping. Indentation therefore expresses data structure, not decorative formatting.

## How Do Hosts, Plays, Tasks, and Modules Differ?
<!-- section-summary: Plays choose host groups, tasks express individual operations, and modules report whether each operation changed the host. -->

Ansible starts from **inventory**, which is the list of managed hosts and groups. A play can target a group such as `application_web`, and inventory decides which hosts belong to that group for staging or production. That keeps host membership in one reviewed place instead of scattering server names through every playbook.


![Playbook Hierarchy Map](/content-assets/articles/article-infrastructure-as-code-ansible-playbook-structure/playbook-hierarchy-map.png)

*The hierarchy map shows how a playbook contains plays, plays target hosts, tasks call modules, and handlers wait for change signals.*

```yaml
all:
  children:
    application_web:
      hosts:
        application-web-01.example.com:
        application-web-02.example.com:
    application_worker:
      hosts:
        application-worker-01.example.com:
```

A play then connects that group to work. This first play targets only the web hosts, uses privilege escalation through `become`, and runs tasks in order. The task names matter because they become the labels operators read during a live run.

```yaml
- name: Configure application web hosts
  hosts: application_web
  become: true
  gather_facts: true
  tasks:
    - name: Install web server packages
      ansible.builtin.package:
        name:
          - nginx
          - application-api
        state: present

    - name: Create application configuration directory
      ansible.builtin.file:
        path: /etc/application-api
        state: directory
        owner: root
        group: application
        mode: "0750"

    - name: Render application API configuration
      ansible.builtin.template:
        src: application-api.yml.j2
        dest: /etc/application-api/config.yml
        owner: root
        group: application
        mode: "0640"
      notify: Restart application API

  handlers:
    - name: Restart application API
      ansible.builtin.service:
        name: application-api
        state: restarted
```

Each task gives Ansible a focused instruction. The package task makes sure the software exists. The file task makes sure the directory exists with the right ownership and mode. The template task renders a configuration file from source control to the host. The handler restarts the service only after the template task reports a real change.

This structure is more explicit than a long shell script. Instead of relying on `mkdir -p` plus follow-up commands, the task states the desired directory, owner, group, and mode together. The module checks the remote host before changing it, which is why playbook output can say `ok`, `changed`, `failed`, or `unreachable` per host and per task.

Behind the scenes, Ansible sends module work to each selected host through the configured connection. For many Linux modules, that means a small Python module runs on the managed host and returns structured data. That is why a host can accept SSH and still fail a task if Python discovery, temporary directories, or sudo rules are broken. The playbook structure stays simple, while the result tells the operator which layer failed.

Modules are preferable to shell commands when they expose the desired-state operation you need. They understand parameters, current state, check-mode support, return fields, and idempotent comparison. A shell command hides its internal effect behind a string and forces the author to reconstruct change and failure semantics.

Use `command` or `shell` when no suitable module or API exists, and then provide evidence through guards, documented return codes, `changed_when`, and `failed_when`. The exception should remain one well-described task rather than turning the whole playbook into a script embedded in YAML.

A play answers “where do these tasks apply?” Its host pattern, privilege, facts, variables, serial behavior, and task list establish one execution context. A playbook orders several plays so different tiers can receive different work while sharing one reviewed entry point.

## How Does Execution Produce Results?
<!-- section-summary: Tasks are ordered within a play, evaluated for each host, and return structured status that later workflow can use. -->

Tasks are ordered, but hosts add another dimension. Under the normal linear strategy, Ansible works on a task across the current host set before advancing. Forks and serial batches influence how much host work can happen at once, so a playbook is not simply a shell script executed top to bottom on one machine.

Every task produces a structured result for each host. The visible states include `ok`, `changed`, `failed`, `unreachable`, and `skipped`. Registered results can expose return codes, stdout, stderr, facts, or module-specific fields to later conditions.

That status is part of the automation contract. A template that reports `changed` can notify a handler. A failed validation can stop later tasks on that host. An unreachable host means the module never reached useful execution. Task names and truthful results turn the run into evidence rather than undifferentiated terminal output.

Conditions turn a task into a conditional state assertion. Loops repeat one task structure for several data items. Variables keep the operation stable while hosts and environments supply values. These features change which concrete module calls occur without changing the hierarchy around them.

## How Does One Playbook Serve a Fleet?
<!-- section-summary: A production playbook usually combines inventory, variables, templates, handlers, and separate plays for separate host groups. -->

Real teams usually keep the playbook as the orchestration layer. The playbook chooses the host group, the tasks or roles to run, and the order of operations. Inventory and variable files carry environment-specific values such as ports, hostnames, package versions, and feature flags.

For the application platform, production variables might look like this. The file stays small because it carries environment values rather than repeating task logic.

```yaml
application_api_listen_port: 8080
application_api_public_name: application.example.com
application_api_database_host: application-db.internal.example.com
application_api_release: "2026.06.13"
```

The Nginx template can use those values without copying the whole playbook for each environment. The same template works in staging when inventory provides different names and ports.

```nginx
server {
    listen 80;
    server_name {{ application_api_public_name }};

    location / {
        proxy_pass http://127.0.0.1:{{ application_api_listen_port }};
        proxy_set_header Host $host;
        proxy_set_header X-Request-ID $request_id;
    }
}
```

The playbook can also separate the worker host from the web hosts. That separation keeps a web change from accidentally restarting background jobs. It also lets an operator limit a run to one group during a canary deployment.

```yaml
- name: Configure application worker hosts
  hosts: application_worker
  become: true
  tasks:
    - name: Install application worker package
      ansible.builtin.package:
        name: application-worker
        state: present

    - name: Keep application worker running
      ansible.builtin.service:
        name: application-worker
        state: started
        enabled: true
```

That gives the team one `site.yml` entry point with separate plays for separate parts of the system. A reviewer can see which hosts receive Nginx, which hosts receive the worker service, and where service restarts can happen. The structure also supports progressive rollout because the operator can target one host, one group, or the full inventory.

## How Do You Run a Playbook Safely?
<!-- section-summary: Safe execution starts with syntax checks, target checks, check mode, diff mode, and small limits before a full production run. -->

The first safety step happens before Ansible touches a production host. A syntax check catches YAML and playbook parsing mistakes. It proves the playbook can be parsed and catches broken indentation, missing colons, and invalid playbook shape early.


![Safe Run Command Loop](/content-assets/articles/article-infrastructure-as-code-ansible-playbook-structure/safe-run-command-loop.png)

*The run loop turns syntax checks, check mode, limits, apply, recap reading, and reruns into one safe operating path.*

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --syntax-check
```

The next check proves the host pattern matches the intended machines. This matters because a typo in inventory or a broad host pattern can send a play to the wrong group. For a canary web deploy, the operator can list the targets before the real run.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit application-web-01.example.com --list-hosts
```

For file and package changes, check mode and diff mode give useful rehearsal output. Check mode asks supported modules what they would change. Diff mode shows before-and-after details for modules that support diffs, especially file and template modules.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit application-web-01.example.com --check --diff
```

After those checks, the canary run applies the playbook to one host. If the service passes health checks, the team can run the same playbook against the rest of the group. The important habit is keeping the command narrow until the evidence says the change is safe to widen.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit application-web-01.example.com
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit application_web
```

In Red Hat Ansible Automation Platform or another controller, the same ideas usually become job templates, inventories, credentials, survey inputs, and approval flows. The underlying playbook shape stays the same. The controller adds audit records, scheduling, role-based access, and a central place to review output.

Safe execution narrows uncertainty in order: parse the playbook, verify inventory and intended hosts, inspect the task graph, preview supported changes on one host, apply to that canary, verify health, then expand. Each step answers a smaller question before the next step gains mutation authority.

`serial` can encode gradual rollout inside the play so a group apply does not update every host together. Combine it with an explicit canary limit and application health checks. Host selection, batch size, and task correctness are different safety layers.

Keep the actual inventory, playbook, limit, extra variables, Vault IDs, and dependency versions visible in a deployment record. Two identical YAML files can produce different work when those runtime inputs differ.

## When Do You Need Handlers, Blocks, and Roles?
<!-- section-summary: Larger playbooks use handlers for delayed service actions, blocks for grouped control, and roles for reusable service structure. -->

A **handler** is a task that runs after another task notifies it. Handlers are commonly used for service reloads and restarts because they prevent repeated restarts during one play. If three template tasks notify the same handler, Ansible can run that handler once at the end of the play.

That behavior helps the application API. The service should restart after its configuration changes. It should stay quiet when the rendered file already matches the host. A handler ties the restart to the changed signal from the template task, so the playbook output stays meaningful.

A **block** groups related tasks and lets the playbook apply shared options or error handling to the group. For example, a deploy block can render config, validate it, and reload the service. A `rescue` section can collect logs or restore a previous file when validation fails.

```yaml
- name: Deploy application API configuration
  block:
    - name: Render candidate application API configuration
      ansible.builtin.template:
        src: application-api.yml.j2
        dest: /etc/application-api/config.yml
        mode: "0640"
      notify: Restart application API

    - name: Validate application API configuration
      ansible.builtin.command: application-api --check-config /etc/application-api/config.yml
      changed_when: false
  rescue:
    - name: Show recent application API logs after validation failure
      ansible.builtin.command: journalctl -u application-api -n 50 --no-pager
      changed_when: false
```

The rescue section should gather safe evidence and take narrow recovery actions. It can collect logs, restore a backup file, or leave the host out of a load balancer pool. It should avoid hiding the failure. A rescued task still needs a human or pipeline decision about whether the rollout should continue.

A **role** packages tasks, defaults, templates, files, and handlers into a reusable directory. A team might start with one playbook file while learning. As the application API grows, moving the web setup into a role gives the playbook a smaller surface:

```yaml
- name: Configure application web hosts
  hosts: application_web
  become: true
  roles:
    - role: application_api_web
```

The role can carry the install tasks, templates, handlers, and default variables. The playbook still answers the operational question: which hosts receive this role, and in what order does the rollout happen.

Handlers solve a causal problem: one state change requires another action. They are delayed so several config tasks can notify one restart and the service restarts once rather than after each file. Use `meta: flush_handlers` when validation must observe the restarted process before later rollout steps.

Blocks group tasks that share `become`, conditions, tags, or error handling. `rescue` handles a failed block; `always` runs regardless of success. Recovery should preserve the original failure signal and avoid unconditional actions such as returning an unhealthy host to traffic.

Roles solve the growth problem by packaging one reusable capability. The playbook remains orchestration: it selects hosts, sequences roles and global actions, and controls rollout. A role owns service mechanics, defaults, templates, files, and handlers. Moving everything into a role should make this boundary clearer, not hide the play's operational plan.

## How Do You Diagnose and Roll Back Failures?
<!-- section-summary: Operators debug playbooks by separating parse errors, target mistakes, connection failures, module failures, and application rollback. -->

Playbook failures usually fall into a few plain categories. A syntax error means YAML or playbook parsing failed. A target mistake means the host pattern matched zero hosts or more hosts than expected. A connection failure appears as `unreachable`, which points to SSH, credentials, host keys, DNS, network paths, or inventory addresses. A module failure means Ansible reached the host and the task logic failed there.

For the application platform, a failed package task might point to a repository problem. A failed template task might point to a missing variable or a file permission problem. A failed validation command might point to a bad application config. Those are different repairs, so the operator should start from the failed task name and the host status instead of treating the whole run as one generic error.

Rollback should be planned before the first production run. Ansible applies the state described in the current repository checkout, so a common rollback is to revert the template, variables, or role change in Git and run the playbook again against a canary host. For application releases, keep the release version in a variable such as `application_api_release`, then roll back by passing or restoring the previous approved version through the same playbook path.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit application-web-01.example.com -e application_api_release=2026.06.12
```

Some changes need extra care. Database migrations, destructive file removal, and firewall changes may need backups, maintenance windows, or separate approval. A playbook can automate those operations, and the team still needs a recovery path that has been tested on staging.

## What Makes a Playbook an Operations Plan?
<!-- section-summary: A healthy playbook keeps host selection, task intent, module behavior, and operational safety visible in one reviewed file. -->

The application platform now has a clear Ansible shape. Inventory names the web and worker hosts. Plays select those groups. Tasks call modules with structured arguments. Templates turn variables into service configuration. Handlers restart services only after meaningful changes. Roles can package the repeated service setup when the playbook grows.


![Playbooks Summary](/content-assets/articles/article-infrastructure-as-code-ansible-playbook-structure/playbooks-summary.png)

*The summary follows the practical playbook sequence: read, target, change, notify, verify, and roll back.*

This structure gives operators a practical workflow. They can check syntax, list target hosts, rehearse with check and diff mode, run a canary, review output, and then widen the run. If something fails, the task name and host status point to the right layer of the problem.

Playbooks are the part people review and run, so they should read like a careful operations plan. The next article focuses on the behavior that makes repeated runs safe: idempotency.

The most important distinction from a traditional script is that a playbook should describe desired state through modules, while Ansible handles host iteration, comparison, structured results, and conditional secondary actions. Ordered orchestration remains, but each task carries more state knowledge than an opaque command line.

The next article follows the same application platform and looks at repeated runs. It explains why `changed` should mean the host actually moved, why command tasks need guards, and how a second run can prove that the playbook has settled.

Play order should express real dependencies. A database preparation play may need to complete before application hosts deploy, while web and worker plays may remain independent. Do not encode dependency by relying on an incidental inventory order; put it in the ordered playbook, roles, handlers, or explicit orchestration step that owns it.

The same clarity applies to delegation and `run_once`. A task about the whole release may run once on the controller, while host-local state still runs per selected node. Naming the subject, executor, and repetition scope prevents a compact playbook from hiding global side effects inside an ordinary-looking host task.

Fact gathering is part of a play's cost and input contract. Disable it for controller-only or API work that uses no host facts, but do not remove it from a play whose conditions, templates, or role defaults require observed machine state. If only a narrow subset is needed, gather deliberately and keep the dependency visible.

Task granularity affects both reuse and diagnosis. A task should be small enough that its name and result identify one state transition, but not split into imperative fragments that force operators to mentally assemble one desired state. Purpose-built modules usually provide the right unit: one package set, one directory, one rendered file, or one service state.

Static inspection can expose part of the orchestration before execution. `ansible-playbook site.yml --list-tasks` shows statically discoverable task names, though dynamic includes and conditions can leave runtime branches unresolved. Tasks may use a state module such as `ansible.builtin.user` or a lower-level `ansible.builtin.shell` command, and facts such as `ansible_os_family` can choose which task applies. Read all three dimensions together: selected hosts, ordered task graph, and per-host runtime conditions.

## Check Your Answers

:::expand[What Is the Shape of a Playbook?]{kind="recap"}
A playbook contains ordered plays; a play selects hosts and shared behavior; tasks state focused intent; modules perform structured work; handlers respond to change.
:::

:::expand[How Do Hosts, Plays, Tasks, and Modules Differ?]{kind="recap"}
Inventory supplies hosts, plays bind host sets to work, tasks name state assertions, and modules inspect or change managed systems with structured arguments and results.
:::

:::expand[How Does Execution Produce Results?]{kind="recap"}
Tasks execute in order across host contexts and return `ok`, `changed`, `failed`, `unreachable`, or `skipped`. Those results drive handlers, conditions, and diagnosis.
:::

:::expand[How Does One Playbook Serve a Fleet?]{kind="recap"}
Separate plays target distinct tiers while inventory variables provide environment data. Templates and modules stay reusable across staging and production.
:::

:::expand[How Do You Run a Playbook Safely?]{kind="recap"}
Check syntax, inventory, hosts, and tasks; preview one canary; apply and verify it; then widen through deliberate serial batches with recorded inputs.
:::

:::expand[When Do You Need Handlers, Blocks, and Roles?]{kind="recap"}
Handlers delay change-triggered actions, blocks group shared control and recovery, and roles package reusable capabilities while playbooks retain orchestration.
:::

:::expand[How Do You Diagnose and Roll Back Failures?]{kind="recap"}
Separate parse, target, connection, module, and application failures. Restore previous reviewed inputs or state through a bounded run and use special recovery for destructive changes.
:::

:::expand[What Makes a Playbook an Operations Plan?]{kind="recap"}
A good playbook exposes target selection, task intent, state-aware modules, result-driven actions, validation, rollout boundaries, and recovery rather than hiding them in scripts.
:::

---

**References**

- [Ansible playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_intro.html) - Official introduction to playbook structure, plays, tasks, execution order, FQCN guidance, check mode, and verification options.
- [Working with playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks.html) - Official guide for templates, handlers, blocks, conditionals, roles, and other playbook features.
- [Reusing Ansible artifacts](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse.html) - Official guidance on roles, task files, playbook imports, includes, and reusable automation structure.
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html) - Official handler behavior and notification guidance.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official details for `--check`, `--diff`, and task-level check or diff behavior.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official CLI reference for playbook execution, listing, limiting, syntax checks, and verbosity.
