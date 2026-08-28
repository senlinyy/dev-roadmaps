---
title: "What Is Ansible?"
description: "Learn Ansible from first principles: control nodes, inventory, playbooks, tasks, modules, desired state, variables, templates, handlers, facts, roles, and safe operations."
overview: "Ansible turns an operator's intent for classes of systems into repeatable remote operations. This article builds the complete mental model, from agentless control-node execution and inventory targeting to idempotent modules, reusable roles, orchestration, drift repair, safety controls, and the limits of the abstraction."
tags: ["ansible", "configuration-management", "automation", "playbooks", "idempotency"]
order: 1
id: article-cloud-iac-infrastructure-as-code-config-mgmt-ansible
aliases:
  - config-mgmt-ansible
  - infrastructure-as-code/ansible/config-mgmt-ansible.md
  - cloud-iac/infrastructure-as-code/config-mgmt-ansible.md
  - child-infrastructure-as-code-config-mgmt-ansible
---

## Table of Contents

1. [What Problem Does Ansible Solve?](#what-problem-does-ansible-solve)
2. [How Do the Control Node, Inventory, and Managed Nodes Work Together?](#how-do-the-control-node-inventory-and-managed-nodes-work-together)
3. [How Do Playbooks, Tasks, and Modules Express Desired State?](#how-do-playbooks-tasks-and-modules-express-desired-state)
4. [How Do Variables, Templates, and Handlers Make Automation Reusable?](#how-do-variables-templates-and-handlers-make-automation-reusable)
5. [How Do Facts, Conditions, Loops, Roles, and Collections Extend the Model?](#how-do-facts-conditions-loops-roles-and-collections-extend-the-model)
6. [What Actually Happens During an Ansible Run?](#what-actually-happens-during-an-ansible-run)
7. [How Does Ansible Differ from Other Automation Tools?](#how-does-ansible-differ-from-other-automation-tools)
8. [How Do You Operate Ansible Safely in Production?](#how-do-you-operate-ansible-safely-in-production)
9. [Check Your Answers](#check-your-answers)

Imagine operating one hundred Linux servers. Every web server should have Nginx installed, a reviewed configuration, a running service, and the same security baseline. Manual commands can make one machine correct, but they do not reliably answer which machines were missed, which command failed halfway, whether rerunning is safe, or how to review the procedure before it reaches production.

The fundamental operations problem is not that one server is difficult to configure. It is that the same intended condition must hold across changing fleets and over time:

```text
web servers
    Nginx package installed
    approved config present
    service enabled and running

database servers
    database package installed
    storage mounted
    backup schedule installed

all Linux servers
    approved users and SSH policy
    monitoring agent running
    security updates applied
```

A shell script can run commands, but a production automation system also needs target selection, connection handling, reusable operations, structured results, variable resolution, conditional behavior, secrets, privilege escalation, and controlled concurrency.

Keep these questions in view as you work through the lesson:

1. **What Problem Does Ansible Solve?**
2. **How Do the Control Node, Inventory, and Managed Nodes Work Together?**
3. **How Do Playbooks, Tasks, and Modules Express Desired State?**
4. **How Do Variables, Templates, and Handlers Make Automation Reusable?**
5. **How Do Facts, Conditions, Loops, Roles, and Collections Extend the Model?**
6. **What Actually Happens During an Ansible Run?**
7. **How Does Ansible Differ from Other Automation Tools?**
8. **How Do You Operate Ansible Safely in Production?**

## What Problem Does Ansible Solve?
<!-- section-summary: Ansible applies repeatable intent across groups of systems so teams can review, rerun, and verify operations instead of maintaining manual command histories. -->

Ansible's central translation is:

```text
human intent about a class of machines
        |
        v
inventory selects concrete hosts
        |
        v
playbook describes ordered work
        |
        v
modules inspect and change remote state
        |
        v
structured results show ok, changed, failed, or unreachable
```

Teams reach for Ansible because it is readable, works across many systems, and can begin with existing remote access. It is often used for operating-system configuration, application deployment, patching, security remediation, network automation, and multi-system operational workflows.

Ansible is mostly an orchestration engine. It coordinates operations in a chosen order across selected systems. Configuration management is one major use, but the same engine can drain a server from a load balancer, deploy an application, verify health, and return the server to service.

The automation is normally **push-based**. A control node starts a run and connects to managed nodes. Ansible does not continuously reconcile every system after the command ends. If a person changes a file tomorrow, the machine stays drifted until another Ansible run or another controller repairs it.

This execution model makes timing explicit. A run has a beginning, a selected scope, ordered tasks, results, and an end. That fits scheduled configuration enforcement, releases, maintenance, and incident procedures. It differs from a resident controller that continuously watches desired state.

Configuration drift explains why repeatability matters. A server may begin correct and later diverge because of a manual edit, package update, failed experiment, or replacement from an old image. A reviewed playbook gives the team a known route back to the intended condition. Running it on a schedule can detect and repair drift, while a check-mode run can report likely divergence without changing supported resources.

The same automation also reduces differences created by memory. A runbook written as prose may say “configure Nginx,” leaving file locations, ownership, commands, and failure behavior to the operator. A playbook makes those choices concrete. Git then records changes to the runbook alongside the reason and reviewer.

Ansible does not require the whole organization to adopt one large platform on day one. A team can start with a single inventory and a few modules, then add variables, roles, tests, CI, dynamic inventory, and an automation controller as scope grows. The conceptual model stays the same.

The cost of that accessibility is that YAML can make powerful operations look deceptively simple. A three-line task can delete a file from hundreds of hosts. Safe Ansible work treats target selection, privilege, concurrency, and verification as part of the program rather than as optional operator habits.

The intended system is not only the files on a host. It includes service state, users, permissions, packages, scheduled jobs, network devices, cloud API objects, and the ordered relationships between them. Ansible is useful when that intent can be decomposed into understandable tasks with observable outcomes.

## How Do the Control Node, Inventory, and Managed Nodes Work Together?
<!-- section-summary: The control node interprets automation, inventory names and groups the targets, and Ansible connects agentlessly to managed nodes. -->

The core model has four pieces:

1. A **control node** runs Ansible.
2. **Managed nodes** are the systems Ansible operates.
3. An **inventory** describes and groups those targets.
4. Playbooks or ad-hoc commands describe the requested automation.

```text
control node
    inventory + playbook + variables + credentials
            |
            v
     connection transport
            |
      +-----+-----+
      v           v
 managed host  managed host
```

The control node can be an operator workstation, CI runner, or automation controller. It loads project configuration, resolves plugins and collections, evaluates inventory and variables, connects to each selected host, transfers or invokes module code, and collects results.

Managed nodes usually do not run a permanent Ansible agent. For Linux and Unix-like hosts, Ansible commonly uses SSH and a Python runtime. For Windows it can use WinRM or related connection methods. Network devices and cloud APIs use plugins suited to their interfaces. “Agentless” means no always-running Ansible daemon is required on the target; it does not mean no prerequisites or credentials exist.

Inventory gives stable automation identities to changing endpoints:

```ini
[web]
web01.example.com
web02.example.com
web03.example.com

[database]
db01.example.com
db02.example.com

[production:children]
web
database
```

Grouping matters because operations usually target classes rather than hand-maintained host lists. A baseline play can target `production`; a web deployment can target `web`; a canary can limit the same play to `web01.example.com`.

Inventory can be static files or dynamic plugins. Static inventory is reviewable and fits stable fleets. Dynamic inventory queries a cloud, CMDB, or another source so hosts and groups follow changing infrastructure. In both cases, inspect the resolved inventory before running:

```bash
ansible-inventory -i inventory.yml --graph
ansible-inventory -i inventory.yml --host web01.example.com
```

Inventory variables can describe connection details and environment data. `ansible_host` can hold the real IP while `inventory_hostname` remains a meaningful stable name. `ansible_user`, ports, connection types, and privilege settings influence how the control node reaches the host.

Connection success is a chain, not a single fact:

```text
host selected
    -> name or address resolves
    -> network path works
    -> transport authenticates
    -> remote runtime supports module execution
    -> privilege escalation succeeds when required
```

An ad-hoc ping is a useful first check:

```bash
ansible -i inventory.yml web -m ansible.builtin.ping
```

This is not ICMP ping. It verifies that Ansible can connect and execute the small module through the configured transport.

Inventory patterns are a query language over this map. `web` selects one group, `web:&production` intersects two groups, and `production:!database` excludes database hosts. The playbook states its broad intended audience; `--limit` can narrow a particular run but cannot add hosts outside the play's pattern.

Groups may be children of larger groups, and a host can belong to several groups. That is useful for orthogonal classifications such as environment, role, location, and rollout cohort. Sibling groups that define the same key can also create ambiguity in variable resolution. Prefer a clear data model and inspect effective host variables rather than assuming file proximity wins.

Static YAML inventory can separate a stable alias from a current endpoint:

```yaml
all:
  children:
    web:
      hosts:
        web01:
          ansible_host: 10.20.1.11
        web02:
          ansible_host: 10.20.1.12
```

Play output uses `web01` and `web02`, so rebuilds can change addresses without changing the names operators use in logs and limits. Inventory names should be unique and durable enough to serve as automation identity.

Dynamic inventory moves accuracy to upstream metadata. If a cloud plugin creates groups from tags, those tags become part of the production targeting boundary. A mistagged instance can join a deployment group. Review tag governance, plugin filters, authentication, caching, and the resolved graph before widening a run.

The control node also needs dependencies. Ansible Core, collections, roles, Python libraries, SSH clients, and credential helpers can all affect execution. Version requirements and a repeatable environment prevent one operator's workstation from silently resolving different modules than CI.

Managed-node prerequisites vary. Many POSIX modules need Python, while `raw` can help bootstrap a host that does not yet have it. Windows modules use PowerShell-based mechanisms. Network modules may execute locally against device APIs rather than transfer normal Linux code. “Agentless” describes architecture, not one universal transport.

## How Do Playbooks, Tasks, and Modules Express Desired State?
<!-- section-summary: A play maps hosts to ordered tasks, and modules provide state-aware operations that report whether they changed anything. -->

A **playbook** is a YAML document containing one or more plays. A **play** connects a host pattern to an ordered task list. A **task** invokes a module with arguments.

```yaml
---
- name: Configure web servers
  hosts: web
  become: true

  tasks:
    - name: Install Nginx
      ansible.builtin.package:
        name: nginx
        state: present

    - name: Enable and start Nginx
      ansible.builtin.service:
        name: nginx
        enabled: true
        state: started
```

The first task uses the package module. The second uses the service module. Fully qualified collection names such as `ansible.builtin.package` make the module source clear.

Modules are Ansible's actual tools. Common modules manage files, packages, services, users, templates, cloud resources, network devices, and commands. They accept structured arguments and return structured results.

```yaml
- name: Create application directory
  ansible.builtin.file:
    path: /opt/application
    state: directory
    owner: app
    group: app
    mode: "0750"

- name: Ensure deployment user exists
  ansible.builtin.user:
    name: deploy
    state: present
```

State-aware modules are preferable to blindly running shell commands because they can inspect the current system, calculate whether a change is needed, support check mode where implemented, and report `changed` accurately.

That leads to **idempotency**: running the same desired-state task again should leave a compliant machine unchanged.

```text
first run
    package absent -> install -> changed

second run
    package present -> no action -> ok
```

Imperative automation says which command to execute:

```yaml
- name: Install Nginx with a command
  ansible.builtin.command: apt-get install -y nginx
```

Declarative module use states the intended condition:

```yaml
- name: Keep Nginx installed
  ansible.builtin.apt:
    name: nginx
    state: present
```

Commands are sometimes necessary, but they start with less state awareness. `creates`, `removes`, `changed_when`, `failed_when`, and explicit prechecks can make them safer. Prefer a purpose-built module when one represents the operation.

Order still matters. Tasks within a play run in written order for each scheduling batch. Declarative modules reduce unnecessary changes; they do not make every ordering interchangeable. A configuration file should normally exist before the service that reads it is restarted.

Module return data explains idempotency in practice. A task can report `changed: false` after observing that the desired condition already holds. That signal drives handlers, run summaries, and CI decisions. A task that always reports changed makes every run noisy and can cause unnecessary restarts even if its command happens to be harmless.

Package modules show abstraction tradeoffs. `ansible.builtin.package` provides a common interface across package managers, while distribution-specific modules expose additional features. Use the general module when the portable contract is enough and the specific module when platform behavior matters. Conditions can select distinct implementations without hiding the difference.

File operations also have distinct semantics. `copy` sends a static file from the control side. `template` renders Jinja2 before writing. `file` manages metadata and presence. `lineinfile`, `blockinfile`, and `replace` make narrow edits when Ansible does not own the whole file. Choosing the correct ownership boundary is part of desired-state design.

Commands require explicit interpretation. A read-only command such as `application --version` should normally set `changed_when: false`. A migration command may use `creates` as evidence it has already completed. A tool returning a special exit code can use `failed_when` to translate domain behavior into Ansible success or failure.

```yaml
- name: Read current version
  ansible.builtin.command: application --version
  register: version_result
  changed_when: false
  failed_when: version_result.rc not in [0, 1]
```

Idempotency is a contract between module implementation, task arguments, and the remote system. A module cannot prevent an external process from immediately changing the same field. Clear ownership avoids two controllers repeatedly overwriting one another.

## How Do Variables, Templates, and Handlers Make Automation Reusable?
<!-- section-summary: Variables separate environment data from behavior, templates render configuration, and handlers react once to meaningful change. -->

Hardcoded automation works for one machine. Variables let one procedure adapt to hosts and environments:

```yaml
- name: Configure application
  hosts: app
  vars:
    app_port: 8080
    app_environment: production

  tasks:
    - name: Create application directory
      ansible.builtin.file:
        path: "{{ app_config_dir }}"
        state: directory
```

Variables can come from role defaults, inventory group and host variables, play variables, included files, facts, registered task results, or extra variables. Precedence determines which definition wins. Stable environment data normally belongs in inventory; reusable defaults belong in roles; one-run release values may come from a controlled deployment job.

Jinja2 expressions insert or transform values. If the whole YAML value is an expression, quoting it avoids YAML parsing ambiguity:

```yaml
path: "{{ app_config_dir }}"
```

Templates turn variables into full configuration files. A Jinja2 template might contain:

```jinja2
server {
    listen {{ app_port }};
    server_name {{ app_hostname }};
}
```

The template module renders it on the managed host:

```yaml
- name: Render Nginx configuration
  ansible.builtin.template:
    src: application.conf.j2
    dest: /etc/nginx/conf.d/application.conf
    owner: root
    group: root
    mode: "0644"
  notify: Restart Nginx
```

A **handler** is a task notified by a changed task. It normally runs once at the end of the relevant play section, even if several tasks notify it:

```yaml
handlers:
  - name: Restart Nginx
    ansible.builtin.service:
      name: nginx
      state: restarted
```

If the rendered content already matches, the template reports `ok`, sends no notification, and the service is not restarted. If the file changes, the handler runs. That connects operational disruption to real configuration change.

The combined flow is:

```text
inventory and role variables
    -> template render
    -> compare destination content
    -> changed only when content differs
    -> notify handler
    -> restart once
```

Templates should validate risky configuration when a module supports it. File ownership and modes are part of desired state. Secret values need Vault or another protected input path, and tasks that could print them require `no_log` boundaries.

Clear variable names matter in large playbooks. Prefix role variables such as `nginx_app_port` instead of using generic names like `port`. Validate required values with assertions so a missing environment setting fails before a partially rendered deployment.

Variable resolution happens per host. Two hosts in the same play can render different files because their group membership, host variables, or facts differ. This is a powerful way to express legitimate variation, but it means debugging must inspect the effective value for the failing host.

Role defaults should be safe and unsurprising, not hidden production policy. A default such as `web_service_enabled: true` may be reasonable; a production database endpoint normally belongs in environment inventory. Extra variables have very high precedence and can override many sources, so use them for intentional run-specific inputs rather than making routine production correctness depend on remembered `-e` flags.

Templates are code. Filters, conditionals, and loops can make one template render many shapes. Keep the data model clear, test representative combinations, and use the module's `validate` option when a daemon provides a syntax checker. An invalid file should fail before replacing the known-good destination.

Handler timing matters. Notifications are queued and handlers normally run after regular tasks in the play section. `meta: flush_handlers` can force them earlier when later tasks require the restarted service, but it changes failure behavior and should be explicit. A later task failure can otherwise prevent a queued handler, depending on execution conditions.

Multiple notifications with the same handler name collapse into one run. Handler `listen` topics let several handlers respond to one logical event. Names form part of the role interface, so use descriptive action-oriented names such as `Restart Nginx` rather than generic `Restart service`.

If a template contains secret variables, diff output and task results can expose rendered content. Vault encrypts stored values, not the file after rendering on the managed node. Destination modes, ownership, service access, backup behavior, and `no_log` still matter.

## How Do Facts, Conditions, Loops, Roles, and Collections Extend the Model?
<!-- section-summary: Facts and results provide runtime data, conditions and loops adapt tasks, and roles and collections package reusable automation. -->

Ansible can gather **facts** about a managed node before tasks run: operating system, interfaces, memory, architecture, and more. Facts let one play adapt to heterogeneous hosts:

```yaml
- name: Install distribution-specific package
  ansible.builtin.package:
    name: "{{ 'httpd' if ansible_facts.os_family == 'RedHat' else 'nginx' }}"
    state: present
```

Conditions use `when` to decide whether a task applies:

```yaml
- name: Configure production monitoring
  ansible.builtin.include_tasks: monitoring.yml
  when: environment == "production"
```

The expression is not wrapped in `{{ }}` in a `when` clause because the field already expects an expression. Conditions can use variables, facts, and registered results.

Loops apply one task shape to a collection:

```yaml
- name: Install required packages
  ansible.builtin.package:
    name: "{{ item }}"
    state: present
  loop:
    - nginx
    - curl
    - ca-certificates
```

Each loop iteration returns its own result. Prefer passing a list directly to a module when the module can handle the whole collection efficiently; use a loop when each item needs separate logic or reporting.

A **role** packages a reusable automation unit into conventional directories:

```text
roles/web/
├── defaults/main.yml
├── files/
├── handlers/main.yml
├── tasks/main.yml
├── templates/
└── vars/main.yml
```

Role defaults provide low-precedence caller-friendly values. Tasks implement the behavior. Templates and files provide assets. Handlers respond to change. Role variables are stronger and should be used deliberately because they are harder for callers to override.

```yaml
- name: Configure web tier
  hosts: web
  become: true
  roles:
    - role: web
```

Collections package modules, plugins, roles, and playbooks under namespaces such as `ansible.builtin` or `community.general`. They make dependencies explicit. A project should declare collection and role versions so another control node can reproduce the run.

Registered results connect one task to later logic:

```yaml
- name: Read application version
  ansible.builtin.command: application --version
  register: app_version
  changed_when: false

- name: Upgrade old application
  ansible.builtin.include_tasks: upgrade.yml
  when: expected_version not in app_version.stdout
```

The output structure includes status, return code, stdout, stderr, timing, and loop results according to the module. Inspect it before assuming a field exists.

Facts have a cost. Gathering all facts connects to every selected host and collects a broad data set before normal tasks. Plays that do not need facts can use `gather_facts: false`; plays needing only a subset can invoke `setup` with filters. Removing fact gathering also removes variables that roles may assume, so make dependencies explicit.

Facts describe observed machine properties, while inventory variables describe intended or organizational data. An IP address reported by the host and a region assigned by inventory have different authorities. Avoid overwriting fact-like names with custom values that make readers unsure whether the data was discovered or declared.

Conditions are evaluated for each host. One host may skip a task while another changes. The recap's `skipped` count is therefore expected in adaptable playbooks. A skip should have a readable reason in verbose output, and critical prerequisites should fail with an assertion rather than silently skip all work.

Loops change result shape. A registered loop result contains a `results` list whose items include the original item and per-iteration status. Later conditions should inspect that structure. Failure behavior can be controlled, but ignoring one item failure without recording it can leave partially configured hosts.

Roles can declare dependencies and argument specifications. Dependencies run other roles before the current role; use them for genuine reusable prerequisites rather than hiding the play's architecture. Argument validation documents and enforces the role's public inputs. Tests should invoke roles through representative plays instead of testing private task files in isolation.

Collections need version management because module behavior can change. A `requirements.yml` file records sources and versions, and CI installs them into a clean environment. Fully qualified names prevent a short module name from resolving to an unexpected collection after dependencies change.

Includes and imports provide dynamic and static reuse. Dynamic includes can depend on runtime conditions and loops; static imports are expanded earlier and affect tag and syntax behavior differently. Choose according to when the structure needs to be known and keep the resulting run graph understandable.

## What Actually Happens During an Ansible Run?
<!-- section-summary: A run loads configuration, resolves hosts and per-host variables, connects, executes modules in scheduled order, and aggregates structured results. -->

When you run:

```bash
ansible-playbook -i inventory.yml site.yml
```

Ansible performs several stages.

**1. Load configuration and dependencies.** It reads `ansible.cfg`, the playbook, inventories, roles, collections, plugins, and command-line options. Configuration precedence decides which settings apply.

**2. Resolve target hosts.** Each play's `hosts` pattern is evaluated against inventory. Command-line `--limit` intersects that set. If the resolved set is wrong, correct it before any mutation.

**3. Resolve variables per host.** Hosts in the same play may receive different values through group membership, host variables, facts, role defaults, or registered data. Ansible's variable model is host-oriented.

**4. Establish connections.** The control node uses the selected connection plugin and credentials. `become` may elevate privileges for a task after login.

**5. Execute modules.** Ansible schedules tasks according to its strategy, forks, and play settings. On typical Linux targets it transfers or invokes module code through the remote runtime, then cleans temporary artifacts.

**6. Collect structured results.** Each host reports fields used to classify the task as `ok`, `changed`, `failed`, `unreachable`, or `skipped`. The final recap aggregates host outcomes.

There are two execution sides:

```text
control side
    repository files, inventory plugins, Vault identities,
    CI environment, local lookups, orchestration logic

managed side
    packages, files, services, commands, remote facts,
    host privileges and runtime dependencies
```

Most tasks run on the current managed host. `delegate_to` can run a task somewhere else, and `connection: local` or `delegate_to: localhost` runs it on the control node. That location affects filesystem paths, credentials, network reachability, and security boundaries.

By default, Ansible can work across several hosts in parallel. Tasks are ordered, but the fleet is not always processed one host from start to finish. `serial` creates batches for controlled rollout. `throttle` limits a particular task. Strategy and fork settings affect concurrency.

Ad-hoc commands use the same inventory, connection, and module ideas for one-off actions:

```bash
ansible -i inventory.yml web -m ansible.builtin.service \
  -a "name=nginx state=started" --become
```

They are useful for diagnosis and bounded operations. Repeatable production procedures belong in playbooks so they are reviewed, versioned, and testable.

The result vocabulary should be read precisely. `ok` means the module completed without reporting a change. `changed` means it believes remote state was modified. `failed` means module execution completed with a failure for that host. `unreachable` means Ansible could not establish the execution path. `skipped` means a condition or other control intentionally omitted the task.

A green recap is not full service verification. A package can install and a process can start while users still receive errors. Add checks at the correct boundary: local configuration validation, local service health, load-balancer membership, an external request, or monitoring signals.

Ansible's default linear strategy generally advances tasks while operating on several hosts up to the fork limit. A slow host can influence progress. The free strategy allows hosts to advance more independently. These choices affect rollout ordering and should not be changed casually for stateful or load-balanced systems.

Delegation preserves the current inventory host's context while running the task somewhere else. This is useful for telling a load-balancer controller to drain the host currently being configured. `run_once` limits how often a task is scheduled, but under batches it can have nuanced behavior; global actions deserve an explicit play on localhost when clarity matters.

Temporary remote files, pipelining, SSH multiplexing, and privilege methods affect performance and security. Most users rely on defaults at first. Production control nodes should document non-default connection behavior and protect caches, sockets, and temporary directories that may carry sensitive execution material.

Callbacks turn structured results into human or machine output. CI can preserve a run record or send events to monitoring. Avoid callback plugins that print sensitive arguments or environment variables, and pin callback dependencies like any other execution plugin.

## How Does Ansible Differ from Other Automation Tools?
<!-- section-summary: Ansible specializes in push-based configuration and orchestration, while shells, Terraform, containers, and Kubernetes operate at different abstraction and reconciliation boundaries. -->

Ansible and shell scripts overlap, but their default abstractions differ. A shell script primarily executes commands and interprets exit codes. Ansible adds inventory targeting, connection plugins, variables, idempotent modules, handlers, structured results, check mode, tags, batching, and reusable packaging.

Use shell or command tasks when the operation truly has no module and make change and failure semantics explicit. Do not wrap every shell line in YAML and assume it gained idempotency.

Terraform primarily manages infrastructure resources through provider APIs and persistent state. Ansible primarily orchestrates operations and configures systems through inventory and connections.

```text
Terraform
    cloud network, VM, load balancer, managed database,
    resource graph and state ownership

Ansible
    packages, OS files, users, service configuration,
    deployments and cross-system operational sequences
```

They can complement each other: Terraform creates servers and outputs connection information; inventory discovers them; Ansible configures the operating systems and applications. Keep ownership clear so both tools do not fight over the same field or object.

Docker packages an application and its dependencies into an image with a runtime model. Ansible can install Docker, configure a host, distribute configuration, and start containers, but a playbook is not a container image.

Kubernetes is a continuous orchestration system for containerized workloads. Controllers reconcile desired objects, reschedule Pods, and maintain replicas. Ansible can configure cluster hosts or invoke Kubernetes APIs, but a completed playbook does not continuously watch workloads.

Ansible is not only for Linux servers. Collections and plugins can manage Windows, network devices, cloud services, APIs, and other systems. The agentless connection and module execution method changes by platform.

It is not always the best abstraction. Prefer a continuous controller when a platform needs constant reconciliation, a programming language for complex algorithms and rich data structures, Terraform for primary infrastructure-state ownership, and application code for application business logic.

The most important distinction is:

```text
Ansible describes and orchestrates operations toward desired conditions
when a run is invoked.

It does not guarantee those conditions remain true forever after the run.
```

Scheduled runs and CI can regularly detect and repair drift, but that is an operating policy built around Ansible, not a permanent agent inherent in each host.

Configuration management asks that hosts converge on intended packages, files, users, and services. Application deployment asks that a particular build reaches targets in a safe order. Orchestration coordinates several systems, such as load balancer, application fleet, and database. Provisioning creates or removes infrastructure resources. Ansible can participate in all four, but the ownership and verification model differs.

For long-lived cloud infrastructure with complex dependency graphs and shared state, Terraform often provides a clearer primary ownership model. Ansible cloud modules are useful for orchestration and bounded resource operations, but using two tools to own the same resource creates drift loops. Decide which system is authoritative.

For high-frequency application releases, a dedicated deployment platform may offer stronger rollout, artifact, and health semantics. Ansible remains useful when the release includes operating-system or cross-system work, or when the environment does not have a continuous scheduler.

For Kubernetes workloads, a Deployment controller continuously restores replica count and rolls Pods. An Ansible play can apply manifests, but it should not imitate the controller by manually managing individual Pods. Use Ansible around the platform boundary, not against the controller's ownership model.

For complex computation, Python or another programming language offers clearer functions, data structures, testing, and exception models than deeply nested YAML. Ansible modules and plugins themselves can be implemented in code, while playbooks stay focused on orchestration.

The choice is not a contest. A production system can use Terraform for cloud foundations, image builds for immutable artifacts, Kubernetes for continuous workload reconciliation, and Ansible for host configuration and operational workflows. The important design question is where each tool's authority begins and ends.

## How Do You Operate Ansible Safely in Production?
<!-- section-summary: Production safety combines versioned automation, target proof, preview, canaries, controlled batches, verification, secret boundaries, and recovery plans. -->

Automation increases both power and blast radius. A production runbook should prove its scope and assumptions before mutation.

Use syntax and static checks, then preview where modules support it:

```bash
ansible-playbook -i inventories/prod site.yml --syntax-check
ansible-playbook -i inventories/prod site.yml --check --diff
```

Check mode predicts supported changes without applying them. It is not a perfect simulation: command tasks, dynamic runtime values, and modules with incomplete check support can behave differently. Diff mode can expose file content, including secrets, so protect its output.

Verify host scope:

```bash
ansible-playbook -i inventories/prod site.yml --list-hosts
ansible-playbook -i inventories/prod site.yml --limit web01.example.com --check --diff
```

Run a representative canary first, verify service behavior, then widen through controlled batches. `serial` preserves capacity during fleet changes. Tags select parts of a playbook; limits select hosts. Both are useful and neither should hide required prerequisites.

Privilege escalation should be explicit:

```yaml
- name: Configure web servers
  hosts: web
  become: true
```

Use an unprivileged connection identity and elevate only for tasks that require it when practical. Protect become credentials and verify escalation separately from connectivity.

Secrets belong in Ansible Vault, an external secret manager, or another controlled path—not plaintext inventory or logs. `no_log: true` can suppress a sensitive task's result, but it also hides diagnostics and does not protect earlier value sources or later debug tasks.

Error handling can use blocks, rescue tasks, `any_errors_fatal`, and failure thresholds. Design stop behavior before deployment. A failed canary should stop expansion. A failed host in a load-balanced batch may need to remain drained. Rollback can require another idempotent play, a previous package version, traffic reversal, or a separate data-recovery procedure.

A production repository can look like:

```text
ansible/
├── ansible.cfg
├── collections/requirements.yml
├── inventories/
│   ├── staging/
│   └── production/
├── playbooks/
│   ├── site.yml
│   └── deploy.yml
└── roles/
    ├── baseline/
    └── web/
```

Git history records who changed automation, why, and which revision was deployed. CI can lint, test, preview, and run protected deployments from a controlled node.

The complete small example is:

```ini
[web]
web01.example.com
web02.example.com
```

```yaml
---
- name: Keep web service configured
  hosts: web
  become: true

  tasks:
    - name: Install Nginx
      ansible.builtin.package:
        name: nginx
        state: present

    - name: Render site configuration
      ansible.builtin.template:
        src: site.conf.j2
        dest: /etc/nginx/conf.d/site.conf
        mode: "0644"
      notify: Restart Nginx

    - name: Enable and start Nginx
      ansible.builtin.service:
        name: nginx
        enabled: true
        state: started

  handlers:
    - name: Restart Nginx
      ansible.builtin.service:
        name: nginx
        state: restarted
```

Run it:

```bash
ansible-playbook -i inventory.ini web.yml
```

The first run may install, render, start, and restart. The second run should mostly report `ok`. If someone later edits one host's file, a new run detects the difference, restores the template, and notifies the handler. This is drift repair when the automation is invoked.

Manage classes of machines rather than handcrafted individuals. Inventory defines membership, variables describe legitimate differences, roles define reusable behavior, and results show whether the fleet converged. Human-readable YAML helps review, but readability is not a substitute for testing or cautious rollout.

Tags can select subsets of tasks:

```bash
ansible-playbook -i inventories/prod site.yml --tags nginx
```

This is useful for diagnosis and deliberate partial procedures, but tags can skip prerequisites. Design roles so common tagged entry points remain coherent, and use `--list-tags` before relying on an unfamiliar subset. Host limits and task tags answer different questions: where should the play run, and which parts should run there?

Error handling should preserve truth. `ignore_errors: true` allows later tasks after a failure but does not make the failed condition safe. `failed_when` should translate expected domain outcomes, not suppress inconvenient errors. A `rescue` block can restore local conditions, record evidence, or keep a failed node out of rotation; it does not automatically undo every preceding side effect.

For fleet operations, `serial` can express percentages or a sequence of batch sizes. A canary of one host followed by larger batches progressively reduces uncertainty. `max_fail_percentage` and `any_errors_fatal` define stop behavior, but health checks and capacity thresholds still need operational meaning.

Check mode support is per module and task. A command may skip because it cannot predict, and a later task may lack the value the command would have registered. Treat preview as evidence about supported tasks, not a complete alternate execution. Diff output is most valuable for files and templates, while sensitive content may require disabling it for selected tasks.

Infrastructure as code means the automation, inventory structure, role dependencies, and policy are represented in reviewable source. It does not mean every runtime secret or discovered host belongs in Git. Store durable intent in code and obtain dynamic or confidential values through their proper systems.

The deepest architecture has three layers:

```text
classification
    inventory answers which systems belong to which groups

desired procedure
    playbooks, roles, variables, and modules answer what should happen

execution evidence
    results and verification answer what actually happened this run
```

Keeping those layers separate makes incidents easier to reason about. A wrong host is an inventory or limit problem. A wrong setting is a variable or task problem. An unreachable machine is a connection problem. A healthy Ansible recap with a broken service is a verification gap.

The first-principles definition is: Ansible is a control-node-driven automation and orchestration system that selects managed targets through inventory, evaluates per-host data, and invokes modules through connection plugins to move systems toward intended conditions. Its power comes from combining readable procedures with state-aware tools; its safety comes from proving scope, preserving idempotency, controlling privilege and concurrency, and verifying the real service after the run.

Several use cases fit this definition particularly well. An operating-system baseline can manage users, SSH settings, packages, time synchronization, audit configuration, and a monitoring agent across several distributions. A patching play can refresh package metadata, apply approved updates, reboot only when required, wait for connection recovery, and verify the service before continuing to the next batch.

A deployment play can copy or retrieve a versioned artifact, render environment configuration, run validation, notify a restart, wait for a health endpoint, and coordinate load-balancer membership. A security-remediation play can detect a vulnerable package or forbidden account and converge the fleet on the approved state with a visible change report.

Network automation can render intended device configuration, collect current state, apply a narrow change through a platform-specific collection, and validate reachability. Operational workflows can coordinate DNS, load balancers, applications, databases, ticketing APIs, and notifications when the steps have a well-understood order.

These workflows share one pattern: the target set is explicit, the procedure is repeatable, individual steps return structured evidence, and reruns are designed to be safe. When a task instead contains complex calculation, indefinite event processing, or constant high-frequency reconciliation, move that responsibility to an abstraction designed for it.

Production readiness also includes maintenance. Test roles against supported Ansible Core and collection versions, remove deprecated module arguments, audit unused variables and tags, rotate Vault and execution credentials, review dynamic inventory filters, and practice recovery from a partial run. Automation that cannot be maintained becomes another source of drift.

Finally, keep the run understandable to the person on call. Task names should describe intent, failures should show the responsible host and boundary, and verification should report the service condition that matters. A concise recap helps locate failure, but retained logs, inventory revision, playbook commit, extra-variable record, and controller identity explain why the run behaved as it did. Reproducibility is both a development property and an incident-response tool.

That record should also name the Ansible and collection versions, selected inventory source, host limit, tags, and Vault identity so another authorized operator can reconstruct the same execution context without copying secret values.

Ansible's agentless transport does not remove managed-node requirements. The controller still needs network reach, authentication, a compatible connection plugin, and whatever runtime the chosen modules require. Treat those prerequisites as part of the automation system and verify them before attributing every unreachable or module failure to playbook logic.

Ansible also does not make every operation declarative. Commands, migrations, API calls, and orchestration can remain action-shaped. Its value comes from giving those actions reviewed targeting, variables, structured results, sequencing, and surrounding desired-state modules. Authors still need to design evidence, idempotency, and recovery for the parts Ansible cannot infer.

The module boundary explains why task choice matters. `ansible.builtin.copy` can compare source and destination content and report a truthful change, while `ansible.builtin.shell` mainly executes a command and needs explicit conditions or guards to describe convergence. Both can be useful, but the state-aware module gives Ansible more evidence about current and desired state before acting.

## Check Your Answers

:::expand[What Problem Does Ansible Solve?]{kind="recap"}
Ansible turns repeatable intent for groups of systems into versioned, target-aware, structured remote operations that can be rerun and reviewed.
:::

:::expand[How Do the Control Node, Inventory, and Managed Nodes Work Together?]{kind="recap"}
The control node loads automation and connects agentlessly to inventory-selected managed nodes. Inventory identities, groups, variables, and connection settings define the target map.
:::

:::expand[How Do Playbooks, Tasks, and Modules Express Desired State?]{kind="recap"}
A play maps hosts to ordered tasks. Modules implement structured, often idempotent operations and report whether they changed remote state.
:::

:::expand[How Do Variables, Templates, and Handlers Make Automation Reusable?]{kind="recap"}
Variables separate data from behavior, templates render host-specific files, and handlers perform disruptive reactions only after meaningful change.
:::

:::expand[How Do Facts, Conditions, Loops, Roles, and Collections Extend the Model?]{kind="recap"}
Runtime data and conditions adapt tasks; loops repeat them; roles and collections package tested automation and plugins for reuse.
:::

:::expand[What Actually Happens During an Ansible Run?]{kind="recap"}
Ansible loads configuration, resolves hosts and per-host variables, connects, schedules modules, and aggregates structured results across control and managed sides.
:::

:::expand[How Does Ansible Differ from Other Automation Tools?]{kind="recap"}
Ansible is push-based configuration and orchestration, distinct from shell execution, Terraform state ownership, container packaging, and continuous Kubernetes reconciliation.
:::

:::expand[How Do You Operate Ansible Safely in Production?]{kind="recap"}
Version dependencies, prove targets, preview carefully, start with a canary, batch changes, protect secrets and privilege, verify service health, and predesign recovery.
:::

---

**References**

- [Ansible: Getting started](https://docs.ansible.com/ansible/latest/getting_started/index.html)
- [Ansible: How Ansible works](https://docs.ansible.com/ansible/latest/getting_started/basic_concepts.html)
- [Ansible: Inventory](https://docs.ansible.com/ansible/latest/inventory_guide/intro_inventory.html)
- [Ansible: Playbooks](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_intro.html)
- [Ansible: Modules](https://docs.ansible.com/ansible/latest/module_plugin_guide/index.html)
- [Ansible: Variables](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_variables.html)
- [Ansible: Roles](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html)
- [Ansible: Collections](https://docs.ansible.com/ansible/latest/collections_guide/index.html)
- [Ansible: Check mode and diff mode](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html)
- [Ansible: Vault](https://docs.ansible.com/ansible/latest/vault_guide/index.html)
