---
title: "Structuring Roles"
description: "Organize playbooks into reusable directory structures using Ansible roles and clean variable boundaries."
overview: "A role is a named unit of reusable Ansible work with a conventional directory layout."
tags: ["ansible", "roles", "reuse", "defaults", "vars"]
order: 1
id: article-infrastructure-as-code-ansible-roles-and-reuse
aliases:
  - roles-and-reuse
  - infrastructure-as-code/ansible/roles-and-reuse.md
  - infrastructure-as-code/ansible/roles-and-reuse/roles.md
  - infrastructure-as-code/ansible/roles-and-reuse/role-defaults-and-vars.md
---

## Table of Contents

1. [What Boundary Should a Role Own?](#what-boundary-should-a-role-own)
2. [Why Does a Role Use a Standard Directory Structure?](#why-does-a-role-use-a-standard-directory-structure)
3. [How Do Defaults Define the Role Interface?](#how-do-defaults-define-the-role-interface)
4. [How Should a Role Validate Inputs?](#how-should-a-role-validate-inputs)
5. [How Should Tasks and Assets Tell the Story?](#how-should-tasks-and-assets-tell-the-story)
6. [What Should Stay Outside the Role?](#what-should-stay-outside-the-role)
7. [How Do You Test and Version a Role?](#how-do-you-test-and-version-a-role)
8. [What Makes a Role Reusable?](#what-makes-a-role-reusable)
9. [Check Your Answers](#check-your-answers)

An **Ansible role** is a conventional directory layout for reusable automation. It can hold tasks, defaults, variables, templates, static files, handlers, metadata, and argument validation. A role gives related work one home so playbooks can call it by name.

This helps when a playbook grows past a few tasks. In the previous articles, the application platform gained directories, templates, copied files, partial edits, handlers, health checks, and rollout behavior. Keeping all of that in one long playbook works for the first version, and repeated reuse turns it into a maintenance problem when staging, production, and disaster-recovery environments need the same service setup.

A role gives the playbook a cleaner job. The playbook decides which hosts receive the automation and which environment values apply. The role owns how the service is installed, configured, restarted, and checked.

The first principle is that a role is a boundary, not merely a folder that shortens a playbook. It should represent one coherent capability such as an application service, reverse proxy, monitoring agent, or operating-system baseline. Its defaults form inputs, its tasks implement the mechanism, and its handlers protect the changes it makes.

Keep these questions in view as you work through the lesson:

1. **What Boundary Should a Role Own?**
2. **Why Does a Role Use a Standard Directory Structure?**
3. **How Do Defaults Define the Role Interface?**
4. **How Should a Role Validate Inputs?**
5. **How Should Tasks and Assets Tell the Story?**
6. **What Should Stay Outside the Role?**
7. **How Do You Test and Version a Role?**
8. **What Makes a Role Reusable?**

## What Boundary Should a Role Own?
<!-- section-summary: A role packages related Ansible work into one reusable service boundary. -->

Moving arbitrary groups of fifty lines into numbered roles does not create useful reuse. A caller should be able to answer what state the role promises and which values it accepts. If the role owns several unrelated services, environment orchestration, cloud provisioning, and incident actions, its boundary is too broad.

The transition from a long playbook to a role should preserve intent:

```text
playbook: select hosts, sequencing, rollout, environment policy
role:     converge one reusable capability on each selected host
```

This keeps a service role usable from staging, production, a disaster-recovery inventory, or a focused canary play. The caller changes context; the role's mechanism remains stable.

### A concrete application API boundary
<!-- section-summary: A concrete service role shows what belongs inside the role and what callers should provide. -->

The application platform has a service named `application-api`. Each web host needs the same basic setup: a Linux user, a config directory, an environment file, an application config, a systemd unit or drop-in, an Nginx site, and handlers for systemd, Nginx, and the app process.

The role should own the repeatable service mechanics. It should know where templates live, which handlers run after config changes, which package or binary should exist, and which health endpoint confirms the service is ready. The caller should provide environment-specific values such as the port, public hostname, upstream service endpoints, and feature flags.

The boundary looks like this:

| Role owns | Caller provides |
|---|---|
| Directory layout and file paths | Environment name |
| Service user and group | Port and hostname |
| Templates and static files | Upstream service URLs |
| Handlers and health checks | Feature flags and rollout group |
| Safe defaults and validation | Secret values through the approved secret path |

That split keeps the role reusable. Staging and production call the same role, while inventory decides the values that differ.

## Why Does a Role Use a Standard Directory Structure?
<!-- section-summary: Roles use known directory names so Ansible can find tasks, handlers, files, templates, and defaults. -->

Ansible roles use conventional directory names. You can create them manually, or you can scaffold a role with Ansible Galaxy tooling and then trim unused directories.


![Role Directory Map](/content-assets/articles/article-infrastructure-as-code-ansible-roles-and-reuse/role-directory-map.png)

*The role map shows the familiar role folders and how they create a boundary around reusable automation.*

```bash
ansible-galaxy role init application_api --init-path roles
```

A production-ready application role might look like this:

```yaml
roles/
  application_api/
    defaults/
      main.yml
    tasks/
      main.yml
      packages.yml
      config.yml
      health.yml
    handlers/
      main.yml
    templates/
      application-api.env.j2
      application-api.yml.j2
      application-api.nginx.conf.j2
      application-api.service.j2
    files/
      platform-internal-ca.pem
    meta/
      argument_specs.yml
      main.yml
```

`tasks/main.yml` is the role's default task entry point. `handlers/main.yml` holds handlers that tasks can notify. `templates` holds Jinja2 templates used by `ansible.builtin.template`. `files` holds static files used by `ansible.builtin.copy`. `defaults/main.yml` holds low-precedence variables that callers can override.

This convention matters because Ansible knows how to find role content. A template task inside `application_api` can use `src: application-api.env.j2` without writing the full path. A handler defined in the role can be notified by a task in the role. That keeps the role readable and makes file moves less brittle.

The standard structure is a shared navigation language. A reviewer knows to inspect `defaults/` for the public inputs, `tasks/` for behavior, `templates/` for generated configuration, `files/` for static content, `handlers/` for change-triggered actions, and `meta/` for validation and dependencies. New contributors do not need a custom directory map for every role.

`tasks/main.yml` should tell the capability's story rather than contain every implementation detail. A short ordered list such as validate, install, configure, and verify gives the reader a map. Focused imported task files then contain the mechanics.

```yaml
- name: Validate role inputs
  ansible.builtin.import_tasks: validate.yml
- name: Install application components
  ansible.builtin.import_tasks: install.yml
- name: Configure the application service
  ansible.builtin.import_tasks: configure.yml
- name: Verify local readiness
  ansible.builtin.import_tasks: verify.yml
```

Use the conventional entry points even when a directory contains only one file. The predictability is more valuable than saving a small directory. Remove genuinely unused folders from scaffolding so their presence does not imply unimplemented behavior.

## How Do Defaults Define the Role Interface?
<!-- section-summary: Role defaults document the safe values that inventories and playbooks can override. -->

Role defaults are usually the best place to show the role's public interface. They have low precedence, so inventory, play variables, and extra variables can override them. A reader can open `defaults/main.yml` and see which knobs the role expects callers to use.


![Role Interface Flow](/content-assets/articles/article-infrastructure-as-code-ansible-roles-and-reuse/role-interface-flow.png)

*The interface flow shows defaults, required inputs, assertions, and playbook calls as the contract around a reusable role.*

```yaml
application_api_service_name: application-api
application_api_user: application
application_api_group: application
application_api_config_dir: /etc/application-api
application_api_port: 8080
application_api_health_path: /ready
application_api_nginx_server_name: application.internal.example.com
application_api_enable_promo_codes: false
application_api_region: us-east-1
```

These defaults should be safe and boring. A default port, service name, and config directory make local testing easy. A placeholder hostname makes the interface visible. Production inventory can override the hostname, region, and feature flags without editing role tasks.

Variable names should carry the role prefix, such as `application_api_`. That lowers the chance of collisions when several roles run in one play. It also makes diffs clear because a variable name tells the reader which role owns it.

`defaults/main.yml` is the friendly public interface. Callers should feel safe overriding those values from inventory or a play. `vars/main.yml` has higher precedence and should be used sparingly for internal constants that callers normally should not change. If a production setting lives in `vars/main.yml`, the role is harder to reuse because inventory can no longer override it in the normal way.

Defaults answer “what can a caller configure, and what happens when it does not?” Keep them documented, safely typed, and usable in a small test environment. Required environment-specific endpoints or secrets should not have convincing fake production defaults; validate them as required inputs instead.

Namespace every public variable with the role name. This turns the defaults file into a recognizable API and avoids collisions with other roles' generic `port`, `user`, or `enabled` values. The same prefix should appear in argument specs, templates, handlers, and verification commands.

`vars/main.yml` is appropriate for a true internal constant whose override would break the implementation, not for a knob the role author simply prefers callers not to touch. High precedence is not documentation; if a value is configurable, keep it in defaults and validate its supported range.

Defaults tell humans which inputs exist. Argument specs tell Ansible which names, types, choices, and required fields are valid. They work together: one is a readable configuration interface, the other is an executable contract.

## How Should a Role Validate Inputs?
<!-- section-summary: Role argument validation and assert tasks catch missing or unsafe values near the start of a run. -->

Some role inputs need validation because a bad value can create a broken config file or restart the wrong service. Ansible supports role argument validation through `meta/argument_specs.yml`. When the role runs, Ansible inserts a validation task near the beginning and fails early if supplied values fall outside the specification.

For the application role, argument specs can document important fields:

```yaml
argument_specs:
  main:
    short_description: Configure the application API web service
    options:
      application_api_port:
        type: int
        required: true
        description:
          - Port where the local application API process listens.
      application_api_nginx_server_name:
        type: str
        required: true
        description:
          - Hostname served by Nginx for application traffic.
      payments_base_url:
        type: str
        required: true
        description:
          - Base URL used by application-api when calling the payments service.
```

You can also add an `assert` task for checks that need custom logic:

```yaml
- name: Validate application API port range
  ansible.builtin.assert:
    that:
      - application_api_port | int > 1024
      - application_api_port | int < 65536
    fail_msg: "application_api_port must be an unprivileged TCP port."
```

When validation fails, the operator should see the bad input before any template or service task runs. That is the production value of argument specs and assertions: the role fails at the boundary where the caller supplied an unsafe value, rather than later when Nginx, systemd, or the application reports a less obvious error.

Early validation gives a junior operator a clear failure. The playbook fails before rendering a template, before touching systemd, and before restarting a service. That is much kinder than a broken config file appearing halfway through the run.

Argument specs handle structural contracts: string versus integer, required values, allowed choices, list element types, and nested option shapes. Assertions handle relationships and environment logic, such as a TLS flag requiring certificate inputs or a port staying outside a reserved range.

Fail before touching the machine. Put validation at the role boundary, before package installation, user creation, or file rendering. A failure message should name the invalid role input and acceptable form rather than expose the later module symptom.

Validate secret presence and shape without printing secret values. A role can assert that a credential variable is defined and nonempty while keeping secret-bearing tasks under `no_log`. The boundary should remain helpful without turning validation output into a leak.

When the interface changes, update defaults, argument specs, callers, and tests in the same reviewed change. Adding a required input without migration guidance can break every inventory that calls the role even when the role's internal tasks are correct.

## How Should Tasks and Assets Tell the Story?
<!-- section-summary: A role keeps the service setup and the matching service actions together. -->

Inside the role, `tasks/main.yml` can stay small by importing focused task files. This gives package setup, file rendering, and health checks their own review path.

```yaml
- name: Install application API packages
  ansible.builtin.import_tasks: packages.yml

- name: Configure application API files
  ansible.builtin.import_tasks: config.yml

- name: Check application API health
  ansible.builtin.import_tasks: health.yml
```

The `config.yml` file might render the service unit and application config:

```yaml
- name: Render application API systemd unit
  ansible.builtin.template:
    src: application-api.service.j2
    dest: "/etc/systemd/system/{{ application_api_service_name }}.service"
    owner: root
    group: root
    mode: "0644"
  notify:
    - Reload systemd
    - Restart application API

- name: Render application API config
  ansible.builtin.template:
    src: application-api.yml.j2
    dest: "{{ application_api_config_dir }}/application-api.yml"
    owner: root
    group: "{{ application_api_group }}"
    mode: "0640"
    validate: /usr/local/bin/application-api --check-config %s
  notify: Restart application API
```

The matching handlers live beside the role:

```yaml
- name: Reload systemd
  ansible.builtin.systemd_service:
    daemon_reload: true

- name: Restart application API
  ansible.builtin.service:
    name: "{{ application_api_service_name }}"
    state: restarted

- name: Reload Nginx
  ansible.builtin.service:
    name: nginx
    state: reloaded
```

This is the payoff of role structure. A reviewer can open `roles/application_api` and see the service files, templates, handlers, defaults, and validation in one place. The role acts as the service contract.

Templates are small programs that turn role inputs into configuration. Keep their conditions and loops focused on file structure, use deterministic ordering, and validate candidate output before replacement when the application provides a parser. Business and rollout decisions should remain outside the template.

Use `templates/` when content contains Jinja expressions or host-specific structure. Use `files/` for content copied byte-for-byte, such as a reviewed public certificate or helper file. Putting static content through Jinja adds no value; putting variable placeholders in `files/` guarantees they will not render.

Handlers belong to the capability they protect. The role that manages the application's config should own the application restart handler, and the task that changes the config should notify it. This keeps change-to-action causality inside the boundary and prevents callers from reconstructing hidden service behavior.

Handler names should be specific enough to avoid collisions across roles, or use role-qualified notification patterns where supported. A handler should run only after a truthful `changed` result and should perform the narrow reload, restart, or daemon refresh required by that change.

Local verification tasks can belong in the role when they prove the capability it just configured, such as parsing the config or checking a loopback readiness endpoint. Fleet-wide synthetic tests and rollout decisions remain orchestration outside the role.

## What Should Stay Outside the Role?
<!-- section-summary: A playbook selects hosts and passes environment-specific values into the role. -->

The simplest way to call a service role is at the play level with `roles`. This treats the role as part of the fixed play structure, and it keeps the playbook short.

```yaml
- name: Configure production application web servers
  hosts: application_web
  become: true
  serial: 1
  roles:
    - role: application_api
```

Environment-specific values belong in inventory or group variables:

```yaml
application_api_env: production
application_api_nginx_server_name: application.example.com
application_api_region: us-east-1
payments_base_url: https://payments.internal.example.com
application_api_enable_promo_codes: true
```

The role stays reusable because the tasks avoid hardcoded production values. Staging can call the same role with a staging hostname and staging payment endpoint. A temporary test environment can use the same role with a different inventory group.

Roles can also be loaded with `import_role` or `include_role` inside task lists. That gives more control over timing, conditions, and loops. The next article focuses on that static and dynamic reuse choice.

Calling the role should be boring: select hosts, choose rollout controls, and name the role. A caller should not need to duplicate the role's task order, handler names, or internal paths. Complexity hidden in a huge role invocation parameter set is still complexity, so keep the interface coherent.

Keep orchestration outside the role. Draining load balancers, sequencing several services, coordinating database migrations, choosing canary groups, and publishing deployment events describe a release workflow across capabilities. A service role should converge its service on the host it receives.

Roles own mechanism; inventory usually owns environment policy. The role may default to port `8080` and expose a hostname input. Production group variables choose the production domain and release policy; staging chooses staging values. Hard-coding those environments in the role creates branches that make every new environment a code change.

A role should not secretly know every neighboring service, cloud account, and organization convention. Accept the upstream URL or credential reference it needs. This makes dependencies visible at the caller boundary and lets the same mechanism work in another topology.

Role metadata dependencies are different from orchestration. A strict prerequisite capability that must always be applied with the role can be a dependency. A business workflow such as “deploy database, then API, then notify” belongs in plays. Using dependencies for sequence hides important rollout order inside metadata.

## How Do You Test and Version a Role?
<!-- section-summary: Role changes should be checked with syntax checks, task listing, staging runs, and focused diffs. -->

Role verification starts before a host changes. A syntax check catches YAML and module-shape errors. Listing tasks helps reviewers see what the role will add to the play. Check mode and diff mode show predicted file changes where modules support them.

```bash
ansible-playbook -i inventories/staging application-web.yml --syntax-check
ansible-playbook -i inventories/staging application-web.yml --list-tasks
ansible-playbook -i inventories/staging application-web.yml --limit application-web-stg-01 --check --diff
```

After the staging run, verify the service state and config parsers:

```bash
ansible -i inventories/staging application_web -m ansible.builtin.command -a "/usr/local/bin/application-api --check-config /etc/application-api/application-api.yml"
ansible -i inventories/staging application_web -m ansible.builtin.command -a "systemctl is-active application-api"
ansible -i inventories/staging application_web -m ansible.builtin.command -a "nginx -t"
```

Role-interface changes need one extra check. When `defaults/main.yml` or `meta/argument_specs.yml` changes, run a staging play with only the role's normal caller values and another run with a deliberately missing required value. The normal run proves existing inventories still satisfy the role. The missing-value run proves the role fails at the boundary with a clear message instead of failing later inside a template or handler.

In CI, teams often run syntax checks for every changed playbook and use Molecule or a similar role test harness for roles that deserve deeper coverage. The important point for a beginner is the workflow: validate structure, preview changes, run in staging, inspect the service, then promote the same role change to production.

For a role that is shared across teams, a lightweight CI job can also run `ansible-lint` and a Molecule scenario against a disposable container or VM image. `ansible-lint` catches common role and task quality problems, while Molecule proves the role can converge and then run again with no surprise changes. Those tools do not replace staging, but they catch many role mistakes before the first real host is involved.

### How should rollback and versioning work?
<!-- section-summary: Roles should move through environments as reviewed versions, with rollback handled through source control and small production batches. -->

Role rollback works best when role changes move through Git like application code. A bad template, default, or handler change should be reverted in source, then applied through the same playbook path. That way the role and the hosts return to the same desired state.

For production, combine role changes with `serial` so only a small batch of hosts receives the new role behavior at a time. If the first host fails health checks, fix or revert the role before the rest of the fleet changes.

```bash
git revert <role-change-commit>
ansible-playbook -i inventories/production application-web.yml --limit application-web-prod-01 --diff
ansible-playbook -i inventories/production application-web.yml --limit application_web
```

When roles are shared across repositories or teams, version them deliberately. A role in a collection should be pinned through collection requirements. A role copied from Galaxy should have a reviewed version bump instead of floating to whatever version is current during a production run.

Verification should exist at several layers. Syntax and lint check the authored structure. Argument tests check the interface. A disposable scenario proves installation and a second-run convergence. Staging proves the real operating system, inventory values, dependencies, handler behavior, and health path. A canary proves the production integration before a wider batch.

Test behavior, not merely that every task executed. Assert the rendered config parses, the service is active, the endpoint responds, permissions are correct, and the second run is quiet. A role can complete all tasks successfully while configuring the wrong port or leaving an unhealthy application.

A good boundary improves review because changes cluster by responsibility. A default change is an interface change. A template change is a config-generation change. A handler change affects secondary action. A metadata change affects validation or dependencies. Reviewers can evaluate the correct blast radius without reading one giant playbook.

Version automation independently from deployment state. A role version identifies implementation and interface; inventory or release variables identify what application version an environment deploys. Updating the application does not necessarily require publishing a new role, and updating the role should not silently choose a new application release.

Roles do not automatically provide rollback. Source control can restore previous tasks, templates, and defaults, but hosts may contain files, packages, data migrations, or external effects created by the newer role. Define which desired inputs and recovery steps return the capability to an acceptable state, then exercise them through the same bounded rollout path.

## What Makes a Role Reusable?
<!-- section-summary: A useful role has one purpose, clear defaults, early validation, related assets, and handlers that match its changes. -->

The application API automation now has a reusable boundary. Defaults describe the role interface. Argument specs and asserts catch bad inputs early. Tasks manage packages, users, directories, templates, files, and health checks. Handlers reload systemd, restart the app, and reload Nginx after the right changed tasks.


![Roles Summary](/content-assets/articles/article-infrastructure-as-code-ansible-roles-and-reuse/roles-summary.png)

*The summary turns role structure into five design decisions: boundary, interface, tasks, handlers, and version.*

The playbook stays much smaller. It selects the `application_web` hosts, sets `serial`, and calls `application_api`. Inventory provides staging or production values. Reviews stay more focused because service-specific changes land inside one role directory.

Reuse still has timing choices. Sometimes Ansible should load content before the run starts. Sometimes the current host, loop item, or runtime result should choose the content during the run. Imports, includes, and collections cover that next layer.

The deeper model is a contract:

```text
caller supplies validated intent
        ↓
role converges one capability
        ↓
handlers apply necessary secondary actions
        ↓
verification proves capability behavior
```

The role is reusable when none of those steps secretly depends on one environment, one caller's orchestration, or an undocumented variable. Its interface is obvious, its internal story is navigable, and its behavior can be tested independently.

The next article covers dynamic and static reuse. Roles organize service content, while imports, includes, and collections decide how Ansible loads that content and how teams share it across projects.

Role documentation and implementation should evolve together. Defaults and argument specs are executable documentation, while task names and verification show the promised behavior. When one changes without the others, callers inherit an undocumented contract or validation rejects a still-documented input.

Review dependencies for coupling. A role that requires another capability on every call may declare it explicitly; a role that sometimes coordinates several applications probably belongs under a playbook. Keeping dependency edges honest prevents role reuse from turning into hidden orchestration.

A role should expose outputs only when callers genuinely need them. Registering and publishing broad internal results couples orchestration to implementation details. Prefer a small stable fact or documented variable that describes the capability's outcome, and keep transient module results inside the role's own verification flow.

A caller can place the role statically with `ansible.builtin.import_role` or choose it at runtime with `ansible.builtin.include_role`; that timing affects tags and task listing in the same way as task imports and includes. Keep operating-system work such as `ansible.builtin.user` and `ansible.builtin.file` inside the role's declared boundary, and leave orchestration checks such as an external `ansible.builtin.uri` health gate in the calling play when they coordinate several roles or services.

## Check Your Answers

:::expand[What Boundary Should a Role Own?]{kind="recap"}
A role owns one coherent capability and its mechanism. Playbooks own target selection and orchestration; inventory owns environment context.
:::

:::expand[Why Does a Role Use a Standard Directory Structure?]{kind="recap"}
Conventional folders make inputs, tasks, templates, files, handlers, and metadata predictable. `tasks/main.yml` should narrate the role's high-level flow.
:::

:::expand[How Do Defaults Define the Role Interface?]{kind="recap"}
Low-precedence, namespaced defaults expose safe caller inputs. Reserve high-precedence role vars for genuine internal constants rather than configurable production policy.
:::

:::expand[How Should a Role Validate Inputs?]{kind="recap"}
Use argument specs for types and structure, assertions for relationships, and fail before mutation with a message that identifies the invalid input.
:::

:::expand[How Should Tasks and Assets Tell the Story?]{kind="recap"}
Keep focused task files, deterministic validated templates, byte-for-byte static files, truthful notifications, and handlers next to the capability they protect.
:::

:::expand[What Should Stay Outside the Role?]{kind="recap"}
Keep environment policy, fleet rollout, cross-service sequencing, global migration, and deployment events in inventory and orchestration rather than a service role.
:::

:::expand[How Do You Test and Version a Role?]{kind="recap"}
Test syntax, inputs, convergence, rendered behavior, health, and canary integration. Pin shared versions and distinguish automation implementation from deployed application state.
:::

:::expand[What Makes a Role Reusable?]{kind="recap"}
A reusable role has one purpose, a documented validated interface, a readable mechanism, related handlers and assets, independent behavior tests, and no secret environment assumptions.
:::

---

**References**

- [Roles](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse_roles.html) - Official playbook guide for role directory structure, role usage, dependencies, and argument validation.
- [Reusing Ansible artifacts](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse.html) - Official guide for deciding when to split playbooks into reusable files and roles.
- [ansible.builtin.template](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/template_module.html) - Official module documentation for role templates that render files on managed hosts.
- [ansible.builtin.assert](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/assert_module.html) - Official module documentation for validating custom conditions in tasks.
- [Ansible Galaxy user guide](https://docs.ansible.com/projects/ansible/latest/galaxy/user_guide.html) - Official guide for installing and managing shared roles and collections.
