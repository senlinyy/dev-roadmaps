---
title: "Rolling Updates and Serial Execution"
description: "Use --limit, serial batches, and health checks to keep Ansible changes inside a deliberate blast radius."
overview: "After previewing a change, the next safety layer is execution scope: one selected host, measured batches, and health checks between them."
tags: ["ansible", "limits", "serial", "rollouts"]
order: 4
id: article-infrastructure-as-code-ansible-safe-rollouts-check-mode-limits
aliases:
  - safe-rollouts-check-mode-limits
  - infrastructure-as-code/ansible/safe-rollouts-check-mode-limits.md
---

## Table of Contents

1. [Why Is Deployment a Propagation Problem?](#why-is-deployment-a-propagation-problem)
2. [How Does --limit Set the Outer Boundary?](#how-does---limit-set-the-outer-boundary)
3. [How Does serial Create Rollout Batches?](#how-does-serial-create-rollout-batches)
4. [How Do Health Checks Gate Propagation?](#how-do-health-checks-gate-propagation)
5. [When Should a Failure Stop the Rollout?](#when-should-a-failure-stop-the-rollout)
6. [How Do Concurrency Controls Differ?](#how-do-concurrency-controls-differ)
7. [How Should Recovery Work After a Failed Batch?](#how-should-recovery-work-after-a-failed-batch)
8. [How Do You Design a Safe Rolling Update?](#how-do-you-design-a-safe-rolling-update)
9. [Check Your Answers](#check-your-answers)

Preview tells you what a playbook is likely to change. The next question is how much production you want to expose to the first real run. A playbook that updates every host at once can turn a small template mistake into a full service incident.

![Limit Serial Blast Radius](/content-assets/articles/article-infrastructure-as-code-ansible-safe-rollouts-check-mode-limits/limit-serial-blast-radius.png)

*The blast-radius map shows how --limit, serial batches, failure thresholds, and health checks keep a rollout contained.*

Let's keep the application platform. The service runs behind a load balancer on six web hosts: `application-web-01` through `application-web-06`. A change updates the Nginx timeout, renders a new environment file, and restarts the app. The team wants one canary first, then two hosts at a time, with a health check before each batch finishes.

That rollout boundary has four parts. `--limit` chooses the first slice of inventory. `serial` controls how many hosts the play processes together. Health checks decide whether the current batch is safe. Failure thresholds decide when Ansible should stop instead of pushing onward.

Keep these questions in view as you work through the lesson:

1. **Why Is Deployment a Propagation Problem?**
2. **How Does --limit Set the Outer Boundary?**
3. **How Does serial Create Rollout Batches?**
4. **How Do Health Checks Gate Propagation?**
5. **When Should a Failure Stop the Rollout?**
6. **How Do Concurrency Controls Differ?**
7. **How Should Recovery Work After a Failed Batch?**
8. **How Do You Design a Safe Rolling Update?**

## Why Is Deployment a Propagation Problem?
<!-- section-summary: Safe rollouts control target selection, batch size, validation, and stop conditions before a bad change can affect the whole service. -->

The bounded rollout expresses operational safety in plain form. The YAML can still describe the whole desired state for `application_web`, while the run command and play keywords decide how fast production receives it.

Deployment is a propagation problem because a release moves from an unproven state toward more of the fleet. The first changed host provides evidence. Each later host increases exposure. A safe rollout controls that movement so a shared defect is detected before it reaches every replica.

Ansible's default host strategy is not automatically a rolling update. Without `serial`, a task can run across many selected hosts in parallel up to the controller's fork capacity. Ansible may complete one task across the fleet before moving to the next task, so many hosts can receive a bad config before any later health check runs.

Three boundaries are easy to confuse:

```text
inventory pattern + --limit → deployment scope
serial                      → hosts in the current batch
forks/throttle/strategy     → concurrent scheduling inside that scope
```

The outer scope answers “which hosts are eligible in this run?” The serial batch answers “which eligible hosts advance together?” Concurrency answers “how much of the current work can execute at once?” Safe design needs all three to be intentional.

Think in blast radius rather than syntax. If six replicas serve one application and two leave rotation together, the immediate capacity loss is roughly two sixths before accounting for uneven traffic or slow drain. If a shared error affects the current batch, the number of unhealthy hosts is bounded by the batch only when validation stops later propagation.

A compact risk model is:

```text
rollout risk ≈ change uncertainty × exposed hosts × propagation speed
```

Preview and tests reduce uncertainty. `--limit` and `serial` reduce exposed hosts. Health gates and failure rules reduce propagation speed after bad evidence. None of those controls proves the release is correct, but together they contain failure while the team learns.

## How Does --limit Set the Outer Boundary?
<!-- section-summary: --limit narrows a playbook run to a canary host, a subset, or an emergency target without changing the playbook's normal host pattern. -->

The playbook should usually target the honest service group:

```yaml
- name: Configure application web fleet
  hosts: application_web
  become: true
```

The first production apply can narrow that target with `--limit`. This keeps the playbook reusable while the operator controls the first slice at runtime.

```bash
ansible-playbook \
  -i inventories/prod \
  application.yml \
  --limit application-web-01 \
  --vault-id prod@prompt
```

That canary run proves real behavior on one host. It writes files, triggers handlers, restarts services, calls health checks, and exposes any host-specific surprises. If the run fails, the team investigates one host instead of a whole fleet.

After the canary succeeds, you can run the same playbook against the remaining group:

```bash
ansible-playbook \
  -i inventories/prod \
  application.yml \
  --limit 'application_web:!application-web-01' \
  --vault-id prod@prompt
```

Inventory patterns can express intersections and exclusions, so keep the command visible in deployment records. A reviewer should be able to see whether the run selected one host, the whole group, or the whole group minus the canary.

Use `--limit` for emergency repair too. If `application-web-03` drifted after a manual fix, a narrow run can restore that host without touching the healthy fleet. The playbook remains the same, and the target set carries the operational intent.

`--limit` intersects the play's host pattern; it does not replace inventory safety. If the play selects `application_web` and the limit selects `canary`, the effective set is the hosts in both. A limit that names a host outside the play cannot broaden the play to include it.

Verify the outer boundary before mutation:

```bash
ansible-playbook -i inventories/prod application.yml --list-hosts
ansible-playbook -i inventories/prod application.yml \
  --limit application-web-01 --list-hosts
```

The first command proves what the play means under the loaded inventory. The second proves the canary intersection. If either list is surprising, stop at inventory and pattern selection rather than relying on a carefully typed production apply command.

`--limit` is not a rolling policy. Limiting to the entire service group still leaves the default play free to work broadly. Limiting to one host gives a canary only for that invocation; the next invocation needs `serial` or another explicit scope if it will include the rest.

A named canary is usually clearer than trusting whichever host happens to be first. Choose a representative replica with normal traffic, monitoring, and rollback access. A permanently idle or unusually powerful host may let a broken release pass while hiding the behavior that matters on ordinary nodes.

## How Does serial Create Rollout Batches?
<!-- section-summary: serial tells Ansible how many selected hosts should move through the play together before the next batch starts. -->

`serial` controls batch size inside the play. If the play targets six hosts and `serial: 2`, Ansible processes two hosts through the play, then moves to the next two. This is the core Ansible rolling-update tool.

```yaml
- name: Configure application web fleet
  hosts: application_web
  become: true
  serial: 2
  tasks:
    - name: Render application Nginx site
      ansible.builtin.template:
        src: application-nginx.conf.j2
        dest: /etc/nginx/conf.d/application.conf
        owner: root
        group: root
        mode: "0644"
      notify: Reload nginx
```

For a six-host service, `serial: 2` keeps four hosts serving traffic while two restart. That assumes the service has enough capacity, the load balancer drains traffic correctly, and the health check catches broken hosts before the next batch starts. Batch size is a capacity decision as well as an Ansible setting.

A simple capacity check helps. If six equal web hosts each carry about 17% of traffic, a batch of two removes about a third of capacity during restart. If normal peak traffic already uses 75% of fleet capacity, that batch may overload the remaining hosts. A safer first rollout might use `serial: 1`, drain one host from the load balancer, wait for healthy traffic, and then continue.

`serial` can also use staged lists. This pattern starts with one host, moves to two hosts, and then takes larger batches after the first evidence is good. It writes the rollout shape directly into the play:

```yaml
serial:
  - 1
  - 2
  - "50%"
```

That shape fits production changes where the first host is the highest-risk moment. Once the canary and the first small batch pass, the team may accept a larger batch for the rest of the fleet.

One detail matters with `run_once`. When `run_once` appears inside a play using `serial`, Ansible runs it once per batch. That is useful for batch-level checks, and surprising for one-time global actions like a database migration. For truly global work, use a separate play or a condition that targets one specific host from the full play host list.

`serial` can be an absolute count or a percentage. A count provides a fixed maximum. A percentage adapts as fleet size changes, but small fleets need care because rounding must still produce a usable batch. Progressive lists let the rollout increase confidence in stages: one canary, a small second batch, then a larger portion.

A rolling update needs something to preserve availability. Replicas may sit behind a load balancer, consumers may process a durable queue, or a clustered service may tolerate one member leaving. `serial` only limits how many hosts advance through the play; it does not drain traffic, transfer leadership, protect quorum, or ensure spare capacity.

Batch size must satisfy both capacity and fault-tolerance constraints:

```text
batch size ≤ spare serving capacity
batch size < failures that break quorum or redundancy
```

If the remaining fleet cannot carry peak load while a batch restarts, even a technically correct rollout can cause latency and errors. If taking two database nodes down breaks quorum, `serial: 2` is unsafe regardless of application traffic.

Rolling updates also create a mixed-version period. Old and new processes coexist, so protocols, cached data, queues, and schemas must tolerate both versions. A backwards-incompatible database migration cannot be made safe merely by selecting `serial: 1`; the first new host may break the remaining old hosts.

Database migrations are the classic global operation. Prefer an expand-and-contract sequence: add compatible schema first, deploy code that works with old and new forms, migrate data, then remove the old form in a later release. Run genuinely global one-time work in a separate play or pipeline phase with its own idempotency and failure plan.

`serial: 1` minimizes host exposure but can be too conservative for a large fleet when changes are slow and capacity is ample. Safety is not the smallest number by reflex. Choose the largest batch that respects capacity, fault tolerance, validation quality, and the time the service can remain in mixed-version state.

## How Do Health Checks Gate Propagation?
<!-- section-summary: Batch safety depends on checks that prove the current hosts are healthy before Ansible continues to the next hosts. -->

A batch boundary only helps when the playbook validates the batch before continuing. A service restart followed by no health check is just slower risk. The play should prove that the app is running and ready before the next batch starts.


![Batch Health Gate Flow](/content-assets/articles/article-infrastructure-as-code-ansible-safe-rollouts-check-mode-limits/batch-health-gate-flow.png)

*The batch gate shows a change, handler, health check, and continue-or-stop decision between rollout batches.*

For local service health, call the host's own endpoint:

```yaml
- name: Flush restart before health check
  ansible.builtin.meta: flush_handlers

- name: Check local application health
  ansible.builtin.uri:
    url: "http://127.0.0.1:8080/health"
    status_code: 200
    return_content: false
  register: application_health
  changed_when: false
```

`meta: flush_handlers` matters because handlers normally run later. If a template changed and notified a restart, the health check should observe the restarted service after it has consumed the new config.

For load-balanced services, local health may be only half of the story. The load balancer also needs to see the host as healthy before traffic can return. That check often runs from the control node or a dedicated admin host because the app host may not have credentials or network access to query the load balancer API.

Production teams often pair local checks with an outside signal. The playbook can prove `http://127.0.0.1:8080/health`, while the release checklist checks load balancer health, error-rate dashboards, or a synthetic application request. Local readiness tells you the process is up. External health tells you users can reach it through the real path.

```yaml
- name: Wait for current host to be healthy in the load balancer
  ansible.builtin.command:
    cmd: "lbctl target-health --service application --host {{ inventory_hostname }}"
  delegate_to: lb-admin-01
  register: lb_health
  changed_when: false
  failed_when: lb_health.stdout != "healthy"
```

This task belongs to the current app host in the output, but it runs on `lb-admin-01`. That gives the rollout a clean per-host story: update this host, restart this host, prove the local app is healthy, prove the load balancer sees it as healthy, then move to the next host.

Several kinds of health answer different questions:

- Process health asks whether the service is running.
- Local readiness asks whether this instance can serve its dependencies.
- Load-balancer health asks whether the traffic layer will route to it.
- Synthetic health asks whether a user path works through DNS, TLS, routing, and the application.
- Fleet health asks whether error rate, latency, saturation, and capacity remain acceptable after the batch.

Use more than one signal when the risk requires it. A process can be running while returning errors. A local endpoint can succeed while the load balancer has the wrong registration. One successful synthetic request can coexist with a rising fleet-wide error rate.

Services often need time to become ready. `until` turns a one-shot check into a bounded wait:

```yaml
- name: Wait for local application readiness
  ansible.builtin.uri:
    url: http://127.0.0.1:8080/health
    status_code: 200
  register: application_health
  changed_when: false
  until: application_health.status | default(0) == 200
  retries: 12
  delay: 5
```

This allows up to about a minute for startup while still producing a definite failure. An unbounded wait hides a stuck release; a single immediate check confuses normal startup time with failure.

A failed health check does not by itself define fleet behavior. Ansible can stop work on that host and continue elsewhere unless the play's failure policy says otherwise. The health task and the stop condition must therefore be designed together so negative evidence actually prevents propagation.

## When Should a Failure Stop the Rollout?
<!-- section-summary: Failure controls decide when the play should stop, and handler timing decides whether changed hosts finish their restart path before validation. -->

By default, Ansible stops running tasks on a host after a task fails on that host and continues with other hosts. During a production rollout, that default may be too loose. If one host in a small batch fails a health check, continuing to the next batch can spread the same bad change.

Use `any_errors_fatal: true` when one host failure should stop the whole play. This fits changes where a single failure suggests a shared playbook or artifact problem.

```yaml
- name: Configure application web fleet
  hosts: application_web
  become: true
  serial: 2
  any_errors_fatal: true
```

Use `max_fail_percentage` when a small number of failures is acceptable but a larger rate should stop the rollout. Be careful with small batches because percentages can be unintuitive. With `serial: 2`, one failed host is already half the batch.

```yaml
- name: Configure application web fleet
  hosts: application_web
  become: true
  serial: 2
  max_fail_percentage: 0
```

Handlers deserve attention in failure paths. A task can render a config file and notify a handler, then a later task can fail before handlers run. That can leave a host with changed files and an old service process. Use `meta: flush_handlers` before health checks, and consider `force_handlers` only when the team understands that it can run notified handlers even after later task failures.

```yaml
- name: Validate Nginx config before reload
  ansible.builtin.command:
    cmd: nginx -t
  register: nginx_validate
  changed_when: false
  failed_when: nginx_validate.rc != 0

- name: Flush safe reload after validation
  ansible.builtin.meta: flush_handlers
```

This ordering gives the rollout a better failure story. Render the file, validate the config, then reload and check health. If validation fails, Ansible stops before reloading Nginx with a broken config.

Treat host errors as a rollout budget. `any_errors_fatal: true` says the budget is zero for the play: one fatal host failure stops active work across hosts. `max_fail_percentage` permits a bounded proportion before the play stops, and its threshold behavior matters with small batches. Calculate the actual host count rather than assuming a percentage “sounds small.”

Failure policy should match what a failure implies. If all hosts use one artifact and template, the first canary failure strongly predicts a shared defect, so a hard stop is sensible. If a known fraction of an unreliable legacy fleet can fail for host-specific reasons, a tolerance may be acceptable while still preventing broad propagation.

Handler timing is part of the gate. A notified restart that has not run means the health check may still observe the old process with the new file on disk. Flush after validation and before readiness checks. If a later unrelated task fails, decide whether `force_handlers` would restore consistency or create a risky restart on an already failing host.

`ansible_play_batch` exposes the hosts in the current serial batch. It is useful for batch notifications, delegated control-plane updates, or checks that need to know the cohort. `ansible_play_hosts_all` refers to the full active play set, which is the better reference for truly global selection logic.

## How Do Concurrency Controls Differ?
<!-- section-summary: forks, throttle, order, and delegation shape how much work Ansible attempts at once inside and around serial batches. -->

`serial` controls host batch size. Other controls shape concurrency inside that batch. The most visible one is `forks`, which controls how many hosts Ansible can work on in parallel from the control node.

```bash
ansible-playbook \
  -i inventories/prod \
  application.yml \
  --limit application_web \
  --forks 10
```

If `serial: 2`, the serial batch still caps that play at two hosts at once. The serial batch is the tighter boundary. Forks still matter across broader plays and across tasks that target larger host sets.

`throttle` limits a specific task or block. This helps when a task calls a rate-limited API, uses a shared admin host, or performs a heavier operation than the rest of the play.

```yaml
- name: Query load balancer target health
  ansible.builtin.command:
    cmd: "lbctl target-health --service application --host {{ inventory_hostname }}"
  delegate_to: lb-admin-01
  throttle: 1
  register: lb_health
  changed_when: false
```

`order` controls which hosts Ansible chooses first from the selected set. This can be useful when you want a stable or sorted order, but a named canary through `--limit` is usually clearer than relying on inventory ordering for the first production host.

Delegation can create hidden concurrency. If every app host delegates a load balancer task to the same admin host, that admin host receives multiple operations. `serial` and `throttle` keep that from becoming an accidental burst.

The hierarchy is worth keeping explicit:

```text
selected host set
  ↓ bounded by serial batch
strategy schedules tasks within that batch
  ↓ bounded by forks at the controller
individual task or block
  ↓ optionally bounded further by throttle
```

The tightest relevant bound wins. Raising `forks` cannot make a `serial: 2` play operate on ten hosts in that play batch. `throttle: 1` can serialize one delegated API task even while other tasks use the batch's normal parallelism.

Strategy controls scheduling semantics. The default linear strategy keeps hosts roughly aligned on the same task before moving forward. A free strategy can let a fast host advance while a slow host remains earlier in the play, which may undermine a rollout that assumes batch-wide gates. Choose strategy as part of the safety design, not only for speed.

`order` controls which hosts enter early batches, but inventory ordering can change with dynamic sources. Use an explicit canary limit or dedicated canary group when the first host matters. A canary is a deliberate evidence-gathering role; a serial batch is a scheduling unit. One host can serve both purposes, but the concepts are not identical.

Delegated and controller-local tasks need their own capacity budgets. A batch of ten may be safe for application capacity while overloading one shared admin node or rate-limited API. Concurrency design must account for every execution boundary, not only the target fleet.

## How Should Recovery Work After a Failed Batch?
<!-- section-summary: Rollback needs a prepared previous state, a target limit, and verification that the recovered hosts are healthy before the rollout resumes. -->

Rollback should be planned before the first apply. For the application Nginx config, rollback might mean reverting the config change commit and rerunning the playbook against the failed host or batch. For a package deployment, rollback may mean pinning the previous package version and rerunning the role. For a database migration, rollback may require a separate database recovery plan.

A simple config rollback command uses the same narrow target:

```bash
git revert <change-commit>

ansible-playbook \
  -i inventories/prod \
  application.yml \
  --limit application-web-01 \
  --vault-id prod@prompt
```

If a batch fails after two hosts changed, keep the rollback target to that batch first. Restore those hosts, verify health, then decide whether to pause the rollout or fix forward. Avoid jumping straight back to the whole group while the failure cause is still unclear.

Ansible blocks can make local recovery clearer. A block can drain a host, update it, and re-add it to the load balancer. A rescue section can try to re-enable the host or leave a clear failure message when the update fails.

```yaml
- name: Update one application host with load balancer recovery
  block:
    - name: Disable current host in load balancer
      ansible.builtin.command:
        cmd: "lbctl disable --service application --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01

    - name: Render application Nginx site
      ansible.builtin.template:
        src: application-nginx.conf.j2
        dest: /etc/nginx/conf.d/application.conf
      notify: Reload nginx

    - name: Flush reload before validation
      ansible.builtin.meta: flush_handlers

    - name: Check local application health
      ansible.builtin.uri:
        url: "http://127.0.0.1:8080/health"
        status_code: 200
      changed_when: false

    - name: Enable current host in load balancer
      ansible.builtin.command:
        cmd: "lbctl enable --service application --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
  rescue:
    - name: Keep failed host out of load balancer
      ansible.builtin.command:
        cmd: "lbctl disable --service application --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
```

The rescue path should match your service design. Some teams prefer leaving a failed host out of rotation until a person investigates. Others prefer rolling back the local config and re-enabling the host automatically. The playbook should make that policy visible.

Ansible does not provide a universal automatic rollback because resources have different reversibility. A previous template can be restored, a package may support downgrade, a destructive schema change may not, and a message sent to an external API cannot always be unsent. Define recovery per state transition rather than expecting “undo the playbook.”

Do not accidentally re-enable an unhealthy machine in `always`. An `always` section runs after success or failure, so an unconditional load-balancer enable can return a broken host to traffic. Re-enable only after the recovery path proves readiness; otherwise leave the host drained with a clear incident signal.

“Rollback everything” is not always the safest response. If two new-version hosts are healthy and one failed for a local disk problem, reverting the healthy nodes may increase change and capacity loss. Containment stops propagation. Recovery decides whether each affected host should roll back, fix forward, rebuild, or remain out of service.

Three rollout invariants make this concrete:

1. A host must not re-enter service until required health checks pass.
2. The remaining fleet must retain enough capacity and fault tolerance while a batch is unavailable.
3. No later batch starts after evidence crosses the chosen failure threshold.

Blocks and rescue can encode host-local compensation, but the operator still needs a fleet-level decision after a batch failure. Record which hosts changed, which remain drained, which version each runs, and whether mixed-version compatibility still holds. Recovery begins with that observed state, not an assumption that every host reached the same task.

Rolling updates fundamentally separate containment from recovery. `--limit`, `serial`, and stop conditions contain a bad release. Version pinning, restored config, backups, rebuilds, and application-specific procedures recover state. Designing both before the run prevents a clean stop from being mistaken for a complete rollback plan.

## How Do You Design a Safe Rolling Update?
<!-- section-summary: A production rollout combines a canary limit, serial batches, handler flushes, service checks, load balancer checks, and stop conditions. -->

Here is a complete rollout shape for the application web fleet:


![Rollouts Summary](/content-assets/articles/article-infrastructure-as-code-ansible-safe-rollouts-check-mode-limits/rollouts-summary.png)

*The summary turns rollout safety into five moves: limit, batch, verify, stop, and recover.*

```yaml
- name: Roll application web safely
  hosts: application_web
  become: true
  serial:
    - 1
    - 2
    - "50%"
  any_errors_fatal: true
  tasks:
    - name: Disable current host in load balancer
      ansible.builtin.command:
        cmd: "lbctl disable --service application --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
      throttle: 1

    - name: Render application Nginx site
      ansible.builtin.template:
        src: application-nginx.conf.j2
        dest: /etc/nginx/conf.d/application.conf
        owner: root
        group: root
        mode: "0644"
      notify: Reload nginx

    - name: Validate Nginx config
      ansible.builtin.command:
        cmd: nginx -t
      register: nginx_validate
      changed_when: false
      failed_when: nginx_validate.rc != 0

    - name: Flush reload before health checks
      ansible.builtin.meta: flush_handlers

    - name: Check local application health
      ansible.builtin.uri:
        url: "http://127.0.0.1:8080/health"
        status_code: 200
        return_content: false
      changed_when: false

    - name: Enable current host in load balancer
      ansible.builtin.command:
        cmd: "lbctl enable --service application --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
      throttle: 1

    - name: Confirm load balancer sees current host healthy
      ansible.builtin.command:
        cmd: "lbctl target-health --service application --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
      register: lb_health
      changed_when: false
      failed_when: lb_health.stdout != "healthy"

  handlers:
    - name: Reload nginx
      ansible.builtin.service:
        name: nginx
        state: reloaded
```

The first command can still use a narrow canary limit:

```bash
ansible-playbook -i inventories/prod application.yml --limit application-web-01 --vault-id prod@prompt
```

After the canary passes, the same playbook can continue through the group with its own serial stages:

```bash
ansible-playbook -i inventories/prod application.yml --limit 'application_web:!application-web-01' --vault-id prod@prompt
```

That is the safety stack in order. Preview the change, apply it to one host, roll through controlled batches, validate each batch, and stop when the evidence says stop. Ansible gives you the controls, and the production process decides how strict they should be.

`serial: 1` does not magically make an unsafe release safe. It bounds host propagation, but the first host can still corrupt shared data, publish an incompatible schema, saturate a dependency, or make an irreversible API change. The change itself must tolerate mixed versions and have appropriate validation and recovery.

It can also be too conservative. If each restart takes twenty minutes and the fleet has one hundred replicas, a one-at-a-time rollout may leave old and new versions mixed for more than a day. That long compatibility window carries risk of its own. Increase batches only after the canary proves behavior and capacity calculations show the remaining fleet can serve traffic.

The most useful batch formula is constrained by the smallest safety margin:

```text
safe batch size = minimum of
  spare-capacity allowance
  fault-tolerance allowance
  validation confidence allowance
  shared-control-plane capacity
  acceptable blast radius
```

These are operational quantities, not values Ansible can infer from a host count. The service owner supplies peak load, redundancy, quorum, startup time, API quotas, and rollback requirements. The playbook then encodes the chosen boundaries.

Global one-time operations deserve their own design. A migration, release announcement, or artifact signature check should not rely casually on `run_once` inside a serial play because it may execute once per batch. Place global preflight in an earlier localhost or designated-host play, make it idempotent, and record its result before the rolling play begins.

Handlers also need a batch-aware design. A config change can notify a restart for every host in the current batch. Flush only after validation that can happen before restart, then perform readiness checks. If a batch stops mid-play, inspect which handlers ran and which hosts have new files but old processes before choosing recovery.

The practical hierarchy of rollout safety is:

1. Verify the intended inventory and play target set.
2. Preview supported changes and review sensitive diffs safely.
3. Apply to one representative canary.
4. Validate local readiness, traffic-path health, and fleet signals.
5. Advance through capacity-aware serial batches.
6. Stop when the failure budget is crossed.
7. Contain unhealthy hosts and recover from observed state.
8. Record targets, versions, overrides, health evidence, and recovery actions.

This creates a strong propagation invariant: no new host receives the release until the current batch has completed its required state changes and produced acceptable evidence. It also creates a capacity invariant: every batch leaves enough healthy service to carry expected traffic and preserve fault tolerance.

When a batch fails, Ansible's recap is only the beginning of diagnosis. Separate hosts that never started, hosts that changed successfully, hosts that changed files but did not restart, hosts that restarted but failed readiness, and hosts that were drained from traffic. Those states demand different recovery actions. A single “failed batch” label hides the exact boundary each host reached.

The playbook can improve that visibility with registered results, clear task names, deployment events, and load-balancer state checks. An external release record should capture `ansible_play_batch`, the artifact or package version, runtime overrides, and the health evidence that allowed or blocked advancement. This matters when an operator resumes later from a different terminal or controller job.

Fault tolerance can change during the rollout. One host may already be unhealthy before the deployment starts, reducing the safe batch below the planned number. Add a fleet preflight that counts healthy serving replicas or verifies quorum before draining the canary. Re-evaluate after each batch rather than assuming the initial capacity remains available.

Traffic drain time belongs in the calculation too. Removing a target from a load balancer may stop new connections while existing sessions continue. Restarting immediately can terminate those sessions even though the target is marked draining. Wait for the service's real connection-drain condition or an approved timeout before mutation, and verify registration after readiness.

Progressive propagation should be evidence-led rather than merely time-led. A fixed sleep can allow metrics to arrive, but elapsed time alone does not prove health. Define which error-rate, latency, saturation, queue, or synthetic thresholds must remain acceptable during the observation window. The next batch should start because evidence passed, not because the timer expired.

Finally, remember that containment controls do not remove the need for idempotency. A recovered or partially changed host may need the playbook again. Tasks should converge from old, new, and interrupted states where practical, and one-time operations should record enough state to avoid unsafe repetition. Safe rollout mechanics and safe task semantics reinforce each other.

So far the safety discussion has focused on what Ansible changes and how quickly it changes hosts. The next article asks where a task actually runs. That matters because load balancer calls, artifact checks, API updates, and local validation often belong on the control node or a delegated host rather than on the app server being updated.

One final distinction is between rollout sequence and controller scheduling. A play can select a canary, process a serial batch, and still run multiple tasks concurrently inside that batch. Conversely, a low fork count can slow a broad unsafe selection without making it a deliberate rolling update. Always reason from the outer target set inward: eligible hosts, current batch, scheduling strategy, fork capacity, and any task throttle.

Host order also belongs to the rollout contract when early hosts are special. Dynamic inventory order can vary, so `order` alone is a weak way to identify a canary. Use a named host or cohort, prove it with `--list-hosts`, and keep `ansible_play_batch` available for batch-level events. This makes the deployment record explain which replicas supplied the evidence that allowed propagation.

Finally, measure availability from the user path rather than host count alone. Six registered hosts do not provide six units of capacity when one was unhealthy before the release, another is draining long-lived connections, and a third runs on smaller hardware. Preflight the actual healthy capacity, choose the batch, and re-check capacity after every transition. If the margin disappears, stop even when Ansible has not crossed its configured host-failure percentage. The production invariant is service safety, while the Ansible controls are mechanisms that help enforce it.

Rollout timing should account for observation delay. Metrics may arrive after the task finishes, caches may warm slowly, and queued work may reveal incompatibility only after several minutes. Define an observation window and the signals that must remain within threshold before a larger batch. A blind sleep is weaker than polling or reviewing the actual signals, but instant advancement can outrun the monitoring system that would have warned the team.

Resuming a stopped rollout is a new decision, not an automatic continuation. Recompute healthy capacity, inventory membership, already changed hosts, current version distribution, and the reason for the earlier stop. Then select the remaining set explicitly. Re-running the original broad command can revisit recovered or manually repaired hosts and erase the evidence that informed the pause.

The default `linear` strategy advances hosts through each task in lockstep within the current batch, while `serial` controls which hosts belong to that batch. Those are different controls: strategy governs task progression and `serial` bounds propagation. Verify the effective strategy when reasoning about handler timing, delegated checks, or a failure threshold, because a custom strategy can change when hosts reach each gate.

## Check Your Answers

:::expand[Why Is Deployment a Propagation Problem?]{kind="recap"}
A release gains exposure as it reaches more hosts. Scope, batch size, health evidence, and stop rules control how quickly uncertainty propagates through the fleet.
:::

:::expand[How Does --limit Set the Outer Boundary?]{kind="recap"}
`--limit` intersects the play target with a canary or subset. Verify both the broad play set and limited result; a limit narrows one run but does not define rolling behavior.
:::

:::expand[How Does serial Create Rollout Batches?]{kind="recap"}
`serial` advances selected hosts in absolute, percentage, or progressive batches. Choose sizes from spare capacity, redundancy, mixed-version compatibility, and acceptable exposure.
:::

:::expand[How Do Health Checks Gate Propagation?]{kind="recap"}
Use bounded readiness waits plus load-balancer, synthetic, and fleet signals where appropriate. A health failure must connect to a stop rule to prevent later batches.
:::

:::expand[When Should a Failure Stop the Rollout?]{kind="recap"}
Treat failures as a budget. Use hard or percentage thresholds that match what one failure predicts, and flush handlers so validation observes the intended process state.
:::

:::expand[How Do Concurrency Controls Differ?]{kind="recap"}
Scope selects eligible hosts, `serial` sets batches, strategy schedules them, forks limit controller parallelism, and throttle narrows particular shared work.
:::

:::expand[How Should Recovery Work After a Failed Batch?]{kind="recap"}
Contain first, keep unhealthy hosts out of traffic, inspect actual changed state, and choose rollback, fix-forward, rebuild, or pause per resource and host.
:::

:::expand[How Do You Design a Safe Rolling Update?]{kind="recap"}
Combine verified targets, a representative canary, capacity-aware batches, handler timing, layered health, strict propagation gates, and a prepared application-specific recovery path.
:::

---

**References**

- [Controlling playbook execution: strategies and more](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_strategies.html) - Documents `serial`, `throttle`, `order`, `run_once`, and execution strategy behavior.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Command reference for `--limit`, `--forks`, inventory selection, and playbook execution flags.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Covers `any_errors_fatal`, `max_fail_percentage`, handler behavior, `failed_when`, and block rescue handling.
- [Controlling where tasks run: delegation and local actions](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_delegation.html) - Explains `delegate_to`, load balancer orchestration examples, and delegated task behavior.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Provides the preview step that usually comes before a controlled rollout.
