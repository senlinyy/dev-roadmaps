---
title: "Hardening Container Images"
description: "Build minimal, shell-less, non-root container images to eliminate vulnerability surface."
overview: "A container image is a stacked filesystem. This article explains multi-stage compilation, distroless runtimes, non-root permissions, and read-only root structures."
tags: ["images", "distroless", "docker", "hardening"]
order: 1
id: article-devsecops-container-image-security-minimal-base-images
aliases:
  - minimal-base-images
  - article-devsecops-container-image-security-minimal-base-images
  - devsecops/container-image-security/minimal-base-images.md
---

## Table of Contents

1. [The Danger of Bloated Container Images](#the-danger-of-bloated-container-images)
2. [What Is a Container Filesystem?](#what-is-a-container-filesystem)
3. [Separating Development from Runtime: Multi-Stage Builds](#separating-development-from-runtime-multi-stage-builds)
4. [The Shell-less Paradigm: Distroless Runtimes](#the-shell-less-paradigm-distroless-runtimes)
5. [Low-Privilege Scoping: Running as Non-Root](#low-privilege-scoping-running-as-non-root)
6. [Enforcing Read-Only Root Filesystems](#enforcing-read-only-root-filesystems)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Danger of Bloated Container Images

When developers first containerize an application, they typically choose a comfortable, broad base image. A starting instruction like `FROM node:22` or `FROM python:3.12` creates a functional starting point. These standard base images are built on top of full Linux distributions, such as Debian or Ubuntu, and contain hundreds of utility packages, package managers, development headers, compiler tools, and active command shells. While these utilities make local development and initial deployments highly convenient, they introduce significant security vulnerabilities once the application is deployed to production.

Consider an application where a web API is packaged using a full Debian-based Node.js image. If an attacker discovers a path-traversal or remote code execution vulnerability inside the application's code, they can exploit the bug to force the application server to run shell commands. Because the container contains a standard Linux shell like `sh` or `bash`, the attacker can spawn an interactive shell session. Using the package manager `apt` and networking tools like `curl` or `wget` already installed inside the container, the attacker can download malicious binary tools, scan the private internal network, and establish a persistent connection back to an external command-and-control server.

If the container image had been hardened to omit these unnecessary OS tools, the attacker's exploit chain would have failed at the very first step. Without an active shell or networking utilities, the path-traversal vulnerability could not be used to execute system commands or download external malware. By treating the container image as a highly restricted runtime environment rather than a full, general-purpose operating system, we eliminate the tools that attackers rely on to explore and compromise our systems.

## What Is a Container Filesystem?

To design secure container images, we must understand how container filesystems are constructed. A container image is not a single, solid virtual disk. Instead, it is an immutable stack of read-only archive layers. When a container engine (like Docker or containerd) runs an image, it utilizes a union file system (such as OverlayFS) to overlay these layers on top of one another, presenting them to the application as a single, cohesive directory tree.

Each layer in the stack represents the cryptographic differences (the diff) introduced by a single instruction inside the Dockerfile. For example, if a Dockerfile installs an OS package in one instruction and copies application code in the next, the container engine compiles these changes into two separate layers. When a file is modified or deleted in a later layer, the union filesystem hides the file from the active application view, but the file is not actually deleted from the underlying layers. It remains perfectly preserved in the historical read-only layers, bloating the final image size and continuing to trigger vulnerability alerts during security scans.

This layered architecture is why image cleanup instructions must be executed in the exact same Dockerfile step that introduces the files. If you download a 100 MB tarball, extract its contents, compile a binary, and delete the original tarball in separate Dockerfile instructions, that 100 MB archive remains permanently recorded inside the historical layers of your production image. To prevent this bloat and eliminate historical vulnerabilities, we must design our build instructions to clean up temporary build dependencies immediately within the same execution layer, or adopt a multi-stage compilation pattern.

## Separating Development from Runtime: Multi-Stage Builds

The software compile cycle requires highly powerful tools. To resolve package dependencies, run linters, compile assets, and build application binaries, we need compilers (`gcc`, `g++`), development headers, package managers (`npm`, `pip`), and test suites. However, once the application is compiled into executable files, none of these build utilities are needed to run the service in production. Shipping build tools in a production container violates the principle of least privilege, leaving powerful compilers fully accessible to any attacker who exploits the runtime.

Multi-stage builds solve this problem by separating the build workspace from the final production runtime filesystem. Inside a single Dockerfile, we define multiple, independent stages, each starting with its own `FROM` instruction. The first stage, which we label the "build" stage, uses a fully featured base image containing all necessary compilers, package managers, and development utilities to compile the application. The second stage, labeled the "runtime" stage, starts fresh from a minimal, highly restricted base image containing only the bare runtime interpreter:

```Dockerfile
# Stage 1: Build environment
FROM node:22-alpine AS build
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

# Stage 2: Runtime environment
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /src/node_modules ./node_modules
COPY --from=build --chown=node:node /src/dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

In this multi-stage configuration, the `build` stage performs the heavy lifting: downloading development dependencies, compiling TypeScript files into a `dist/` directory, and pruning development-only packages. 

The `runtime` stage starts fresh from a clean `node:22-alpine` image. We use the `COPY --from=build` instruction to copy only the finished, compiled JavaScript files and the production-specific `node_modules` folder out of the compiler workspace directly into our clean runtime stage. The compiler utilities, package managers, raw TypeScript source files, and development cache directories are completely left behind in the build stage. The final production image contains only the absolute minimum set of compiled files required to run the service, reducing the image size from over 1 GB to a fraction of that footprint.

## The Shell-less Paradigm: Distroless Runtimes

While using minimal base images like Alpine Linux significantly reduces the size of our containers, they still contain a complete operating system shell (`sh` or `ash`) and a package manager (`apk`). If an attacker gains command execution inside an Alpine-based container, they can still run system scripts, download external packages, and navigate the filesystem.

To eliminate this remaining attack surface, we adopt the shell-less or **Distroless** paradigm. Originally designed by Google, distroless images contain nothing but the specific application runtime (such as Node.js, Python, or a Java Virtual Machine) and its immediate, low-level system library dependencies (like `glibc` and SSL certificates). A distroless image contains no shell (`sh`, `bash`, `ash`), no package manager (`apt`, `apk`), and no standard operating system utilities (`ls`, `cat`, `curl`, `mkdir`).

Without a shell or a package manager, the container is completely inert to interactive commands. If an attacker attempts to exploit a vulnerability to execute a system command, the kernel rejects the execution instantly because there is no shell interpreter in the container's `$PATH` to parse or run the command. Similarly, engineers cannot run `docker exec -it <container> sh` to open an interactive session.

This shell-less design introduces a major operational tradeoff: debugging a running container becomes more complex. When an incident occurs, engineers cannot log directly into the container to inspect local files or run diagnostic commands. To balance this tradeoff, teams must implement robust service telemetry, structured logs with correlation IDs, and external health probes. When interactive debugging is mandatory, engineers must utilize Kubernetes ephemeral debug containers or sidecars, which attach a highly privileged diagnostic shell container to the same network and process namespace as the hardened container without modifying the application's secure production filesystem.

## Low-Privilege Scoping: Running as Non-Root

By default, unless specified otherwise inside the Dockerfile, container processes execute under the root user account (UID 0). Running a container process as root inside a container does not automatically grant root access to the physical host server. However, if an attacker exploits a container breakout vulnerability, they can escape the container's namespace. Because the process is running as root (UID 0), the escaped process immediately inherits administrative root capabilities on the physical host, compromising the entire cluster.

To enforce least privilege, we must explicitly declare a low-privilege, non-root user account inside our Dockerfile. Most official base images provide a pre-configured, low-privilege user account (such as the `node` user in Node.js images or the `nobody` user in general-purpose alpine images). In custom enterprise builds, we create a dedicated user with an explicit, high UID:

```Dockerfile
# Create a dedicated system user and group with an explicit UID/GID
RUN groupadd -g 10001 appgroup && \
    useradd -r -u 10001 -g appgroup appuser

# Set the active execution user
USER 10001
```

Declaring `USER 10001` or `USER node` instructs the container runtime to execute the application process with reduced kernel capabilities. If an attacker compromises the process, their execution privileges are strictly limited to that non-root UID, blocking them from escaping namespaces or modifying host files.

When running containers as non-root, developers must accommodate two system limitations:
* **Privileged Port Restrictions**: The Linux kernel blocks non-root users from binding to privileged network ports below 1024. Hardened containers must be configured to bind to high-numbered ports (such as port 8080 or 3000), utilizing ingress controllers or external load balancers to route traffic to the container.
* **Workspace Permissions**: If the application needs to read files copied from a build stage, the files must be owned by the non-root user. We use `COPY --chown=node:node` or `COPY --chown=10001:10001` to ensure the low-privilege process has direct filesystem access without requiring broad write permissions.

## Enforcing Read-Only Root Filesystems

Even when an image is built using a minimal, non-root distroless base, the container's filesystem remains writable by default. If an attacker exploits a vulnerability, they can still write temporary files to the workspace, modify static HTML assets, or inject malicious scripts into application folders. To block these dynamic filesystem modifications, we enforce a **Read-Only Root Filesystem**.

Enforcing a read-only root filesystem instructs the container runtime to mount all container image layers as strictly read-only during execution. If a process attempts to create a file or modify an existing script, the kernel blocks the operation immediately, throwing a read-only filesystem error:

```bash
$ touch /app/test.js
touch: cannot touch '/app/test.js': Read-only file system
```

Because modern applications frequently need to write temporary state—such as local cache files, application logs, or runtime sockets—a completely read-only filesystem will break standard runtimes. To resolve this, we adopt a hybrid design pattern. We configure the container runtime to mount dedicated, in-memory filesystems called **tmpfs mounts** to specific, low-privilege temporary directories, keeping the rest of the container completely locked down:

```yaml
# Example Kubernetes Pod Spec snippet
spec:
  containers:
  - name: orders-api
    image: ghcr.io/devpolaris/orders-api:latest
    securityContext:
      readOnlyRootFilesystem: true
    volumeMounts:
    - mountPath: /tmp
      name: temp-storage
  volumes:
  - name: temp-storage
    emptyDir:
      medium: Memory
```

In this configuration, the `/tmp` directory is backed by the host's physical RAM, allowing the application to write transient files without writing to the underlying container image. Because the `emptyDir` volume is ephemeral, all temporary files are completely destroyed the moment the container restarts, preventing attackers from establishing persistent malware locations.

## Putting It All Together

Hardening our container images is the primary boundary of container security. By separating compile-time dependencies using multi-stage builds, adopting the shell-less distroless paradigm, executing processes under low-privilege UIDs, and locking down filesystems with read-only root controls, we eliminate the tools and write privileges that attackers exploit.

When designing and auditing your container build pipelines, ensure you maintain these five core practices:

First, implement multi-stage builds as your standard Dockerfile pattern. Compile your application in a dedicated builder stage, and copy only the compiled binaries and production dependencies into the final runtime stage, leaving all compilers and package managers behind.

Second, adopt distroless base runtimes for all production builds. Eliminate standard operating system shells, package managers, and system utilities from your final images, neutralizing command execution attacks at the kernel level.

Third, execute container processes under low-privilege, non-root user accounts. Declare an explicit, high-number UID inside your Dockerfile, and configure your application to bind to network ports above 1024, ensuring a container breakout cannot inherit host administrative access.

Fourth, enforce read-only root filesystems across all deployments. Mount your container layers as read-only at runtime, utilizing ephemeral, in-memory tmpfs emptyDir volumes exclusively for specific, restricted write paths like `/tmp`.

Fifth, pin upstream base images by cryptographic content digests rather than mutable tags. Pinning to a specific SHA-256 digest ensures that your builds remain consistent and immune to silent, upstream base modifications.

## What's Next

Building minimal, shell-less, and non-root container images isolates the filesystem from immediate command execution. However, we must still prove exactly what packages reside inside those layers, scan them for known vulnerabilities, and cryptographically sign the resulting digest. In the next chapter, **Image Trust and SBOMs**, we will cover Software Composition Analysis (SCA) for containers, Software Bills of Materials (SBOMs), and keyless container signing with Cosign.

---

**References**

- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/) - Official documentation on multi-stage Dockerfiles and layer copying.
- [Google Container Tools - Distroless](https://github.com/GoogleContainerTools/distroless) - Google's open-source catalog of minimal, shell-less container base runtimes.
- [OWASP Container Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html) - OWASP technical guidelines on non-root user configuration, read-only root filesystems, and image sandboxing.
- [Kubernetes Security Context Configuration](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Official guide on enforcing readOnlyRootFilesystem and low-privilege running options at runtime.
- [NIST SP 800-190 Application Container Security Guide](https://csrc.nist.gov/pubs/sp/800/190/final) - NIST recommendations on image hardening, minimal runtimes, and vulnerability surface reduction.
