---
title: "Variable Precedence"
description: "Learn how Ansible resolves competing variable definitions, why precedence differs from keyword configuration, and how facts, register, set_fact, and dictionaries behave."
overview: "Ansible resolves values per host from many sources. This article builds a practical precedence model from role defaults through inventory, play data, facts, set_fact, and extra variables, then shows how to debug collisions without assuming the last file wins or dictionaries merge."
tags: ["ansible", "variables", "precedence", "set-fact", "debugging"]
order: 2
id: article-infrastructure-as-code-ansible-variables-facts-precedence
aliases:
  - variables-facts-precedence
  - infrastructure-as-code/ansible/variables-facts-precedence.md
---

## Table of Contents

1. [Why Is Precedence More Than the Last Line Written?](#why-is-precedence-more-than-the-last-line-written)
2. [How Do Defaults, Inventory, and Host Exceptions Layer?](#how-do-defaults-inventory-and-host-exceptions-layer)
3. [What Do Play Variables and Extra Variables Mean?](#what-do-play-variables-and-extra-variables-mean)
4. [Why Are Role Defaults and Role Variables So Different?](#why-are-role-defaults-and-role-variables-so-different)
5. [How Do Facts and Registered Results Add Time to Resolution?](#how-do-facts-and-registered-results-add-time-to-resolution)
6. [What Does setfact Actually Create?](#what-does-setfact-actually-create)
7. [Why Do Dictionary Values Usually Replace Instead of Merge?](#why-do-dictionary-values-usually-replace-instead-of-merge)
8. [How Do You Audit the Value That Won?](#how-do-you-audit-the-value-that-won)
9. [Check Your Answers](#check-your-answers)

One Ansible variable name can appear in role defaults, inventory groups, a host file, a play, a registered result, and `--extra-vars`. The winner is selected by Ansible's precedence categories and host context, not by whichever line happens to appear latest in the repository.

Suppose a role default contains:

```yaml
# roles/web/defaults/main.yml
web_port: 8080
```

and production inventory contains:

```yaml
# group_vars/prod.yml
web_port: 80
```

Production hosts receive `80` because inventory group variables have higher variable precedence than role defaults. It does not matter that the default file was edited later or is alphabetically after the inventory file.

The execution model is per host:

```text
selected host
    -> collect applicable variable sources
    -> order them by precedence category
    -> higher source overrides same-name lower source
    -> evaluate task with resulting host context
```

Keep these questions in view as you work through the lesson:

1. **Why Is Precedence More Than the Last Line Written?**
2. **How Do Defaults, Inventory, and Host Exceptions Layer?**
3. **What Do Play Variables and Extra Variables Mean?**
4. **Why Are Role Defaults and Role Variables So Different?**
5. **How Do Facts and Registered Results Add Time to Resolution?**
6. **What Does `set_fact` Actually Create?**
7. **Why Do Dictionary Values Usually Replace Instead of Merge?**
8. **How Do You Audit the Value That Won?**

## Why Is Precedence More Than the Last Line Written?
<!-- section-summary: Variable sources belong to ordered categories and are resolved per host, so file order alone cannot explain the winning value. -->

Two hosts in one play can therefore receive different winners because they belong to different groups or have different host variables.

There are also two related precedence systems. Configuration settings such as `forks`, connection behavior, or privilege options can come from configuration files, environment variables, command options, play keywords, and variables. Ordinary data variables have their own detailed source ordering. Do not mix a command option such as `-u` with a variable collision as if they were identical mechanisms.

Some connection variables can override keywords because they participate as variables. Debug by naming the exact setting and all places it can be defined, not by memorizing one oversimplified list.

## How Do Defaults, Inventory, and Host Exceptions Layer?
<!-- section-summary: Weak role defaults provide reusable behavior, group variables describe classes of hosts, and host variables encode narrow real exceptions. -->

A practical shape is:

```text
role defaults
    weakest, caller-friendly starting values
        |
group_vars/all
    organization-wide environment data
        |
group_vars for environment or role
    class-specific settings
        |
host_vars
    one-host exception
```

For example:

```yaml
# roles/webserver/defaults/main.yml
web_workers: 2
web_log_level: info
```

```yaml
# group_vars/all.yml
web_log_level: notice
```

```yaml
# group_vars/prod.yml
web_workers: 8
web_log_level: warn
```

```yaml
# host_vars/web03.yml
web_workers: 4
```

A production host normally gets eight workers and warning logging. `web03` gets four workers but keeps the production log level.

This is an intent hierarchy. Defaults make the role usable. Group data describes shared reality. A host file documents an actual exception. If most hosts need exceptions, the grouping or role interface is probably wrong.

A subtle collision occurs when a host belongs to sibling groups at the same precedence level and both define the same variable. Inventory loading order and group priority can affect the result. Do not rely on ambiguous sibling collisions for policy. Model groups with a clear parent/child relationship, use `ansible_group_priority` where appropriate, or define the value once in the environment group.

Inspect the resolved inventory graph and host data after changing memberships. Group hierarchy is part of variable behavior.

## What Do Play Variables and Extra Variables Mean?
<!-- section-summary: Play variables express one execution's intent, while extra variables are high-precedence caller overrides that can replace most other values. -->

Play variables are close to one procedure:

```yaml
- name: Deploy web service
  hosts: web
  vars:
    deployment_mode: rolling
    release_version: "2.4.1"
```

They mean “for this play execution, use these values.” They outrank inventory data in the normal variable model, which makes them useful for procedure-specific choices and risky for hiding stable environment truth.

Extra variables sit at very high precedence:

```bash
ansible-playbook -i inventories/prod deploy.yml \
  -e release_version=2.4.2
```

This fits an approved release version or emergency maintenance flag. It can also override a host safety exception or role value without changing reviewed inventory.

Use extra variables as an explicit API. Validate supported names and values, record them with the run, and prefer a protected YAML or JSON file for structured inputs:

```bash
ansible-playbook -i inventories/prod deploy.yml \
  --extra-vars @release.yml
```

Do not pass secrets on a command line. Stable values repeatedly supplied with `-e` belong in inventory, role configuration, or a controlled automation-platform variable set.

Command-line position does not create further precedence among categories. A high-precedence extra variable wins because of its source, not because the flag appeared after the playbook name.

## Why Are Role Defaults and Role Variables So Different?
<!-- section-summary: Defaults form the role's easy-to-override public interface, while role vars are strong internal values that callers should rarely need to replace. -->

Role defaults live under `defaults/main.yml` and have deliberately low precedence:

```yaml
web_service_name: nginx
web_port: 8080
```

Inventory, play variables, and other caller sources can specialize them. This makes defaults the natural public configuration surface.

Role variables under `vars/main.yml` are much stronger:

```yaml
web_internal_layout: /opt/company/web
```

They are difficult for ordinary inventory data to override. Use them for truly internal constants only. Putting a normal environment setting in role vars surprises callers who reasonably expect production inventory to win.

The design question is not merely which source wins. It is who should own the value. A reusable role owns safe implementation defaults. Environment inventory owns environment facts. A play owns procedure-specific intent. An explicit release input owns one-run artifact selection.

Prefix role variables to avoid accidental collisions with other roles. `web_port` and `web_service_name` are safer than generic `port` and `name`. Precedence resolves a collision mechanically, but clear naming prevents the collision from existing.

Role parameters supplied at invocation also have their own precedence behavior. Treat the role call as an explicit interface and avoid defining the same key simultaneously through several nearby sources unless the override is intentional and tested.

## How Do Facts and Registered Results Add Time to Resolution?
<!-- section-summary: Facts and registered values appear during execution, so the winning host context can change as tasks gather and create data. -->

Facts are host variables discovered from the managed system:

```yaml
- name: Show operating-system family
  ansible.builtin.debug:
    var: ansible_facts.os_family
```

Inventory expresses declared data; facts express observed data. Avoid reusing fact names for custom inventory values, or readers cannot tell which authority produced the value.

Registered variables appear after their task runs:

```yaml
- name: Read current application version
  ansible.builtin.command: application --version
  register: app_version_result
  changed_when: false

- name: Show version output
  ansible.builtin.debug:
    var: app_version_result.stdout
```

Before the command, `app_version_result` does not exist. After it, the current host has a structured result containing fields such as `rc`, `stdout`, `stderr`, `changed`, and failure status.

Register therefore introduces time. A skipped task can create a different result shape; a task that never ran cannot supply a normal `stdout`. Later conditions should handle definedness and skip semantics.

Registered variables are host-scoped. Each host receives its own command result. `run_once`, delegation, and facts copied to other hosts can complicate where the value resides, so inspect `hostvars` and task context rather than assuming one global variable.

Facts and register values can override same-name lower sources according to precedence. Use distinctive names for runtime results to avoid unintentionally replacing durable input.

## What Does `set_fact` Actually Create?
<!-- section-summary: set_fact creates a high-precedence variable for the current host, and caching can also create a lower-precedence persisted fact for later runs. -->

`set_fact` calculates and stores a host variable during execution:

```yaml
- name: Select effective worker count
  ansible.builtin.set_fact:
    effective_web_workers: "{{ web_workers | int }}"
```

The new value has high precedence for the rest of the run on that host. It is useful for derived runtime data, not as a replacement for a clear input hierarchy.

Because the value is host-scoped, a task runs once per host unless controlled. Setting it on one host does not automatically create a global variable for the play. Other hosts can read it through `hostvars` only when execution and availability are understood.

With `cacheable: true`, `set_fact` has subtle dual behavior. The current run receives a high-precedence set-fact host variable, while the cached copy used in later runs behaves like a lower-precedence cached fact. A later inventory value can therefore win differently on another run.

```yaml
- name: Cache discovered application region
  ansible.builtin.set_fact:
    application_region: "{{ discovered_region }}"
    cacheable: true
```

Fact-cache lifetime and clearing become part of correctness. Do not cache secrets or rapidly changing values merely for convenience. Name which source should be authoritative after the current run.

`set_fact` can hide poor design when used repeatedly to overwrite inputs. Prefer a new derived name such as `effective_web_workers` so the original source and transformation stay visible.

## Why Do Dictionary Values Usually Replace Instead of Merge?
<!-- section-summary: Precedence chooses the winning value for a key; it does not recursively combine same-name dictionaries unless configuration explicitly constructs a merge. -->

Suppose defaults contain:

```yaml
web_settings:
  port: 8080
  log_level: info
  workers: 2
```

and production inventory contains:

```yaml
web_settings:
  workers: 8
```

The higher-precedence dictionary can replace the lower one, leaving only `workers`. Precedence answers which `web_settings` value wins; it does not automatically merge nested keys by intent.

Implicit hash-merging configuration has historically created surprising cross-source behavior. Prefer explicit composition:

```yaml
web_settings_defaults:
  port: 8080
  log_level: info
  workers: 2

web_settings_environment:
  workers: 8
```

```yaml
- name: Build effective settings
  ansible.builtin.set_fact:
    web_settings_effective: >-
      {{ web_settings_defaults | combine(web_settings_environment, recursive=true) }}
```

Now the merge order and recursion are visible and testable. Alternatively, use separate scalar variables when independent override is the real contract.

Lists also replace unless the automation explicitly combines them. Do not assume a host list appends to a group list merely because both use the same name.

Explicit merges need type validation. A string where a dictionary is expected can fail late or produce confusing template behavior. Assert mapping and list shapes before combining.

## How Do You Audit the Value That Won?
<!-- section-summary: Audit from inventory and role design through per-host debug output, then remove accidental collisions instead of relying on memorized precedence. -->

For a collision across:

```text
role default
group_vars/all
group_vars/prod
host_vars/api03
play vars
set_fact
extra vars
```

start by listing every definition with repository search. Classify each source and ask which ones apply to the host at the moment the task runs.

Inspect inventory:

```bash
ansible-inventory -i inventories/prod --graph
ansible-inventory -i inventories/prod --host api03
```

Use a narrow debug task in a protected run:

```yaml
- name: Show effective nonsecret web settings
  ansible.builtin.debug:
    msg:
      host: "{{ inventory_hostname }}"
      workers: "{{ web_workers }}"
      log_level: "{{ web_log_level }}"
```

Do not dump `hostvars` or secrets into shared logs. Increase verbosity carefully when diagnosing source loading.

Audit timing: was the variable read before or after `register` or `set_fact`? Audit group hierarchy: did sibling groups collide? Audit run inputs: did `--extra-vars` override the repository? Audit role layout: is a caller setting trapped under `vars/main.yml`?

The design goal is a short, explainable override path:

```text
role defaults
    -> environment group data
    -> rare host exception
    -> explicit run-specific release input
```

Facts and registered results should use different names for observed runtime data. Derived values should use `effective_` names. Dictionaries should merge explicitly. High precedence is not higher truth; it is only the mechanical winner. The correct source is the one whose ownership matches the meaning of the value.

The full precedence documentation contains more sources than the practical path above: inventory-file variables, group and host variable plugins, facts, play and block vars, task vars, included-variable files, role parameters, and include parameters all occupy defined positions. Consult the current reference when two less-common sources collide rather than extending a simplified mnemonic beyond its purpose.

Scope matters alongside precedence. A variable defined for a block applies only inside that block. A task variable applies only to that task. A role default can remain visible after loading, while registered and set-fact data stay associated with the host. A high-precedence value outside the current scope does not participate.

Lazy evaluation can also surprise. Jinja2 expressions stored as variable values may be evaluated when used, so changing another referenced value can affect the result. Prefer simple data in inventory and perform transformations in named derived values where timing stays understandable.

Connection variables demonstrate the overlap between data and execution settings. `ansible_user`, `ansible_connection`, `ansible_port`, and `ansible_become_user` can come from inventory and may override related command or play settings according to general precedence. Audit them as security-sensitive input because the winner changes where and as whom tasks run.

Use mandatory checks when a low default must not silently survive in a sensitive environment. A production secret reference or account identifier may be safer with no role default, forcing inventory or the approved job to provide it explicitly.

Finally, test precedence through behavior. A role scenario can load defaults, apply environment-like variables, then invoke a caller override and assert the rendered result. This protects the documented interface if role structure changes. Do not test Ansible's whole precedence engine; test the short override path the role promises callers.

When debugging, print both the effective value and the host classification that should own it. Seeing `web_workers: 4` is less useful than seeing that the host belongs to `prod`, `web`, and an exception group. Then search those group and host sources before looking for timing-dependent values.

Avoid solving an unexplained collision by adding an extra variable because it happens to win. That creates a stronger hidden override while leaving the wrong source in place. Remove or rename the accidental definition, put the intended value at its natural ownership level, and rerun inventory inspection and the narrow play.

Secrets follow the same precedence mechanics but should not be debugged with plaintext. Check whether the variable is defined, which Vault or credential source was selected, and whether the consuming task received the expected reference. Use `no_log` for the sensitive boundary and protect verbose controller output.

A healthy variable design makes the winner predictable from meaning: a role default for reusable behavior, group data for a class, host data for a documented exception, runtime results for observation, and extra vars for a deliberate one-run decision.

When diagnosing a surprising winner, verify its type and timing as well as its value. A later runtime source may replace a boolean with a string, or a task-created value may exist only after part of the play executes. The effective context is both host-specific and time-specific, which is why a static source scan can miss the real conflict.

Precedence fixes should reduce future ambiguity. Moving the same duplicate definition to a still-higher source may solve one run while making the design harder to inspect. Remove stale owners, rename independently owned concepts, or establish one documented override boundary so the next operator does not need another emergency `-e` value.

Variable precedence is separate from Ansible configuration precedence. `ansible-config dump --only-changed` helps reveal configuration settings selected from defaults, configuration files, environment variables, and command-line options; it does not explain an application variable's host-level winner. Facts can also have two representations: freshly gathered `ansible_facts` and cached fact data. Inspect the exact host context and source category before concluding that a later-looking file should win.

## Check Your Answers

:::expand[Why Is Precedence More Than the Last Line Written?]{kind="recap"}
Ansible resolves applicable sources per host by category. Edit order and filename position do not replace the precedence model.
:::

:::expand[How Do Defaults, Inventory, and Host Exceptions Layer?]{kind="recap"}
Defaults provide weak role behavior, groups describe shared classes, and host vars should document rare real exceptions rather than routine configuration.
:::

:::expand[What Do Play Variables and Extra Variables Mean?]{kind="recap"}
Play vars express one procedure; extra vars are powerful high-precedence inputs. Validate and record them instead of hiding stable production truth in flags.
:::

:::expand[Why Are Role Defaults and Role Variables So Different?]{kind="recap"}
Defaults are the easy-to-override public interface. Role vars are strong internal values and should not hold ordinary caller configuration.
:::

:::expand[How Do Facts and Registered Results Add Time to Resolution?]{kind="recap"}
Facts are discovered host data and register values appear after tasks, so both host identity and execution time affect what is available.
:::

:::expand[What Does `set_fact` Actually Create?]{kind="recap"}
It creates a high-precedence current-run host variable; caching also creates a lower-precedence fact for later runs with separate lifecycle concerns.
:::

:::expand[Why Do Dictionary Values Usually Replace Instead of Merge?]{kind="recap"}
Precedence selects one same-name value. Use explicit `combine` logic or separate variables when nested dictionaries need intentional composition.
:::

:::expand[How Do You Audit the Value That Won?]{kind="recap"}
Find every definition, classify sources, inspect per-host inventory and timing, debug only nonsecrets, and redesign accidental collisions into a short ownership path.
:::

---

**References**

- [Ansible: Controlling precedence](https://docs.ansible.com/ansible/latest/reference_appendices/general_precedence.html)
- [Ansible: Variable precedence](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_variables.html#understanding-variable-precedence)
- [Ansible: Inventory variables](https://docs.ansible.com/ansible/latest/inventory_guide/intro_inventory.html)
- [Ansible: set_fact](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/set_fact_module.html)
- [Ansible: combine filter](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/combine_filter.html)
