---
title: "Plugins and Configuration"
description: "Eliminate manual snowflake installations, configure systems declaratively using Jenkins Configuration as Code, and build immutable Docker controllers."
overview: "Operating a Jenkins controller through manual UI changes creates fragile environments that teams struggle to reproduce. Learn how pinned plugin sets, Jenkins Configuration as Code, reload and restart decisions, and a steady upgrade cadence make Jenkins operations safer."
tags: ["jenkins", "jcasc", "configuration-as-code", "docker"]
order: 4
id: article-cicd-jenkins-plugins-and-configuration
aliases:
  - /cicd/jenkins/plugins-and-configuration
---

## Table of Contents

1. [Why Does Manual Controller Configuration Become Risky?](#why-does-manual-controller-configuration-become-risky)
2. [How Does plugins.txt Define Controller Software?](#how-does-pluginstxt-define-controller-software)
3. [How Does jenkins.yaml Define Controller Configuration?](#how-does-jenkinsyaml-define-controller-configuration)
4. [Why Do Plugins and Configuration Form One Dependency Graph?](#why-do-plugins-and-configuration-form-one-dependency-graph)
5. [When Is a Reload Enough and When Is a Restart Required?](#when-is-a-reload-enough-and-when-is-a-restart-required)
6. [How Should Jenkins Core and Plugins Be Upgraded?](#how-should-jenkins-core-and-plugins-be-upgraded)
7. [How Do Rebuild and Boot Tests Reveal Controller Failures?](#how-do-rebuild-and-boot-tests-reveal-controller-failures)
8. [How Does Repeatable Jenkins Configuration Fit Together?](#how-does-repeatable-jenkins-configuration-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A Jenkins controller has two kinds of operational state. The first kind is runtime state, such as build history, queued work, logs, and workspaces. The second kind is configuration state, such as installed plugins, security realm, authorization strategy, global tools, cloud agents, credentials references, and system messages. Runtime state helps you understand what happened. Configuration state decides what the controller can do next.

The platform team starts with one manually configured controller. An administrator installs plugins through the UI, creates local users, adds a role strategy, configures Kubernetes agents, and pastes tool paths into Manage Jenkins. Six months later, the controller is important enough that every release depends on it, but nobody can rebuild the same controller from a clean machine without clicking through pages from memory.

That kind of controller is often called a **snowflake**. A snowflake controller has a unique history of manual changes, plugin upgrades, saved forms, and emergency fixes. It may work today, but it creates fear around every upgrade because the team cannot confidently reproduce it in staging or roll it back after a bad change.

Keep these questions in view as you work through the lesson:

1. **Why Does Manual Controller Configuration Become Risky?**
2. **How Does plugins.txt Define Controller Software?**
3. **How Does jenkins.yaml Define Controller Configuration?**
4. **Why Do Plugins and Configuration Form One Dependency Graph?**
5. **When Is a Reload Enough and When Is a Restart Required?**
6. **How Should Jenkins Core and Plugins Be Upgraded?**
7. **How Do Rebuild and Boot Tests Reveal Controller Failures?**
8. **How Does Repeatable Jenkins Configuration Fit Together?**

## Why Does Manual Controller Configuration Become Risky?
<!-- section-summary: A Jenkins controller turns risky when plugins, security settings, credentials references, and agent definitions live only as manual UI state. -->

The production target is a **repeatable controller**. The plugin set comes from a versioned file. The controller configuration comes from YAML. The image build installs plugins before startup. A staging controller boots from the same inputs as production. A rollback means running a previous controller image and configuration version, then restoring compatible state if needed.

This article follows the path from manual state to repeatable state. First the team pins plugin binaries. Then they write `jenkins.yaml` for controller configuration. After that they learn how plugin dependencies fail, when JCasC reload is enough, when a restart is needed, and how to schedule upgrades without turning every Friday into a release freeze.

Three states can diverge on a long-lived controller. The **runtime state** is what the current Java process and loaded plugins are actually doing. The **persisted state** is what years of UI saves and `$JENKINS_HOME` files record. The **desired state** is what the team intends the next controller to contain. Trouble starts when operators cannot tell which one is authoritative.

Desired-state configuration reverses that uncertainty. Instead of discovering a controller by clicking through its pages, the team reviews a declaration, builds a controller from it, and tests whether reality converges on that declaration. Manual UI changes then become temporary drift rather than an undocumented new source of truth.

Plugins and configuration occupy different layers. Plugins are executable code loaded into the controller process. Configuration is data interpreted by Jenkins core and those plugins. `plugins.txt` selects the code and versions that exist; `jenkins.yaml` supplies the desired settings to that code. Neither file can replace the other.

## How Does plugins.txt Define Controller Software?
<!-- section-summary: A pinned plugins.txt makes the controller plugin set reviewable, rebuildable, and testable before production startup. -->

Jenkins plugins are packaged extension files that add features to the controller. Pipelines, Git integrations, credentials bindings, Kubernetes agents, role-based authorization, and Configuration as Code all arrive through plugins. Jenkins can install plugins through the web UI, the Jenkins CLI, or the plugin installation manager used by the official Docker image.

A **pinned plugin set** is a file that lists plugin IDs and exact versions. In many Jenkins Docker builds, the file is called `plugins.txt`. The official plugin installation manager, available as `jenkins-plugin-cli` in the Jenkins Docker image, reads that file, resolves dependencies, downloads plugin files, and reports compatibility or security warnings.

The file shape looks like this:

```bash
configuration-as-code:1998.v3e50e6e9d3d1
credentials-binding:725.ve52b_2328a_fde
git:5.8.0
kubernetes:4384.v1b_6367f393d9
role-strategy:840.v206ff7f7312e
workflow-aggregator:608.v67378e9d3db_1
```

Those version numbers are examples from a tested controller image, not a shopping list to copy blindly. A real team gets plugin versions from a staging update plan, reviews Jenkins security advisories, runs the plugin manager, boots a staging controller, and then commits the tested plugin file. The important pattern is `plugin-id:version`, because a controller build should install the same plugin set every time.

A Dockerfile can install that file during image build:

```dockerfile
FROM jenkins/jenkins:lts-jdk21

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

COPY jenkins.yaml /usr/share/jenkins/ref/jenkins.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/jenkins.yaml
```

This gives the platform team a controller image that carries the intended plugin binaries and the intended configuration file. The running container still writes operational state to `$JENKINS_HOME`, but the controller image documents how the software and configuration were produced.

Pinning top-level plugins is only the first layer. Plugins have dependencies, and those dependencies also have versions. The plugin manager resolves that tree during the build. Real teams keep the build output as evidence, because the resolved dependency tree matters when a later upgrade changes a plugin that nobody wrote directly in `plugins.txt`.

Pinning has a subtle trap: a short file of only top-level plugins does not by itself record every transitive version that was selected at build time. A dependency resolver may choose newer compatible transitive releases later, so two builds from the same short input can drift if update-center metadata has changed. Teams that require exact reconstruction retain the resolved list or generate a fully pinned set after testing, while still distinguishing direct choices from transitive dependencies for maintenance.

Blindly pinning every old transitive plugin forever creates the opposite problem. A direct plugin upgrade may require a newer dependency, while the frozen dependency line blocks resolution. The maintained artifact is therefore a tested **plugin set**—core, Java, direct plugins, transitive plugins, and compatibility—not a collection of unrelated version strings.

A staging smoke run should prove both startup and configuration before production uses the image. One practical flow is to build the image, boot it with staging secrets, check that the login page responds, then run a harmless pipeline that needs a configured agent label.

```bash
docker build -t company-jenkins:lts-2026-06 .
docker run -d --name company-jenkins-smoke -p 8080:8080 \
  -e JENKINS_ADMIN_PASSWORD=example-staging-password \
  company-jenkins:lts-2026-06
curl -fsS http://localhost:8080/login >/dev/null
docker rm -f company-jenkins-smoke
```

The exact smoke job depends on the installation, but the result should answer three questions: did Jenkins boot, did JCasC apply, and can one representative pipeline reach the agent and tools it expects?

![Pinned Jenkins controller build showing plugins.txt exact plugin versions, jenkins.yaml controller config, build image, staging smoke test, and production controller](/content-assets/articles/article-cicd-jenkins-plugins-and-configuration/pinned-controller-build.png)

*A repeatable controller build turns plugin versions and controller configuration into reviewed inputs, then proves the image in staging before production uses it.*

## How Does jenkins.yaml Define Controller Configuration?
<!-- section-summary: jenkins.yaml describes controller settings in YAML, including system settings, tools, plugins, credentials references, and access control. -->

**Jenkins Configuration as Code**, usually shortened to **JCasC**, lets administrators describe controller configuration in YAML. Instead of clicking through Manage Jenkins pages and hoping the controller keeps the right XML files, the team stores the intended configuration in Git. Jenkins reads the YAML and applies those settings to the controller.

The default JCasC file has several common top-level areas. `jenkins` configures the root Jenkins object, such as executors, mode, nodes, security realm, and authorization. `tool` configures tools such as JDK, Maven, or Git installations. `unclassified` configures many plugin-specific global settings. `credentials` can define credentials entries, although teams often combine JCasC with external secret systems or environment variables so raw secrets stay out of Git.

Here is a small `jenkins.yaml` for the platform team:

```yaml
jenkins:
  systemMessage: "company Jenkins controller managed by code"
  numExecutors: 0
  mode: EXCLUSIVE
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: "jenkins-admin"
          password: "${JENKINS_ADMIN_PASSWORD}"
  authorizationStrategy:
    roleBased:
      roles:
        global:
          - name: "admin"
            permissions:
              - "Overall/Administer"
            assignments:
              - "jenkins-admin"
tool:
  maven:
    installations:
      - name: "maven-3.9"
        home: "/opt/tools/maven-3.9"
unclassified:
  location:
    url: "https://jenkins.example.com/"
```

This file defines the controller's identity. It sets the system message, removes controller executors, disables public signup, creates an administrator from an environment-backed password, assigns the admin role, registers a Maven tool, and sets the Jenkins URL. A reviewer can inspect all of that in a pull request.

The YAML still needs care. Indentation changes meaning. Plugin configuration keys depend on the installed plugin versions. Some values, such as `false`, `yes`, and numbers, can become YAML booleans or numeric types. The JCasC UI can export current configuration, and many teams use that export as a starting point before trimming noisy or environment-specific values.

The file should also separate **configuration** from **secret value**. A credentials entry can reference `${VARIABLE_NAME}`, and the actual value can come from the runtime environment, Kubernetes secret, Docker secret, Vault integration, or another secret manager. The article on credentials explains the secret side in detail. For this article, the key idea is simple: Git should hold the shape of the controller, while secret stores hold secret values.

`jenkins.yaml` is not a Jenkinsfile. A Jenkinsfile describes application delivery: build, test, scan, publish, and deploy. JCasC describes the automation platform: security realm, authorization, executors, clouds, tools, root URL, credentials entries, and plugin settings. Keeping the layers separate lets application teams change their pipeline without reconfiguring the controller and lets platform engineers reproduce the controller without editing every repository.

UI edits become dangerous once JCasC is authoritative. A click may change the running or persisted controller, but the next JCasC reload or replacement container can restore the declared value. If the click represents a legitimate change, export or inspect it, translate it into the reviewed YAML source, test it, and redeploy. Otherwise the UI and Git tell two different stories.

![Inside jenkins.yaml showing jenkins, securityRealm, authorizationStrategy, tool, unclassified, credentials references, and configuration as code](/content-assets/articles/article-cicd-jenkins-plugins-and-configuration/jcasc-anatomy.png)

*JCasC keeps the controller shape in Git, while secret values stay in runtime secret stores or external providers instead of being committed beside the configuration.*

## Why Do Plugins and Configuration Form One Dependency Graph?
<!-- section-summary: Plugin dependency failures come from version constraints, removed APIs, mixed plugin trees, and controller-core compatibility. -->

Jenkins plugin failures can look dramatic because plugins run inside the same controller process. One plugin update can add a dependency on a newer library. Another plugin can still call an older API. A controller upgrade can raise the minimum Jenkins core version that a plugin expects. The result can appear as boot failures, missing dependency warnings, broken pipeline steps, or Java errors such as `NoSuchMethodError`.

That family of problems often gets called **dependency hell**. In Jenkins, it usually means the installed plugin tree has versions that cannot work together cleanly. The problem can happen after a UI update, a partial rollback, a manually copied `.hpi` file, or a `plugins.txt` change that was never tested on a staging controller.

The platform team sees this after upgrading the Git plugin. Checkout starts failing with a Java method error in `git-client`. The team checks Manage Jenkins, System Information, and the plugin manager output from the image build. They discover that the Git plugin expects a newer `git-client` dependency than the one baked into the controller image.

There are a few common patterns:

| Failure pattern | What it means | Safer response |
|---|---|---|
| Missing dependency | A plugin requires another plugin that the controller lacks | Rebuild the image through `jenkins-plugin-cli` and test the resolved set |
| Minimum version conflict | One plugin needs a newer dependency version | Let the plugin manager resolve the higher version, then stage the full set |
| Runtime API error | A plugin calls a method that the loaded dependency lacks | Roll back the plugin set or update the related plugin family together |
| Core version mismatch | A plugin requires a newer Jenkins core | Upgrade Jenkins LTS in staging before using that plugin version |
| Partial manual update | UI state and image state diverge | Rebuild from `plugins.txt` and remove manual plugin changes from production |

The safe habit is to upgrade a plugin set, not one lonely plugin on a live controller. A plugin set includes the requested plugins, transitive dependencies, Jenkins core version, Java version, and JCasC file that configures them. The staging controller should boot from the same image pattern as production so dependency errors appear before the production restart window.

Plugin health and security warnings also matter. The Jenkins plugin site shows health scores, maintainers, releases, dependencies, and previous security warnings. A plugin with low maintenance signals may still be necessary, but the team should know that risk before placing it in a production controller.

Configuration has its own dependency graph. A JCasC key under `unclassified` exists only if the responsible plugin and compatible configurator are installed. A role-based authorization block depends on the role-strategy plugin. A Kubernetes cloud block depends on the Kubernetes plugin. A credentials type depends on the plugin that contributes it. YAML can be syntactically correct yet impossible to apply because the software graph does not provide the requested objects.

That is why a JCasC `ConfiguratorException` is often a plugin-set problem in disguise. Diagnose from the bottom up: did the core start, did every plugin load, did JCasC find the expected configurators, did secrets resolve, and only then did pipelines run? Updating a plugin may rename or reshape configuration, so plugin and YAML changes must be tested together.

## When Is a Reload Enough and When Is a Restart Required?
<!-- section-summary: JCasC reload applies many YAML configuration changes, while plugin binaries and some core settings need a controller restart. -->

Jenkins operators need to know which changes can reload safely and which changes need a restart. A **reload** asks Jenkins or a plugin to re-read configuration while the controller keeps running. A **restart** stops the controller process and starts it again, which reloads plugin classes, JVM settings, startup environment, and controller initialization code.

JCasC supports reloading existing configuration from the Configuration as Code page or through automation. This works well for many YAML-only changes, such as a system message, a tool path, a role assignment, or a plugin setting that the plugin supports during reload. The platform team uses reload for small, tested JCasC edits during a normal operations window.

Plugin binary changes need a restart. Jenkins loads plugin classes during startup, so installing or changing a `.jpi` file in the plugin directory does not give every running pipeline a clean new classpath. A controller image with a new `plugins.txt` should boot as a new controller process in staging first, then production during a planned window.

JVM setting changes also need a restart. Heap size, garbage collector settings, Java version, and `JAVA_OPTS` apply when the Java process starts. A JCasC reload can change Jenkins configuration, but it cannot change the memory flags of the process that is already running.

The decision table looks like this:

| Change | Usually enough | Why |
|---|---|---|
| System message in `jenkins.yaml` | JCasC reload | Jenkins can apply the setting at runtime |
| Role assignment in `jenkins.yaml` | JCasC reload | Authorization config can refresh from YAML |
| New credential reference shape | JCasC reload plus validation | The config changes, while secret availability still needs a runtime check |
| New plugin version | Restart from a tested image | Plugin classes load at startup |
| Jenkins LTS version bump | Restart from a tested image | Core application changes at process startup |
| Heap size or Java flags | Restart | JVM flags apply when Java starts |
| Agent pod template in JCasC | Reload plus a test build | New agent definitions should be exercised by a real job |

The safest reload process still includes validation. The platform team applies the YAML change on staging, checks the JCasC export and UI, runs a sample pipeline that uses the affected setting, then applies the same commit to production. Reload is convenient, but staging proves that the setting works with the installed plugin versions.

Do not confuse JCasC reload with Jenkins' older “Reload Configuration from Disk” operation. JCasC reload re-applies the declared YAML through configurators. Reload-from-disk asks Jenkins to re-read persisted `$JENKINS_HOME` configuration and can discard unsaved in-memory changes; it is not a substitute for applying the desired JCasC source.

A restart is more disruptive, but it is also a test of reproducibility. The process must rediscover its core version, Java flags, plugin graph, environment, secret references, storage, and JCasC configuration from startup inputs. If operators avoid restart because they do not know whether Jenkins will return, the controller is already carrying recovery risk.

## How Should Jenkins Core and Plugins Be Upgraded?
<!-- section-summary: Jenkins upgrades work best as a steady pipeline with staging, evidence, rollback notes, and regular security review. -->

Restricting Jenkins upgrades to emergencies makes them painful. A team that waits six months may face a large Jenkins LTS jump, many plugin updates, Java changes, deprecated APIs, and security fixes all at once. A steady cadence keeps each change small enough to inspect.

The platform team uses a monthly controller maintenance lane. During week one, a scheduled job checks available plugin updates and Jenkins LTS notes. During week two, the platform team updates `plugins.txt` in a branch, rebuilds the controller image, boots staging, and runs representative pipelines. During week three, service teams try critical deployment jobs on staging. During week four, production receives the tested image during a planned window.

The upgrade pull request carries a small evidence pack:

- The old and new Jenkins LTS version.
- The old and new `plugins.txt` diff.
- The plugin manager output or resolved plugin list.
- Security advisories reviewed and addressed.
- JCasC validation result.
- Staging boot result.
- Representative pipeline results for Maven, Node.js, Docker, Kubernetes deploys, and shared-library consumers.
- Rollback image tag and any state compatibility notes.

Rollback planning matters because Jenkins state can change during startup. A plugin can migrate job configuration or credential metadata. A controller rollback may need a restored backup of `$JENKINS_HOME` that matches the previous plugin set. The team should write the rollback note before production rollout, while everyone still has context.

Security updates deserve a shorter path. If a Jenkins security advisory affects an exposed controller or a plugin that handles credentials, the team can run an accelerated version of the same process. The process stays the same: update file, build image, boot staging, run smoke jobs, record rollback path, then roll production. The timeline changes, not the discipline.

Core and plugin upgrades must be treated as one system. Some plugin releases require a minimum Jenkins core; some core upgrades remove deprecated APIs that older plugins still use. A practical transition may update plugins to versions compatible with both the old and new core, upgrade the core, then apply plugin releases that require the new core. Release notes and plugin-manager output determine the exact order.

Upgrade notes are operational input, not marketing material. They reveal Java requirements, removed features, configuration migrations, security fixes, and plugin compatibility constraints. Record those findings beside the version diff so staging tests target the risky paths rather than proving only that the login page renders.

## How Do Rebuild and Boot Tests Reveal Controller Failures?
<!-- section-summary: The strongest configuration test starts with an empty controller state and reconstructs software and desired settings from versioned inputs. -->

The best reproducibility test does not upgrade a cherished staging controller in place. It starts with an empty `$JENKINS_HOME`, builds the selected Jenkins core and plugin set, injects test secret values, applies JCasC, and runs representative jobs. That proves the repository contains enough information to create a usable controller rather than merely modify one with a long hidden history.

A practical repository separates the layers:

```text
jenkins-controller/
  Dockerfile
  plugins.txt
  jenkins.yaml
  smoke/
    Jenkinsfile
  scripts/
    verify-controller.sh
```

The container image supplies core, Java, plugin binaries, and the JCasC file. Runtime infrastructure supplies durable storage and secret values. Smoke tests verify authentication, authorization, agent provisioning, tools, credentials references, and one safe Pipeline. The build output records resolved plugins and warnings.

This creates three maturity levels. Click-operated Jenkins depends on remembered manual state. Configuration as Code makes desired settings reviewable. A disposable-controller model goes further: the software process and image are replaceable, while only deliberate durable state is restored or migrated. The goal is not to erase build history casually; it is to make the controller software reproducible enough that replacement is routine.

<!-- section-summary: The boot sequence gives operators a layer-by-layer diagnostic path from JVM and core through plugins and JCasC to agents and pipelines. -->

At startup, the JVM applies memory and runtime flags. Jenkins core initializes and opens `$JENKINS_HOME`. The controller discovers plugin files, resolves and loads their classes, then JCasC reads YAML and asks available configurators to create settings. Secret placeholders resolve from permitted sources. Jenkins brings up web endpoints and agent integrations, and finally jobs can schedule against configured capacity.

Failures map to that order. If Jenkins does not start, inspect Java, core, arguments, storage, and logs. “Failed to load plugin” points to plugin dependencies, core requirements, or corrupt files. `ConfiguratorException` points to YAML shape, a missing configurator, or unresolved value. A controller that boots with a wrong setting points to source precedence or unsupported reload behavior. A Pipeline failure comes later and should be diagnosed as application orchestration or agent execution only after the platform layers are healthy.

The most important dependency chain is:

```text
Java and Jenkins core
  -> plugin code and compatible dependency set
  -> JCasC keys those plugins understand
  -> agents and global services created by that configuration
  -> Jenkinsfiles and shared libraries that call the available steps
```

Testing only the top Pipeline layer cannot prove the lower layers are reproducible. Booting from nothing and running a representative Pipeline validates the chain end to end.

## How Does Repeatable Jenkins Configuration Fit Together?
<!-- section-summary: Repeatable Jenkins operations come from treating plugins, controller config, staging, and upgrades as reviewed delivery artifacts. -->

The platform team now treats the Jenkins controller like a product. The controller image installs plugins from `plugins.txt`. JCasC applies the reviewed `jenkins.yaml`. The staging controller boots from the same build pattern as production. Reloads handle supported configuration changes, and restarts handle new plugin binaries, Jenkins core changes, and JVM settings.

The team also knows how to investigate plugin failures. A missing dependency points to the resolved plugin set. A runtime method error points to version compatibility. A JCasC failure points to plugin configuration shape. A production upgrade plan includes rollback notes and a backup strategy instead of a vague hope that the old container image will work with new state.

This gives the shared-library work from the previous article a stable home. Pipeline code can be clean, but the controller must also be reproducible. Pinned plugins and Configuration as Code turn Jenkins administration into something the same engineering review process can understand.

![Safe Jenkins upgrade loop showing review advisories, resolve dependencies, build staging image, smoke test, reload or restart, production rollout, and rollback version](/content-assets/articles/article-cicd-jenkins-plugins-and-configuration/safe-jenkins-upgrade-loop.png)

*A sustainable Jenkins upgrade loop keeps advisory review, dependency resolution, staging, smoke tests, rollout, and rollback in the same repeatable process.*

## Check Your Answers

:::expand[Why Does Manual Controller Configuration Become Risky?]{kind="recap"}
Runtime, persisted, and intended configuration can drift apart on a long-lived controller. Desired-state files make the intended plugin code and configuration data reviewable, testable, and reproducible. UI edits should be translated back into that source or treated as temporary drift.
:::

:::expand[How Does plugins.txt Define Controller Software?]{kind="recap"}
`plugins.txt` selects executable plugin versions for the controller image. The plugin manager resolves transitive requirements against Jenkins core and Java. Preserve the tested resolved set and warnings; neither a short floating dependency list nor a frozen incompatible tree guarantees reproduction.
:::

:::expand[How Does jenkins.yaml Define Controller Configuration?]{kind="recap"}
JCasC describes root Jenkins settings, tools, plugin configuration, authorization, and credential references. It is platform configuration, not application delivery logic. Store the shape in Git and resolve sensitive values from runtime or external secret sources.
:::

:::expand[Why Do Plugins and Configuration Form One Dependency Graph?]{kind="recap"}
JCasC keys exist only when compatible core and plugin configurators are loaded. Plugin dependencies, core requirements, configuration shape, secret resolution, agents, and Pipeline steps form one chain. Test plugin and YAML changes together instead of treating them independently.
:::

:::expand[When Is a Reload Enough and When Is a Restart Required?]{kind="recap"}
JCasC reload can apply supported data changes to the running process. Plugin binaries, core, Java, and JVM flags require restart. Reload-from-disk reads persisted controller files and is not JCasC reload. A successful restart is evidence that startup inputs are reproducible.
:::

:::expand[How Should Jenkins Core and Plugins Be Upgraded?]{kind="recap"}
Upgrade the tested system on a steady cadence: read notes, resolve compatible core and plugin versions, build an image, boot staging, run representative jobs, record evidence and rollback, then promote. Security urgency shortens the timeline, not the validation chain.
:::

:::expand[How Do Rebuild and Boot Tests Reveal Controller Failures?]{kind="recap"}
Start with empty controller state, build core and plugins from versioned inputs, inject test secrets, apply JCasC, and run smoke Pipelines. This exposes hidden ClickOps dependencies and moves the controller software toward a replaceable, disposable process around deliberate durable state.

Java and core start first, plugins load next, JCasC applies through their configurators, secrets resolve, agents appear, and Pipelines run last. Diagnose failures in that order: startup, plugin load, configuration, expected setting, agent, then application Pipeline.
:::

:::expand[How Does Repeatable Jenkins Configuration Fit Together?]{kind="recap"}
A versioned image contains core, Java, and a tested plugin graph. JCasC supplies desired settings, runtime systems supply secrets and durable storage, staging proves boot and representative jobs, and promotion or rollback uses identified artifacts rather than manual reconstruction.
:::

## References

- [Jenkins: Managing Plugins](https://www.jenkins.io/doc/book/managing/plugins/) - Documents plugin installation, updates, dependencies, and plugin manager behavior.
- [Plugin Installation Manager Tool for Jenkins](https://github.com/jenkinsci/plugin-installation-manager-tool) - Documents `jenkins-plugin-cli`, `--plugin-file`, dependency resolution, updates, and plugin input formats.
- [Jenkins: Configuration as Code](https://www.jenkins.io/doc/book/managing/casc/) - Explains JCasC YAML, SCM storage, reload behavior, file location, and plugin configuration.
- [Jenkins: Docker installation](https://www.jenkins.io/doc/book/installing/docker/) - Documents the official Jenkins Docker image, `/var/jenkins_home`, Java requirements, and Docker-based controller setup.
- [Jenkins Plugin Site](https://plugins.jenkins.io/) - Provides plugin versions, dependencies, health scores, maintainers, releases, and security warning history.
