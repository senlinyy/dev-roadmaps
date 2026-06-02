---
title: "What Is a Service Mesh"
description: "Understand the proxy data plane and control plane, and how the mesh intercepts traffic."
overview: "Before you can control traffic, you need to understand the mesh layer. This article uses Istio sidecar mode as a concrete example and shows how proxies attach to Pods and redirect application TCP traffic."
tags: ["kubernetes", "service-mesh", "istio", "sidecar"]
order: 1
id: article-containers-orchestration-kubernetes-service-mesh-what-is-a-service-mesh
---

## Table of Contents

- [The Problem With Direct Pod Communication](#the-problem-with-direct-pod-communication)
- [Installing the Control Plane](#installing-the-control-plane)
- [Deploying an Application Without a Mesh](#deploying-an-application-without-a-mesh)
- [Enabling Sidecar Injection](#enabling-sidecar-injection)
- [How the Mesh Intercepts Traffic](#how-the-mesh-intercepts-traffic)
- [Putting It All Together](#putting-it-all-together)
- [What's Next](#whats-next)

## The Problem With Direct Pod Communication

When you deploy microservices in a standard Kubernetes cluster, the application containers talk directly to each other over the virtual cluster network. If the frontend needs to call the backend API, the frontend process opens a socket, resolves the backend Service name to an IP address, and sends raw HTTP traffic straight to the backend Pod. This direct communication is efficient, but it leaves the application code responsible for handling all network reliability.

If the network drops packets, the application code has to retry. If you need to encrypt the traffic between nodes, the application code has to manage TLS certificates. If you want to route exactly 10% of traffic to a new version of the API, the application code or an external load balancer has to calculate those routing weights. A service mesh solves this by moving all of those network responsibilities out of the application code and into a dedicated infrastructure layer.

At its core, a service mesh is a fleet of small network proxies deployed close to your application containers. Instead of the frontend container talking directly to the backend container, the frontend talks through a local proxy. That proxy can encrypt traffic, apply retry and routing rules, and forward the request to the backend's local proxy. To make this concrete, we will use Istio, a widely used Kubernetes service mesh, and watch how its sidecar mode redirects application traffic inside a running Pod.

## Installing the Control Plane

A service mesh is split into two halves: the data plane and the control plane. The data plane is the fleet of proxies that actually move the packets. The control plane is the central brain that configures all of those proxies. To get started, you need to install the control plane.

With Istio, you install the control plane using the `istioctl` command-line tool. The `default` profile installs the core components needed to manage the mesh.

```bash
$ istioctl install --set profile=default -y

✔ Istio core installed
✔ Istiod installed
✔ Ingress gateways installed
✔ Installation complete
Making this installation the default for injection and validation.
```

When you run this command, `istioctl` translates the installation profile into standard Kubernetes manifests and applies them to your cluster. The output shows that three major components are now running. The core setup creates the necessary Custom Resource Definitions (CRDs) that Istio uses to store its configuration. The ingress gateway sets up a load balancer to handle traffic entering the cluster from the outside world.

The most important component, however, is `istiod`. This is the control plane daemon. We can verify it is running by checking the `istio-system` namespace.

```bash
$ kubectl get pods -n istio-system

NAME                                    READY   STATUS    RESTARTS   AGE
istio-ingressgateway-6d8b6c4b8d-2x4x6   1/1     Running   0          2m
istiod-7b494d9b4b-9z8z2                 1/1     Running   0          2m
```

The `istiod` Pod does not handle any of your application traffic. If the frontend calls the backend, those packets never touch `istiod`. Instead, `istiod` sits in the background and watches the Kubernetes API server for new Services, Endpoints, and routing rules. When you create a new rule, `istiod` translates that rule into low-level proxy configuration and pushes it out to the data plane proxies over a persistent gRPC connection.

## Deploying an Application Without a Mesh

To understand how the data plane actually attaches to your application, we first need to see what a normal, non-mesh Pod looks like. Let's deploy a standard Nginx web server into the default namespace.

```bash
$ kubectl run nginx --image=nginx
pod/nginx created

$ kubectl get pods

NAME    READY   STATUS    RESTARTS   AGE
nginx   1/1     Running   0          12s
```

When you inspect the `READY` column in the output, it shows `1/1`. This means the Pod contains exactly one container, and that one container is ready to accept traffic. In this state, any incoming network connections go straight to the Nginx process listening on port 80. The application is completely responsible for handling the raw TCP connection.

If you want this Pod to participate in the service mesh, you need to place a proxy in front of it. However, asking developers to manually edit their deployment YAML to include proxy containers would be slow and prone to errors. Instead, the mesh can inject the proxy automatically.

## Enabling Sidecar Injection

A service mesh proxy runs as a "sidecar" container. A sidecar is simply a second container that runs in the exact same Pod as your main application container. Because both containers share the same Pod, they also share the same network namespace, meaning they share the same IP address and the same local loopback interface (`localhost`).

To tell Istio to automatically inject this sidecar proxy into your Pods, you add a specific label to your Kubernetes namespace. The control plane watches for this label.

```bash
$ kubectl label namespace default istio-injection=enabled
namespace/default labeled
```

Labeling the namespace does not immediately change existing Pods. Kubernetes Pods are immutable; you cannot add a new container to a Pod that is already running. To get the proxy, we have to delete the old Pod and let Kubernetes recreate it. Since we created a bare Pod, we will just delete it and recreate it with the same run command, but we will watch the creation process.

```bash
$ kubectl delete pod nginx
pod "nginx" deleted

$ kubectl run nginx --image=nginx
pod/nginx created

$ kubectl get pods -w

NAME    READY   STATUS            RESTARTS   AGE
nginx   0/2     Pending           0          0s
nginx   0/2     Init:0/1          0          1s
nginx   0/2     PodInitializing   0          2s
nginx   1/2     Running           0          3s
nginx   2/2     Running           0          4s
```

The output now shows `2/2` in the `READY` column. The Pod has two containers because Istio changed the Pod spec at creation time. When the Kubernetes API server received your request to create the Pod, Istio's mutating admission webhook matched the `istio-injection=enabled` namespace label and added the sidecar proxy before the Pod was stored.

## How the Mesh Intercepts Traffic

The sidecar proxy is only useful if application traffic passes through it. If the Nginx container is still answering connections directly, the proxy cannot enforce retries, routing rules, or encryption. In Istio sidecar mode, the mesh redirects configured TCP traffic before it reaches the application.

We can see exactly how it does this by inspecting the detailed configuration of the newly injected Pod.

```bash
$ kubectl describe pod nginx

...
Init Containers:
  istio-init:
    Image:         docker.io/istio/proxyv2:1.20.0
    Command:
      istio-iptables
      -p
      15001
      -z
      15006
      -u
      1337
...
Containers:
  nginx:
    Image:         nginx
  istio-proxy:
    Image:         docker.io/istio/proxyv2:1.20.0
    Args:
      proxy
      sidecar
      --domain
      default.svc.cluster.local
...
```

The `describe` output reveals one common traffic-redirection path: an Init Container named `istio-init`. Init Containers are special containers that run to completion before the main application containers are allowed to start.

When the Pod boots up, the `istio-init` container runs a small binary called `istio-iptables`. Because this container shares the Pod's network namespace, it can rewrite the low-level Linux networking rules (`iptables`) for the Pod. In the default sidecar setup without Istio CNI, those rules redirect inbound TCP traffic to port `15006` and outbound TCP traffic leaving the application to port `15001`, except for ports and ranges that Istio deliberately excludes.

Once the `iptables` rules are written, the `istio-init` container exits, and the main containers start. The `istio-proxy` container, running Envoy under the hood, begins listening on those exact redirect ports.

When an external client tries to connect to Nginx on port 80, the Linux kernel intercepts the packet and silently hands it to the `istio-proxy` container instead. The proxy inspects the request, applies any necessary routing rules, and then opens a new local connection over `localhost` to the actual Nginx process. The application never knows it was intercepted. It just sees normal HTTP requests arriving from `localhost`.

Some clusters install Istio CNI so the node-level CNI plugin performs the traffic-redirection setup instead of an `istio-init` container. Istio also has ambient mode, which uses a different data-plane shape. The beginner habit is to ask which data-plane mode the cluster uses before assuming every Pod has an init container.

## Putting It All Together

A service mesh removes network complexity from your application code by inserting a dedicated proxy layer.

- **The Control Plane (`istiod`)**: A central daemon that watches the cluster and configures the proxies. It does not touch your application traffic.
- **The Data Plane (`istio-proxy`)**: A fleet of sidecar containers injected into your Pods. They handle the actual packet routing, encryption, and retries.
- **Traffic Redirection**: In default sidecar mode without Istio CNI, `istio-init` rewrites Linux `iptables` rules inside the Pod so configured TCP application traffic passes through the sidecar proxy.

## What's Next

Now that the data plane proxies are in place and application TCP traffic is passing through them, the proxies are ready to receive routing instructions. In the next article, we will use the control plane to write our first traffic routing rules, allowing us to split traffic between two different versions of an application without touching a single line of code.

![Service mesh summary showing application containers, local proxies, data plane traffic, control plane configuration, TCP redirection, and the Istio CNI option.](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-what-is-a-service-mesh/service-mesh-summary.png)

*Use this as the service mesh mental model: application containers keep their code simple while local proxies carry routing, encryption, and traffic policy from the control plane.*

---

**References**

- [Istio Architecture](https://istio.io/latest/docs/ops/deployment/architecture/) - Details the separation of the control plane and data plane.
- [Istio Traffic Management](https://istio.io/latest/docs/concepts/traffic-management/) - Explains how Envoy proxies intercept and route traffic inside the Pod.
- [Istio Sidecar Injection](https://istio.io/latest/docs/setup/additional-setup/sidecar-injection/) - Describes namespace-based automatic proxy injection.
- [Istio CNI](https://istio.io/latest/docs/setup/additional-setup/cni/) - Explains the alternative CNI-based traffic redirection path.
