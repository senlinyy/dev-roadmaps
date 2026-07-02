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

1. [The Shape of a Playbook](#the-shape-of-a-playbook)
2. [Hosts, Plays, Tasks, and Modules](#hosts-plays-tasks-and-modules)
3. [A Small Production Web Fleet](#a-small-production-web-fleet)
4. [Running the Playbook Safely](#running-the-playbook-safely)
5. [Handlers, Blocks, and Roles](#handlers-blocks-and-roles)
6. [Common Failures and Safe Rollback](#common-failures-and-safe-rollback)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)
9. [References](#references)

## The Shape of a Playbook
<!-- section-summary: A playbook is a YAML file that connects a group of hosts with an ordered list of automation steps. -->

An **Ansible playbook** is a YAML file that says what should happen to a set of managed machines. It usually lives in source control beside inventory, templates, roles, and release notes, so the team can review infrastructure changes in the same way they review application changes.

The main pieces have a simple relationship. A **playbook** contains one or more **plays**. A **play** selects hosts and sets shared behavior for those hosts. A **task** is one named step inside the play. Most tasks call an Ansible **module**, which is the small unit of code that inspects or changes something on the managed host.

For a beginner, this is the first important split. The playbook describes the workflow, while modules do the actual work. The `ansible.builtin.package` module manages packages, `ansible.builtin.template` renders files, and `ansible.builtin.service` controls services. The playbook gives those modules arguments and decides which hosts receive them.

We will use one production-style story for the rest of the article. A small orders platform has two web servers behind a load balancer and one background worker. The web servers run Nginx and an `orders-api` systemd service. The worker server runs `orders-worker`. The team wants one reviewed automation path for staging and production instead of a set of private SSH notes.

The pieces connect like this. Inventory chooses `orders_web`. The play selects that group. Each task calls one module. The module inspects the remote host, changes only what it needs to change, and returns a result. The playbook output is useful because every task has a name and every module reports a status.

## Hosts, Plays, Tasks, and Modules
<!-- section-summary: Plays choose host groups, tasks express individual operations, and modules report whether each operation changed the host. -->

Ansible starts from **inventory**, which is the list of managed hosts and groups. A play can target a group such as `orders_web`, and inventory decides which hosts belong to that group for staging or production. That keeps host membership in one reviewed place instead of scattering server names through every playbook.


![Playbook Hierarchy Map](/content-assets/articles/article-infrastructure-as-code-ansible-playbook-structure/playbook-hierarchy-map.png)

*The hierarchy map shows how a playbook contains plays, plays target hosts, tasks call modules, and handlers wait for change signals.*

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01.example.com:
        orders-web-02.example.com:
    orders_worker:
      hosts:
        orders-worker-01.example.com:
```

A play then connects that group to work. This first play targets only the web hosts, uses privilege escalation through `become`, and runs tasks in order. The task names matter because they become the labels operators read during a live run.

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  gather_facts: true
  tasks:
    - name: Install web server packages
      ansible.builtin.package:
        name:
          - nginx
          - orders-api
        state: present

    - name: Create orders configuration directory
      ansible.builtin.file:
        path: /etc/orders-api
        state: directory
        owner: root
        group: orders
        mode: "0750"

    - name: Render orders API configuration
      ansible.builtin.template:
        src: orders-api.yml.j2
        dest: /etc/orders-api/config.yml
        owner: root
        group: orders
        mode: "0640"
      notify: Restart orders API

  handlers:
    - name: Restart orders API
      ansible.builtin.service:
        name: orders-api
        state: restarted
```

Each task gives Ansible a focused instruction. The package task makes sure the software exists. The file task makes sure the directory exists with the right ownership and mode. The template task renders a configuration file from source control to the host. The handler restarts the service only after the template task reports a real change.

This structure is more explicit than a long shell script. Instead of relying on `mkdir -p` plus follow-up commands, the task states the desired directory, owner, group, and mode together. The module checks the remote host before changing it, which is why playbook output can say `ok`, `changed`, `failed`, or `unreachable` per host and per task.

Behind the scenes, Ansible sends module work to each selected host through the configured connection. For many Linux modules, that means a small Python module runs on the managed host and returns structured data. That is why a host can accept SSH and still fail a task if Python discovery, temporary directories, or sudo rules are broken. The playbook structure stays simple, while the result tells the operator which layer failed.

## A Small Production Web Fleet
<!-- section-summary: A production playbook usually combines inventory, variables, templates, handlers, and separate plays for separate host groups. -->

Real teams usually keep the playbook as the orchestration layer. The playbook chooses the host group, the tasks or roles to run, and the order of operations. Inventory and variable files carry environment-specific values such as ports, hostnames, package versions, and feature flags.

For the orders platform, production variables might look like this. The file stays small because it carries environment values rather than repeating task logic.

```yaml
orders_api_listen_port: 8080
orders_api_public_name: orders.example.com
orders_api_database_host: orders-db.internal.example.com
orders_api_release: "2026.06.13"
```

The Nginx template can use those values without copying the whole playbook for each environment. The same template works in staging when inventory provides different names and ports.

```nginx
server {
    listen 80;
    server_name {{ orders_api_public_name }};

    location / {
        proxy_pass http://127.0.0.1:{{ orders_api_listen_port }};
        proxy_set_header Host $host;
        proxy_set_header X-Request-ID $request_id;
    }
}
```

The playbook can also separate the worker host from the web hosts. That separation keeps a web change from accidentally restarting background jobs. It also lets an operator limit a run to one group during a canary deployment.

```yaml
- name: Configure orders worker hosts
  hosts: orders_worker
  become: true
  tasks:
    - name: Install orders worker package
      ansible.builtin.package:
        name: orders-worker
        state: present

    - name: Keep orders worker running
      ansible.builtin.service:
        name: orders-worker
        state: started
        enabled: true
```

That gives the team one `site.yml` entry point with separate plays for separate parts of the system. A reviewer can see which hosts receive Nginx, which hosts receive the worker service, and where service restarts can happen. The structure also supports progressive rollout because the operator can target one host, one group, or the full inventory.

## Running the Playbook Safely
<!-- section-summary: Safe execution starts with syntax checks, target checks, check mode, diff mode, and small limits before a full production run. -->

The first safety step happens before Ansible touches a production host. A syntax check catches YAML and playbook parsing mistakes. It proves the playbook can be parsed and catches broken indentation, missing colons, and invalid playbook shape early.


![Safe Run Command Loop](/content-assets/articles/article-infrastructure-as-code-ansible-playbook-structure/safe-run-command-loop.png)

*The run loop turns syntax checks, check mode, limits, apply, recap reading, and reruns into one safe operating path.*

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --syntax-check
```

The next check proves the host pattern matches the intended machines. This matters because a typo in inventory or a broad host pattern can send a play to the wrong group. For a canary web deploy, the operator can list the targets before the real run.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-01.example.com --list-hosts
```

For file and package changes, check mode and diff mode give useful rehearsal output. Check mode asks supported modules what they would change. Diff mode shows before-and-after details for modules that support diffs, especially file and template modules.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-01.example.com --check --diff
```

After those checks, the canary run applies the playbook to one host. If the service passes health checks, the team can run the same playbook against the rest of the group. The important habit is keeping the command narrow until the evidence says the change is safe to widen.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-01.example.com
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders_web
```

In Red Hat Ansible Automation Platform or another controller, the same ideas usually become job templates, inventories, credentials, survey inputs, and approval flows. The underlying playbook shape stays the same. The controller adds audit records, scheduling, role-based access, and a central place to review output.

## Handlers, Blocks, and Roles
<!-- section-summary: Larger playbooks use handlers for delayed service actions, blocks for grouped control, and roles for reusable service structure. -->

A **handler** is a task that runs after another task notifies it. Handlers are commonly used for service reloads and restarts because they prevent repeated restarts during one play. If three template tasks notify the same handler, Ansible can run that handler once at the end of the play.

That behavior helps the orders API. The service should restart after its configuration changes. It should stay quiet when the rendered file already matches the host. A handler ties the restart to the changed signal from the template task, so the playbook output stays meaningful.

A **block** groups related tasks and lets the playbook apply shared options or error handling to the group. For example, a deploy block can render config, validate it, and reload the service. A `rescue` section can collect logs or restore a previous file when validation fails.

```yaml
- name: Deploy orders API configuration
  block:
    - name: Render candidate orders API configuration
      ansible.builtin.template:
        src: orders-api.yml.j2
        dest: /etc/orders-api/config.yml
        mode: "0640"
      notify: Restart orders API

    - name: Validate orders API configuration
      ansible.builtin.command: orders-api --check-config /etc/orders-api/config.yml
      changed_when: false
  rescue:
    - name: Show recent orders API logs after validation failure
      ansible.builtin.command: journalctl -u orders-api -n 50 --no-pager
      changed_when: false
```

The rescue section should gather safe evidence and take narrow recovery actions. It can collect logs, restore a backup file, or leave the host out of a load balancer pool. It should avoid hiding the failure. A rescued task still needs a human or pipeline decision about whether the rollout should continue.

A **role** packages tasks, defaults, templates, files, and handlers into a reusable directory. A team might start with one playbook file while learning. As the orders API grows, moving the web setup into a role gives the playbook a smaller surface:

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  roles:
    - role: orders_api_web
```

The role can carry the install tasks, templates, handlers, and default variables. The playbook still answers the operational question: which hosts receive this role, and in what order does the rollout happen.

## Common Failures and Safe Rollback
<!-- section-summary: Operators debug playbooks by separating parse errors, target mistakes, connection failures, module failures, and application rollback. -->

Playbook failures usually fall into a few plain categories. A syntax error means YAML or playbook parsing failed. A target mistake means the host pattern matched zero hosts or more hosts than expected. A connection failure appears as `unreachable`, which points to SSH, credentials, host keys, DNS, network paths, or inventory addresses. A module failure means Ansible reached the host and the task logic failed there.

For the orders platform, a failed package task might point to a repository problem. A failed template task might point to a missing variable or a file permission problem. A failed validation command might point to a bad application config. Those are different repairs, so the operator should start from the failed task name and the host status instead of treating the whole run as one generic error.

Rollback should be planned before the first production run. Ansible applies the state described in the current repository checkout, so a common rollback is to revert the template, variables, or role change in Git and run the playbook again against a canary host. For application releases, keep the release version in a variable such as `orders_api_release`, then roll back by passing or restoring the previous approved version through the same playbook path.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-01.example.com -e orders_api_release=2026.06.12
```

Some changes need extra care. Database migrations, destructive file removal, and firewall changes may need backups, maintenance windows, or separate approval. A playbook can automate those operations, and the team still needs a recovery path that has been tested on staging.

## Putting It All Together
<!-- section-summary: A healthy playbook keeps host selection, task intent, module behavior, and operational safety visible in one reviewed file. -->

The orders platform now has a clear Ansible shape. Inventory names the web and worker hosts. Plays select those groups. Tasks call modules with structured arguments. Templates turn variables into service configuration. Handlers restart services only after meaningful changes. Roles can package the repeated service setup when the playbook grows.


![Playbooks Summary](/content-assets/articles/article-infrastructure-as-code-ansible-playbook-structure/playbooks-summary.png)

*The summary follows the practical playbook sequence: read, target, change, notify, verify, and roll back.*

This structure gives operators a practical workflow. They can check syntax, list target hosts, rehearse with check and diff mode, run a canary, review output, and then widen the run. If something fails, the task name and host status point to the right layer of the problem.

Playbooks are the part people review and run, so they should read like a careful operations plan. The next article focuses on the behavior that makes repeated runs safe: idempotency.

## What's Next

The next article follows the same orders platform and looks at repeated runs. It explains why `changed` should mean the host actually moved, why command tasks need guards, and how a second run can prove that the playbook has settled.

---

**References**

- [Ansible playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_intro.html) - Official introduction to playbook structure, plays, tasks, execution order, FQCN guidance, check mode, and verification options.
- [Working with playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks.html) - Official guide for templates, handlers, blocks, conditionals, roles, and other playbook features.
- [Reusing Ansible artifacts](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse.html) - Official guidance on roles, task files, playbook imports, includes, and reusable automation structure.
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html) - Official handler behavior and notification guidance.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official details for `--check`, `--diff`, and task-level check or diff behavior.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official CLI reference for playbook execution, listing, limiting, syntax checks, and verbosity.
