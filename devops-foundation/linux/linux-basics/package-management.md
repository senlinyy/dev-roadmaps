---
title: "Package Management"
description: "Install, update, and manage software packages using apt, yum, and other Linux package managers."
overview: "Use Linux package managers to install, update, pin, audit, and remove the software that keeps a small API VM running safely."
tags: ["apt", "yum", "dnf"]
order: 6
id: article-devops-foundation-linux-linux-basics-package-management
---

## Table of Contents

1. [Why Package Management Matters](#why-package-management-matters)
2. [What a Package Manager Does](#what-a-package-manager-does)
3. [APT on Debian and Ubuntu](#apt-on-debian-and-ubuntu)
4. [DNF on Fedora, RHEL, and Rocky](#dnf-on-fedora-rhel-and-rocky)
5. [Repositories and Trust](#repositories-and-trust)
6. [Third-Party Software and Version Pinning](#third-party-software-and-version-pinning)
7. [Security Updates and Maintenance Windows](#security-updates-and-maintenance-windows)
8. [Remove, Roll Back, and Audit Packages](#remove-roll-back-and-audit-packages)
9. [References](#references)

## Why Package Management Matters
<!-- section-summary: Package management controls how server software is installed, updated, verified, and removed. -->

The `inventory-api` VM depends on packages. Nginx terminates HTTP traffic. systemd manages services. OpenSSL handles TLS libraries. `curl` powers health checks. The API runtime may be Node.js, Python, Go, or another stack. Each piece needs installation, updates, and security fixes.

A **package manager** is the tool that handles software as managed units rather than random files copied across the server. It knows which package owns `/usr/sbin/nginx`, which dependencies Nginx needs, which repository supplied it, and which updates are available.

This matters in production because unmanaged software creates mystery. When a binary was built by hand and copied into `/usr/local/bin`, the next engineer may not know its version, source, patch status, or removal procedure. Packages give the server an inventory and a repeatable way to change that inventory.

## What a Package Manager Does
<!-- section-summary: Package managers install files, resolve dependencies, verify repository metadata, track ownership, and support updates. -->

A package is an archive plus metadata. The archive contains files, and the metadata describes the package name, version, dependencies, scripts, checksums, and repository source. The package manager uses that metadata to install software safely and keep a local database of what changed.

On Debian and Ubuntu systems, the package format is `.deb`, and the main tool family is APT. On Fedora, RHEL, CentOS Stream, Rocky Linux, and AlmaLinux, the package format is `.rpm`, and the modern tool is DNF. Older systems may use `yum`, which DNF replaced in many distributions.

The package manager does several jobs:

| Job | Example |
|---|---|
| Install software | Add Nginx and its dependencies |
| Upgrade software | Apply OpenSSL security updates |
| Remove software | Uninstall a runtime the API no longer uses |
| Query ownership | Identify which package installed `/usr/bin/curl` |
| Verify integrity | Compare installed files with package metadata |
| Manage repositories | Enable official or trusted third-party sources |

The practical rule for the API VM is to prefer OS packages for system software. Nginx, logrotate, systemd tooling, CA certificates, and security libraries should come from trusted repositories whenever possible. Application dependencies can still come from language tools like `npm`, `pip`, or `cargo`, but the base server should stay visible to the OS package manager.

## APT on Debian and Ubuntu
<!-- section-summary: APT installs and updates `.deb` packages from configured repositories on Debian-style systems. -->

APT uses repository metadata to know what packages exist and which versions are available. The first command in a maintenance session is usually `apt update`, which refreshes the local package index:

```bash
$ sudo apt update
```

Installing Nginx and common operating tools looks like this:

```bash
$ sudo apt install nginx curl ca-certificates logrotate
```

Upgrading installed packages uses:

```bash
$ sudo apt upgrade
```

`apt list --upgradable` previews pending upgrades:

```bash
$ apt list --upgradable
```

For an API VM, previewing matters. An update to Nginx, OpenSSL, or the language runtime may be routine, but it still deserves a maintenance window when the service is important. The operator should know what will change before pressing yes.

APT can answer ownership questions:

```bash
$ dpkg -S /usr/sbin/nginx
nginx-core: /usr/sbin/nginx

$ apt show nginx
```

APT also keeps history. On Ubuntu and Debian systems, these files are useful after a surprising change:

```bash
$ sudo less /var/log/apt/history.log
$ sudo less /var/log/apt/term.log
```

If a package introduced a problem, the history log shows when it changed and which version was involved. That context helps decide whether to roll back, pin a version, or fix a config change.

## DNF on Fedora, RHEL, and Rocky
<!-- section-summary: DNF installs and updates `.rpm` packages on Red Hat style systems and keeps transaction history. -->

DNF serves the same broad purpose in Red Hat style distributions. It refreshes repository metadata automatically when needed, but explicit checks are common during maintenance:

```bash
$ sudo dnf check-update
```

Installing Nginx and useful tools:

```bash
$ sudo dnf install nginx curl ca-certificates logrotate
```

Updating packages:

```bash
$ sudo dnf upgrade
```

Querying package ownership:

```bash
$ rpm -qf /usr/sbin/nginx
nginx-1.24.0-4.el9.x86_64

$ dnf info nginx
```

DNF records transactions, which is valuable after a maintenance window:

```bash
$ sudo dnf history
$ sudo dnf history info 42
```

Some DNF systems support undoing a transaction:

```bash
$ sudo dnf history undo 42
```

Treat undo as one recovery tool among several. A package rollback may leave data migrations, config file edits, or application-level changes in place. For the `inventory-api` VM, package rollback should sit beside service health checks, config backups, and release rollback.

## Repositories and Trust
<!-- section-summary: Repositories are signed software sources, so adding one extends who can install code on the server. -->

A **repository** is a software source that publishes packages and metadata. Package managers verify repository metadata and package signatures so the server can detect tampering. Official distribution repositories are the safest default because the distribution maintainers build, sign, test, and patch those packages for that OS release.

On Ubuntu and Debian, repository configuration lives under `/etc/apt/sources.list` and `/etc/apt/sources.list.d/`. On DNF systems, repository files live under `/etc/yum.repos.d/`.

For a production VM, adding a repository is a security decision. A repository can provide packages that run as root during installation and upgrades. The team should know who publishes it, why the package is needed, how keys are managed, and how updates will be tested.

The trust chain is visible in commands:

```bash
$ apt-cache policy nginx
$ dnf repolist
```

`apt-cache policy` shows which repository would supply a package and which version has priority. `dnf repolist` shows enabled repositories. These commands help detect a server pulling Nginx or a runtime from an unexpected source.

## Third-Party Software and Version Pinning
<!-- section-summary: Third-party repositories and pins can solve version needs, but they require explicit ownership and review. -->

Sometimes official repositories lack the version you need. The API may require a newer Node.js runtime than the OS release ships, or Nginx may need a module available from the vendor repository. Third-party repositories can solve that version gap while expanding the server's trust boundary.

A practical decision flow helps:

| Need | Better first option |
|---|---|
| Nginx stable web server | Distribution package |
| Security library | Distribution package |
| Newer language runtime | Vendor repository or runtime manager with documented owner |
| Application dependencies | Project lockfile and language package manager |
| One custom internal tool | Internal package repository or `/usr/local` with clear versioning |

Pinning holds a package at a chosen version or priority. On APT, a pin file can live under `/etc/apt/preferences.d/`:

```apt
Package: nginx
Pin: version 1.24.*
Pin-Priority: 1001
```

On DNF, a version lock plugin is commonly used:

```bash
$ sudo dnf install python3-dnf-plugin-versionlock
$ sudo dnf versionlock add nginx
```

Pins reduce surprise during maintenance, but they can also block security updates. A pinned package needs an owner and review date. If the team pins Nginx to avoid a breaking change, they should schedule the test work needed to remove that pin later.

## Security Updates and Maintenance Windows
<!-- section-summary: Production updates need preview, backup, health checks, and a rollback path rather than blind upgrades. -->

Security updates keep the VM healthy. Libraries such as OpenSSL, glibc, and zlib sit below many programs. Nginx and the API runtime receive fixes over time. Ignoring updates leaves known vulnerabilities on a public server.

The production question is how to update without surprising users. A small VM can use a simple maintenance checklist:

1. Capture current state with package history and service status.
2. Preview updates with `apt list --upgradable` or `dnf check-update`.
3. Back up important config such as `/etc/nginx` and systemd unit files.
4. Apply updates in a planned window.
5. Restart services when libraries or runtimes require it.
6. Run local and public health checks.
7. Watch Nginx and API logs after the change.

The commands may look like:

```bash
$ systemctl status nginx inventory-api
$ apt list --upgradable
$ sudo tar -czf /root/etc-nginx-backup-$(date +%Y%m%d-%H%M%S).tar.gz /etc/nginx
$ sudo apt upgrade
$ sudo systemctl restart inventory-api
$ sudo nginx -t
$ sudo systemctl reload nginx
$ curl --fail --silent --show-error http://127.0.0.1:3000/health
$ curl --fail --silent --show-error https://api.example.com/health
```

Some teams enable unattended security updates for low-risk packages and keep manual windows for larger changes. That can work well, but it still needs monitoring. Automatic updates that restart a critical service should be visible in logs and alerts.

## Remove, Roll Back, and Audit Packages
<!-- section-summary: Package management also includes removing unused software, verifying ownership, and investigating change history. -->

Removing unused packages reduces attack surface and operational noise. If the API moved from Python to Node.js, an old runtime may stay on the server forever unless someone removes it.

APT removal:

```bash
$ sudo apt remove unused-package
$ sudo apt autoremove
```

DNF removal:

```bash
$ sudo dnf remove unused-package
$ sudo dnf autoremove
```

Before removal, query reverse dependencies and ownership. Removing a package that another service still uses can create an avoidable outage.

Auditing answers what changed and who owns a file:

```bash
$ dpkg -l | grep nginx
$ dpkg -S /usr/sbin/nginx
$ rpm -qa | grep nginx
$ rpm -qf /usr/sbin/nginx
```

Config files deserve special attention. Package managers may keep local modifications, create `.dpkg-old` or `.dpkg-dist` files, or show prompts during upgrades. After an Nginx package update, compare active config and test it:

```bash
$ sudo nginx -t
$ sudo systemctl reload nginx
```

Package management is part of operating the API. Every installed package is part of the server's supply chain, patch story, and rollback story.

## References

- [Debian APT user manual](https://www.debian.org/doc/manuals/apt-guide/) - Official Debian guide to APT usage.
- [Ubuntu package management documentation](https://documentation.ubuntu.com/server/how-to/software/package-management/) - Ubuntu server package management guidance.
- [DNF command reference](https://dnf.readthedocs.io/en/latest/command_ref.html) - Official DNF command documentation.
- [RPM manual](https://rpm.org/docs/4.19.x/man/rpm.8.html) - Official RPM command documentation.
- [Nginx Linux packages](https://nginx.org/en/linux_packages.html) - Official Nginx package repository guidance.
- [Debian unattended-upgrades package](https://wiki.debian.org/UnattendedUpgrades) - Debian documentation for automatic security updates.
