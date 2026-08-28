---
title: "Dynamic and Static Reuse"
description: "Choose imports, includes, and collections when Ansible reuse needs the right timing and source."
overview: "Ansible has several reuse tools. The main difference between imports and includes is when Ansible loads them."
tags: ["ansible", "imports", "includes", "collections"]
order: 2
id: article-infrastructure-as-code-ansible-includes-imports-collections
---

## Table of Contents

1. [Why Does Reuse Timing Matter?](#why-does-reuse-timing-matter)
2. [When Should You Use Static Imports?](#when-should-you-use-static-imports)
3. [When Should You Use Dynamic Includes?](#when-should-you-use-dynamic-includes)
4. [How Do Timing Choices Affect Tags and Loops?](#how-do-timing-choices-affect-tags-and-loops)
5. [How Do Roles Support Both Timing Models?](#how-do-roles-support-both-timing-models)
6. [What Do Collections Add to Reuse?](#what-do-collections-add-to-reuse)
7. [How Do You Test and Upgrade Reused Content?](#how-do-you-test-and-upgrade-reused-content)
8. [How Do You Choose the Right Reuse Tool?](#how-do-you-choose-the-right-reuse-tool)
9. [Check Your Answers](#check-your-answers)

Roles give service automation a home. The next question is timing: should Ansible load the reused content while it parses the playbook, or should it decide during the run after it knows facts, variables, loop items, and earlier task results?

![Static Dynamic Reuse Timing](/content-assets/articles/article-infrastructure-as-code-ansible-includes-imports-collections/static-dynamic-reuse-timing.png)

*The timing view shows why static imports expand before the run, while dynamic includes make choices during the run.*

Ansible has two reuse families for that choice. **Imports** are static. Ansible preprocesses imported tasks, roles, or playbooks before normal task execution. **Includes** are dynamic. Ansible reaches an include as a task during execution and then loads the selected tasks, variables, or role.

Here is the timing in plain order:

1. Parse the playbook.
2. Expand imports.
3. List static tasks.
4. Start the run.
5. Reach the include task.
6. Load dynamic content for that host.

That timing affects what operators can see before the run. Static content is easier to list ahead of time. Dynamic content is more flexible because the current host, loop item, or earlier result can choose the file or role.

Keep these questions in view as you work through the lesson:

1. **Why Does Reuse Timing Matter?**
2. **When Should You Use Static Imports?**
3. **When Should You Use Dynamic Includes?**
4. **How Do Timing Choices Affect Tags and Loops?**
5. **How Do Roles Support Both Timing Models?**
6. **What Do Collections Add to Reuse?**
7. **How Do You Test and Upgrade Reused Content?**
8. **How Do You Choose the Right Reuse Tool?**

## Why Does Reuse Timing Matter?
<!-- section-summary: Imports are loaded before execution, while includes are chosen during execution. -->

The application platform now has a reusable `application_api` role, plus a few smaller task files for operating-system setup and service checks. Some of that content should always be part of the playbook. Some content depends on each host. That is where imports and includes start to matter.

Playbooks grow because several workflows need the same baseline, service setup, validation, or recovery steps. Splitting those steps into reusable files reduces duplication, but it introduces a new decision: does the reused content become part of the task graph before execution, or does the running play choose it later?

Think in two phases:

```text
parse time: build and inspect the planned task graph
run time:   evaluate hosts, facts, results, loops, and conditions
```

Static imports bind reusable content during the first phase. Dynamic includes are tasks in the second phase. This resembles early binding and late binding in programming: early binding buys predictability and tooling visibility; late binding buys flexibility from runtime context.

The deepest difference is not the spelling of `import_tasks` versus `include_tasks`. It is whether Ansible knows the inner tasks before the run begins. That choice affects conditions, loop items, tags, task listing, error timing, and how easily an operator can predict the execution graph.

Neither model is universally better. A baseline that always exists gains little from late selection. An operating-system branch whose filename depends on a gathered fact cannot be fully resolved during parsing. Choose timing from the information required to select the content.

## When Should You Use Static Imports?
<!-- section-summary: Static imports make reused content visible to Ansible before the run starts. -->

A **static import** loads reused content while Ansible builds the playbook. Common tools are `ansible.builtin.import_tasks`, `ansible.builtin.import_role`, and `import_playbook`. Static imports fit content that forms part of the fixed playbook shape.

For the application web fleet, every host needs the common package setup and the same core role:

```yaml
- name: Import common Linux baseline tasks
  ansible.builtin.import_tasks: common-linux-baseline.yml

- name: Import application API role
  ansible.builtin.import_role:
    name: application_api
```

The advantage is visibility. `ansible-playbook --list-tasks` can show imported tasks because Ansible already expanded them. Syntax checks and tag listing also have more information before the run touches a host.

Static imports work well for predictable structure. If every application web host always needs the same baseline, the import tells reviewers exactly what belongs to the play. Conditions on imports apply across imported content, so the condition should describe a broad, structural choice instead of a tiny runtime branch.

A useful mental approximation is textual expansion. If `tasks/install.yml` contains three tasks, an `import_tasks` statement makes those tasks behave as though they had been written into the parent task list before execution. This is not literal copying, but it explains why syntax and listing tools can see them early.

Because the graph is built early, an imported filename cannot depend on a fact that will only be gathered during the run. The file must be resolvable from values available during parsing. If the content itself may not exist until a runtime branch is chosen, a dynamic include is the appropriate model.

Conditions on a static import are inherited by the imported tasks. Each imported task evaluates the condition when it runs. That can create a subtle result if an early imported task changes the value used by the condition: later imported tasks may see the changed value and skip. The import is static, but its individual task conditions still evaluate at runtime.

Static visibility supports `--list-tasks`, `--list-tags`, syntax analysis, and review. It also makes errors in the fixed structure appear earlier. This is valuable for the common path, where hidden runtime expansion would add flexibility without providing a real decision.

Whole playbooks use the static model through `import_playbook`; there is no runtime `include_playbook` equivalent. Play selection and play structure are established before normal task execution, while dynamic choice happens inside plays through task or role includes.

## When Should You Use Dynamic Includes?
<!-- section-summary: Dynamic includes let the current host, loop item, or runtime result choose reused content. -->

A **dynamic include** loads reused content when the playbook reaches that include task during execution. Common tools are `ansible.builtin.include_tasks`, `ansible.builtin.include_role`, and `include_vars`. Dynamic includes fit choices that depend on host facts, loop items, or earlier task results.

The application fleet has both Ubuntu and Red Hat family hosts during a migration. Package names and service helpers differ by OS family, so the playbook can choose a task file per host. The file names stay plain so operators can inspect every possible branch:

```yaml
- name: Include OS-specific package tasks
  ansible.builtin.include_tasks: "packages-{{ ansible_facts.os_family | lower }}.yml"
```

An Ubuntu host can include `packages-debian.yml`, while a Rocky Linux host can include `packages-redhat.yml`. The selected file depends on facts gathered for that host, so a dynamic include fits the job.

Dynamic includes are also useful with loops. If the platform team wants to run the same validation role for several local service endpoints, `include_role` can run once per loop item with a clear loop variable.

```yaml
- name: Run endpoint checks for local application services
  ansible.builtin.include_role:
    name: service_endpoint_check
  loop:
    - name: application-api
      url: http://127.0.0.1:8080/ready
    - name: nginx
      url: http://127.0.0.1/nginx-health
  loop_control:
    loop_var: endpoint_check
```

Runtime facts make the timing distinction obvious. `ansible_facts.os_family` does not exist until fact gathering has contacted the host. The include statement can evaluate that fact for each host and choose a different file. A static import cannot build one global graph from a filename that varies only after execution starts.

A condition on a dynamic include controls whether Ansible expands the include at all. If it is false, none of the inner tasks enter execution for that host. This differs from a condition inherited by static imported tasks, where the inner task graph already exists and each task evaluates the condition.

Loops nearly require dynamic reuse because each item can parameterize another execution of the task file or role. Conceptually:

```text
for each endpoint:
  resolve include with endpoint context
  execute selected role tasks
```

Looping over an import would be conceptually strange: imports are expanded before the runtime loop items exist. Use a clear `loop_var` so included content does not accidentally collide with its own `item` variable.

Dynamic flexibility has a cost. The complete graph can differ by host, fact, loop item, or earlier result. A missing branch may fail only on the host that selects it. Keep possible filenames and role names constrained and visible rather than constructing arbitrary paths from untrusted or opaque data.

Do not confuse dynamic task inclusion with variable loading. `include_vars` dynamically loads data, while `include_tasks` loads executable task content. The fact that both happen at runtime does not make variables into instructions or task files into configuration data.

## How Do Timing Choices Affect Tags and Loops?
<!-- section-summary: The timing choice changes what operators can list, tag, loop over, and start from. -->

The import/include choice shows up in everyday commands. Static imports are expanded before execution, so `--list-tasks` and `--list-tags` can show the imported work. Dynamic includes appear first as include tasks, and Ansible discovers the inner tasks only as the include runs.

```bash
ansible-playbook -i inventories/staging application-web.yml --list-tasks
ansible-playbook -i inventories/staging application-web.yml --list-tags
```

That matters during review. If `common-linux-baseline.yml` is imported, an operator can list the exact tasks before the run. If `packages-{{ ansible_facts.os_family | lower }}.yml` is included, the operator should inspect the possible files and understand which fact chooses them.

Loops are another major difference. Includes can run in loops because the include itself is a task. Imports are expanded during parsing, so they are a poor fit for per-item runtime work. When you need one role execution per generated item, `include_role` usually fits the job.

Tags also need deliberate design with dynamic includes. A tag on the include controls whether the include task runs. The tasks inside the included file need matching tags, or the include should use `apply` to pass tags to inner tasks.

```yaml
- name: Include application health checks with health tags
  ansible.builtin.include_tasks:
    file: health-checks.yml
    apply:
      tags:
        - application_health
  tags:
    - application_health
```

This pattern helps emergency commands behave as expected:

```bash
ansible-playbook -i inventories/production application-web.yml --tags application_health --limit application-web-prod-01
```

Tags follow the same timing model. Static imports expose inner tasks early, so inherited or task-level tags can participate in pre-run tag selection. A tag on a dynamic include selects the include task, but inner tasks do not automatically inherit it unless they carry the tag or the include uses `apply`.

This is why a tag-limited run can appear to reach a dynamic include and then do no inner work. Test the actual operator command in CI instead of assuming a tag on the outer line propagates. Emergency and maintenance tags deserve explicit end-to-end coverage.

`--list-tasks` behaves differently for the same reason. It can enumerate statically imported tasks because they are already in the graph. It can show the dynamic include statement but cannot know every branch selected later from host facts and results. Tooling visibility is a design benefit of static reuse, not a limitation to work around blindly.

When reviewers inspect dynamic content, they need both the decision point and its possible targets. A change to a filename expression without corresponding branch tests is incomplete even when syntax check passes.

## How Do Roles Support Both Timing Models?
<!-- section-summary: Play-level roles and import_role fit fixed structure, while include_role fits runtime choices. -->

Roles can be used three common ways. A play-level `roles` list adds the role as part of the fixed play structure. `import_role` brings a role into a task list statically. `include_role` loads and executes a role dynamically during the run.

For the normal application web deployment, a play-level role is straightforward:

```yaml
- name: Configure application web servers
  hosts: application_web
  become: true
  serial: 1
  roles:
    - role: application_api
```

For a fixed task-list location, `import_role` keeps the role visible early:

```yaml
- name: Import the application API role after preflight checks
  ansible.builtin.import_role:
    name: application_api
```

For runtime choices, `include_role` gives more flexibility. A canary play might include a rollback role only after a health check result indicates a failed deployment on that host.

```yaml
- name: Include rollback role for failed canary host
  ansible.builtin.include_role:
    name: application_api_rollback
  when: canary_health.status is defined and canary_health.status != 200
```

The practical question is: **should this role be part of the fixed play structure, or should the current host decide during execution?** Fixed structure points to play-level roles or `import_role`. Runtime decisions, loops, and host-specific selection point to `include_role`.

The play-level `roles:` keyword is the clearest static form when the role belongs to the play's normal structure. `import_role` exists so a static role can appear at a precise position among tasks, such as after an explicit preflight and before a validation block. Both make role tasks knowable early.

Use `include_role` when facts, registered results, or loop items select the role at runtime. A platform play can loop over several application instances and pass each instance as a role parameter, or include a recovery role only after evidence indicates failure.

Role timing does not change role responsibilities. Defaults remain overridable inputs, handlers still need safe names and timing, and tasks must remain idempotent. A dynamic role executed twice in a loop must converge correctly for both items; a static role does not become safe merely because its graph is visible.

Avoid making every role dynamic as a generic style. It weakens task listing and can hide the common path behind runtime decisions. Avoid making every role static when the real decision genuinely depends on per-host facts or items. The timing should explain an actual information dependency.

## What Do Collections Add to Reuse?
<!-- section-summary: Collections package roles, modules, plugins, and docs under a namespace so teams can share tested automation. -->

A **collection** is Ansible's package format for roles, modules, plugins, playbooks, documentation, and tests. Collections live under a namespace and name, such as `community.general` or an internal collection like `acme.platform`. They let teams share automation with versions instead of copying role directories between repositories.


![Collection Package Map](/content-assets/articles/article-infrastructure-as-code-ansible-includes-imports-collections/collection-package-map.png)

*The collection map shows namespace.collection packages, roles, modules, version pins, requirements.yml, and CI install as one dependency path.*

The application platform might use community modules for system helpers and an internal collection for company service roles:

```yaml
collections:
  - name: community.general
    version: "==11.4.0"
  - name: acme.platform
    version: "==2.3.1"
```

Install them in CI and on automation runners before running playbooks:

```bash
ansible-galaxy collection install -r collections/requirements.yml
ansible-galaxy collection list
```

Version pinning matters because a collection can change module behavior, role defaults, or plugin code. Production automation should run with a reviewed dependency set. A collection upgrade should look like any other infrastructure change: update the version, run syntax checks and staging tests, review diffs, then promote.

Collections solve a different dimension from timing. Imports and includes answer **when** reused content enters execution. A collection answers **how** roles, modules, plugins, playbooks, documentation, and tests are named, packaged, distributed, and versioned.

Fully Qualified Collection Names make the source explicit:

```text
ansible.builtin.include_tasks
│       │       └─ module or plugin name
│       └───────── collection
└───────────────── namespace
```

Using FQCNs prevents ambiguity when another collection exposes a similarly named plugin and makes dependency review easier. An internal role might be referenced as `acme.platform.application_api`, showing both its package owner and role name.

Pinning matters because “same playbook commit” does not mean “same automation” when CI installs the newest dependency on every run. A newer module can change defaults, validation, return data, or platform support without any playbook line changing. Exact or carefully constrained versions make the implementation reproducible.

Static versus dynamic reuse does not protect against dependency upgrades. A statically imported role from collection version 2.7 is still different code from version 2.3. A dynamically included role is equally exposed. Timing and dependency version are independent axes, and both need explicit review.

Collections should be installed into a controlled execution environment or job workspace rather than inherited from an administrator's global machine state. `ansible-galaxy collection list` records what the runner actually has, while the committed requirements file states what it should have.

## How Do You Test and Upgrade Reused Content?
<!-- section-summary: Reuse choices should be verified with syntax checks, task listing, tag listing, staging runs, and pinned dependencies. -->

Verification starts with installing the same collection versions that production will use. CI should install from `collections/requirements.yml`, run syntax checks, and list tasks for playbooks where static imports should be visible.

```bash
ansible-galaxy collection install -r collections/requirements.yml
ansible-playbook -i inventories/staging application-web.yml --syntax-check
ansible-playbook -i inventories/staging application-web.yml --list-tasks
ansible-playbook -i inventories/staging application-web.yml --list-tags
```

For dynamic includes, CI should also check the files that facts or variables can select. If the playbook includes `packages-{{ ansible_facts.os_family | lower }}.yml`, reviewers should see `packages-debian.yml` and `packages-redhat.yml` in the same change when the include logic changes.

Run staging with the same tags and limits operators will use in production:

```bash
ansible-playbook -i inventories/staging application-web.yml --limit application-web-stg-01 --check --diff
ansible-playbook -i inventories/staging application-web.yml --tags application_health --limit application-web-stg-01
```

This catches two common problems early. A dynamic include may select a missing file for one OS family. A tag-limited run may execute the include task and leave out the inner work when tags are missing from the included tasks.

### How should upgrades and rollbacks preserve dependencies?
<!-- section-summary: Reused content can affect many playbooks, so upgrades need pinning, staging, and a clear revert path. -->

Reusable content has a wider blast radius than a one-off task. A role used by ten playbooks can change ten workflows. A collection upgrade can change modules and plugins across the whole automation repository. That power is useful, and it deserves a careful release path.

For internal roles, review role changes with the playbooks that call them. For collections, pin exact versions in requirements, commit the requirement change, and run staging before production. Keep the previous requirement version in Git so rollback is a normal revert.

```bash
git diff collections/requirements.yml
ansible-galaxy collection install -r collections/requirements.yml --force
ansible-playbook -i inventories/staging application-web.yml --limit application-web-stg-01 --check --diff
```

If an upgraded collection or shared role breaks production, revert the requirements or role commit, reinstall dependencies, and rerun the playbook through the same production limit. That gives you a clean path back to the last reviewed dependency set.

```bash
git revert <collection-or-role-upgrade-commit>
ansible-galaxy collection install -r collections/requirements.yml --force
ansible-playbook -i inventories/production application-web.yml --limit application-web-prod-01 --diff
```

CI should test the execution model the repository actually uses. Syntax and task listing cover the static graph. Dynamic branches need representative facts, inventories, loop items, and prior-result states. If Debian and Red Hat hosts select different files, execute or check both paths rather than merely verifying that both files parse in isolation.

Test decision points, not only files. A health tag should reach the include and its inner tasks. A loop should pass the intended loop variable into the role. A recovery role should be skipped on healthy evidence and selected on failure evidence. The behavior at the reuse boundary is what can break even when every component looks valid separately.

Idempotence still matters in both models. A static task executed twice must converge. A dynamic include may be selected on a later run after earlier state changed, so its tasks must also converge from realistic partial states. Reuse timing controls graph construction, not desired-state correctness.

Upgrades are safest when the dependency graph is visible. Record Ansible core, collection, role, execution-environment, and external CLI versions that influence the play. A requirements revert without reinstalling the runner leaves the upgraded code active; reinstall and verify the effective dependency set before calling rollback complete.

Rollback may need to restore both application and automation assumptions. If a new collection deployed a new config format, reverting only the collection might leave hosts with files the old role cannot interpret. Know which host state changed during the upgrade test and use the previous dependency set to converge it deliberately.

## How Do You Choose the Right Reuse Tool?
<!-- section-summary: Reusable Ansible content uses imports for fixed structure, includes for runtime choices, roles for service boundaries, and collections for sharing. -->

The application automation now has several reuse layers. The `application_api` role packages service setup. Static imports bring fixed baseline tasks into the playbook early so operators can list them. Dynamic includes choose OS-specific task files from host facts. Collections provide versioned shared modules and roles for the team.


![Reuse Summary](/content-assets/articles/article-infrastructure-as-code-ansible-includes-imports-collections/reuse-summary.png)

*The summary links static reuse, dynamic reuse, tags, collections, and CI into one reviewable reuse workflow.*

The operator workflow matches those choices. CI installs pinned collections, runs syntax checks, lists tasks and tags, and tests staging. Production runs use limits and serial batches. If a reused dependency causes trouble, Git rollback and dependency reinstall bring the playbook back to the previous reviewed state.

Reusable Ansible content needs three habits: make the common path clear to read, make runtime choices explicit, and keep shared dependencies versioned. With those habits in place, a small playbook can support a growing fleet without hiding its behavior.

The most useful decision rule is short:

```text
Is the reused content always part of this play structure?
  → static import or play-level role

Does a runtime fact, result, condition, or loop item choose it?
  → dynamic include

Does the content need packaging, namespace, distribution, or versioning?
  → collection, independently of timing
```

Do not make everything dynamic. A common baseline hidden behind includes gives tooling less visibility, pushes missing-file failures later, and makes the main path harder to review. Do not make everything static either. Encoding every operating-system or instance variation into conditions inside one fixed graph can be more complex than selecting one clear task file at runtime.

A practical structure separates the decisions:

```text
collections/requirements.yml
playbooks/application-web.yml
roles/application_api/
tasks/
├── common-linux-baseline.yml
├── packages-debian.yml
├── packages-redhat.yml
└── health-checks.yml
```

The playbook can statically import `common-linux-baseline.yml`, use a play-level application role for the fixed service boundary, dynamically include the fact-selected package file, and dynamically include health checks when a maintenance tag requests them. The requirements file pins every external package those tasks and roles rely on.

Another example is a list of application instances. If the number and settings are inventory data, `include_role` can loop over the list and pass one structured instance at a time. That is a real runtime iteration. If the repository always defines exactly two fixed roles that every host receives, a play-level roles list is clearer than manufacturing a loop for symmetry.

A useful code-review question is: **what information becomes available only at the moment this reuse point is resolved?** If the answer is “none,” prefer the more visible static form. If the answer is a host fact, loop item, or earlier result, verify every supported value and failure path.

Dynamic reuse can make execution harder to reason about because two hosts may encounter different tasks under the same play name. Keep branch inputs small, enumerate supported values, fail clearly on unsupported values, and make task names expose the selected branch. Flexibility should not mean an unbounded task graph.

The deepest model combines binding and dependencies:

```text
static reuse:
  resolve dependency early → expand known graph → execute

dynamic reuse:
  execute to decision point → inspect current context → resolve dependency → execute

collection:
  provide the named, versioned dependency used by either path
```

Conditions provide one more review trap. With a static import, the condition is copied conceptually onto every imported task. If the first task sets the variable used by that condition, later tasks may make a different decision. With a dynamic include, the condition is evaluated once at the include boundary; after expansion, the inner tasks are not automatically governed by that outer condition unless they have their own logic. Neither behavior is inherently safer, so choose the one that matches the intended decision lifetime.

Task names and tags should make this lifetime visible. Name a dynamic include after the fact or result that selects it, and use `apply` when an operator-facing tag must reach every inner task. For static content, place tags on the imported tasks or structural import according to the command behavior the team tests. Always run the real `--tags`, `--skip-tags`, and `--list-tasks` combinations used in maintenance procedures.

Dependency upgrades can also change the binding decision indirectly. A collection role may introduce new defaults, rename a task tag, or alter which facts a branch expects. Review changelogs, but verify behavior in the repository because the same collection version can interact differently with local inventory and Ansible core. Pin core and execution-environment assumptions alongside collections where reproducibility matters.

Finally, reuse should reduce duplicated ownership, not merely reduce line count. A shared file or role should have a coherent responsibility and callers that accept the same contract. If every caller passes a large set of mutually exclusive flags, the abstraction may be hiding several different workflows. Split it into clearer static components or explicit dynamic branches so the task graph reflects the real operational choices.

The next group covers secrets and safety. Reusable automation eventually needs passwords, tokens, private keys, and certificates. The next article starts with Ansible Vault and explains where encrypted values become plain text during a run.

Treat missing dynamic branches as interface failures. If inventory can produce `os_family: Suse` but the repository contains only Debian and Red Hat task files, fail at the include decision with a message that lists supported values. Letting a constructed filename fail with “file not found” hides the real contract violation.

Static content benefits from the opposite discipline: keep the always-present graph free of unnecessary host-dependent indirection. Early visibility lets syntax, task listing, tags, and review agree on the common path. The final design can mix both models in one play as long as each reuse point explains which information forces its binding time.

One more failure mode appears when a dynamic decision uses data created earlier on only some hosts. A registered variable can be defined for Debian hosts and absent for Red Hat hosts, causing the include expression itself to fail before its condition protects the branch. Guard the decision with `is defined`, supply a deliberate default, or structure separate includes whose inputs exist on every host. Dynamic reuse is executable control flow, so its selection data deserves the same defensive design as any other condition.

Static imports have their own maintenance risk: an imported task file can accumulate caller-specific assumptions while appearing universally reusable. Treat the imported file as a small contract, namespace its variables, and test every fixed caller when it changes. Early binding makes dependencies visible, but it does not make their interfaces automatically coherent.

The same timing distinction appears at larger boundaries. `ansible.builtin.import_playbook` is static playbook composition; `ansible.builtin.import_role` expands a role predictably; `ansible.builtin.include_role` chooses a role during execution; and `ansible.builtin.include_vars` loads data dynamically. Static expansion usually gives `--list-tasks`, tags, and `--start-at-task` a more complete view. Dynamic inclusion is appropriate when facts or runtime inputs such as `--extra-vars` must decide what to load, but the preview boundary should be documented.

## Check Your Answers

:::expand[Why Does Reuse Timing Matter?]{kind="recap"}
Static reuse binds during parsing; dynamic reuse binds during execution. The timing determines what facts, results, loop items, tooling, and failure points are available.
:::

:::expand[When Should You Use Static Imports?]{kind="recap"}
Use imports for fixed structural content that should be visible early. Imported tasks inherit conditions individually, and whole-playbook reuse is static-only.
:::

:::expand[When Should You Use Dynamic Includes?]{kind="recap"}
Use includes when the current host's facts, loop item, condition, or earlier result selects content. Constrain and test every supported branch.
:::

:::expand[How Do Timing Choices Affect Tags and Loops?]{kind="recap"}
Dynamic includes can loop, but their inner tags need explicit propagation. Static tasks are easier to list; dynamic inner tasks appear only when selected at runtime.
:::

:::expand[How Do Roles Support Both Timing Models?]{kind="recap"}
Play-level roles and `import_role` provide fixed structure. `include_role` supports runtime conditions and loops without changing the role's input or idempotence responsibilities.
:::

:::expand[What Do Collections Add to Reuse?]{kind="recap"}
Collections package and namespace reusable content. FQCNs identify its source, while pinned versions make the effective automation reproducible independently of import timing.
:::

:::expand[How Do You Test and Upgrade Reused Content?]{kind="recap"}
Install exact dependencies, inspect the static graph, exercise dynamic decision points, test tags and loops, verify idempotence, and restore both dependency and host assumptions on rollback.
:::

:::expand[How Do You Choose the Right Reuse Tool?]{kind="recap"}
Choose static reuse for an always-present path, dynamic reuse for a genuine runtime choice, and collections for package ownership and versions. Keep the common path obvious.
:::

---

**References**

- [Reusing Ansible artifacts](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse.html) - Official guide for imports, includes, reusable files, roles, and handler reuse behavior.
- [Roles](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse_roles.html) - Official guide for play-level roles, `include_role`, `import_role`, and role argument validation.
- [ansible.builtin.include_role](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/include_role_module.html) - Official module documentation for dynamically loading and executing roles.
- [ansible.builtin.import_role](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/import_role_module.html) - Official module documentation for statically importing roles.
- [Using Ansible collections](https://docs.ansible.com/projects/ansible/latest/collections_guide/index.html) - Official guide for collection structure and usage.
- [Ansible Galaxy user guide](https://docs.ansible.com/projects/ansible/latest/galaxy/user_guide.html) - Official guide for installing roles and collections from requirements files.
