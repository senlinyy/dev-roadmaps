---
title: "EKS"
description: "Understand when Amazon EKS is the right compute shape for containers that need Kubernetes as their operating layer."
overview: "EKS is AWS-managed Kubernetes. This article follows a commerce platform through clusters, control planes, worker capacity, pods, services, VPC networking, Pod Identity, operations, and the ECS-vs-EKS decision."
tags: ["eks", "kubernetes", "containers", "pods", "aws"]
order: 5
id: article-cloud-providers-aws-compute-application-hosting-eks
aliases:
  - amazon-eks
  - elastic-kubernetes-service
  - kubernetes-on-aws
  - eks
  - cloud-providers/aws/compute-application-hosting/eks.md
---

## Table of Contents

1. [When Containers Need a Platform](#when-containers-need-a-platform)
2. [Clusters, Control Planes, and Workers](#clusters-control-planes-and-workers)
3. [Deployments, Services, and Ingress](#deployments-services-and-ingress)
4. [Networking and Pod AWS Permissions](#networking-and-pod-aws-permissions)
5. [Operating an EKS Cluster](#operating-an-eks-cluster)
6. [Choosing EKS or ECS](#choosing-eks-or-ecs)
7. [An EKS Debugging Path](#an-eks-debugging-path)
8. [References](#references)

## When Containers Need a Platform
<!-- section-summary: EKS fits teams that want Kubernetes APIs and ecosystem tools as the shared application platform. -->

A company has twenty containerized services, shared deployment standards, GitOps, admission policies, certificate automation, and teams that already know Kubernetes. Each service could run on ECS with Fargate. The organization wants Kubernetes APIs as the common platform contract.

**Amazon EKS** is AWS-managed Kubernetes. AWS operates the Kubernetes control plane, and your workloads run on worker capacity that you choose: managed node groups, self-managed EC2 nodes, or Fargate profiles for selected pod patterns. EKS gives teams the Kubernetes API on AWS, plus integrations with VPC networking, IAM, load balancers, CloudWatch, and other AWS services.

For this article, follow `orders-api` inside a commerce platform. The app is one container, and the company deploys all services through Kubernetes Deployments, Services, Ingress, Helm charts, and GitOps pull requests. EKS fits because the platform contract matters across many teams.

EKS has two worlds that meet every day:

| World | What it controls |
|---|---|
| **AWS** | Cluster control plane, VPC, subnets, node groups, IAM roles, load balancers, target groups, CloudWatch, and security groups. |
| **Kubernetes** | Pods, Deployments, Services, Ingress, ConfigMaps, Secrets, service accounts, resource requests, probes, jobs, and policies. |

That split is the central operating reality. During an incident, Kubernetes may explain why a pod did not start, while AWS may explain why the load balancer cannot reach it. The rest of the article keeps those two layers connected.

## Clusters, Control Planes, and Workers
<!-- section-summary: EKS separates the managed Kubernetes API from the worker capacity that runs application pods. -->

An EKS **cluster** includes a managed Kubernetes control plane. The control plane exposes the Kubernetes API, stores cluster state, and coordinates scheduling decisions. Deployment tools such as `kubectl`, Helm, Argo CD, Flux, and CI/CD systems talk to that API.

Applications run on worker capacity. A **managed node group** is a group of EC2 instances that AWS helps manage as Kubernetes nodes. A **Fargate profile** lets selected pods run on Fargate capacity. Many production clusters use managed node groups for general services and reserve Fargate profiles for specific workload patterns.

Inspect the cluster:

```bash
aws eks describe-cluster \
  --name commerce-prod \
  --region eu-west-2 \
  --query 'cluster.{Status:status,Version:version,Endpoint:endpoint,Subnets:resourcesVpcConfig.subnetIds,SecurityGroups:resourcesVpcConfig.securityGroupIds}'
```

Example output:

```json
{
  "Status": "ACTIVE",
  "Version": "1.30",
  "Endpoint": "https://A1B2C3D4E5F6.gr7.eu-west-2.eks.amazonaws.com",
  "Subnets": ["subnet-0a111111111111111", "subnet-0b222222222222222"],
  "SecurityGroups": ["sg-0ekscluster"]
}
```

`Status: ACTIVE` means the cluster API is available. `Version` is the Kubernetes version. `Endpoint` is the Kubernetes API endpoint used by clients. `Subnets` and `SecurityGroups` show the VPC placement and cluster network boundary.

Inspect a managed node group:

```bash
aws eks describe-nodegroup \
  --cluster-name commerce-prod \
  --nodegroup-name general-workers \
  --region eu-west-2 \
  --query 'nodegroup.{Status:status,InstanceTypes:instanceTypes,Subnets:subnets,Scaling:scalingConfig,Version:version}'
```

Example output:

```json
{
  "Status": "ACTIVE",
  "InstanceTypes": ["m7i.large"],
  "Subnets": ["subnet-0a111111111111111", "subnet-0b222222222222222"],
  "Scaling": {
    "minSize": 3,
    "maxSize": 10,
    "desiredSize": 4
  },
  "Version": "1.30"
}
```

`InstanceTypes` tells you the EC2 shape of worker nodes. `Scaling` tells you the node group size range and current desired size. `Subnets` tells you where the nodes can launch. If pods are pending because the cluster lacks CPU, memory, or IP addresses, this output helps connect Kubernetes scheduling symptoms to AWS capacity.

Then look from the Kubernetes side:

```bash
kubectl get nodes -o wide
```

Example output:

```bash
NAME                                           STATUS   ROLES    AGE   VERSION               INTERNAL-IP   OS-IMAGE
ip-10-20-11-24.eu-west-2.compute.internal     Ready    <none>   12d   v1.30.2-eks-1234567   10.20.11.24   Amazon Linux 2023
ip-10-20-42-19.eu-west-2.compute.internal     Ready    <none>   12d   v1.30.2-eks-1234567   10.20.42.19   Amazon Linux 2023
```

`STATUS: Ready` means Kubernetes can schedule pods on the node. `VERSION` shows the kubelet version on the worker. `INTERNAL-IP` is the node address inside the VPC. If a node is `NotReady`, describe it and check node pressure, kubelet health, CNI state, and the AWS-side node group.

The cluster and workers give the platform a place to run pods. The next step is the application manifest that describes those pods and how traffic reaches them.

![The cluster shape shows the managed control plane, worker nodes, pods, services, ingress, and health checks in one picture](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-eks/eks-cluster-shape.png)

*The cluster shape shows the managed control plane, worker nodes, pods, services, ingress, and health checks in one picture.*


## Deployments, Services, and Ingress
<!-- section-summary: Kubernetes objects describe how containers run, how they receive internal traffic, and how an AWS load balancer reaches them. -->

A **Pod** is the smallest Kubernetes workload unit. A **Deployment** keeps a desired number of pod replicas running and rolls out new versions. A **Service** gives a stable internal address for matching pods. An **Ingress** connects external HTTP routing to a Service, usually through a controller such as the AWS Load Balancer Controller on EKS.

Here is a production-shaped Deployment for `orders-api`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: orders
  labels:
    app: orders-api
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: orders-api
  template:
    metadata:
      labels:
        app: orders-api
    spec:
      serviceAccountName: orders-api
      containers:
        - name: api
          image: 123456789012.dkr.ecr.eu-west-2.amazonaws.com/orders-api:2026-06-24
          ports:
            - name: http
              containerPort: 3000
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 30
            failureThreshold: 3
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              memory: "1024Mi"
```

The key fields work together:

| Field | Meaning |
|---|---|
| `metadata.name` | Names the Deployment object. |
| `metadata.namespace` | Places the object in the `orders` namespace. |
| `replicas` | Asks Kubernetes to keep three pods running. |
| `strategy.rollingUpdate` | Allows one extra pod during rollout and keeps all existing capacity available. |
| `selector.matchLabels` | Tells the Deployment which pods it owns. |
| `template.metadata.labels` | Labels the pods so Deployments and Services can find them. |
| `serviceAccountName` | Gives the pod a Kubernetes service account, which can connect to AWS permissions through Pod Identity. |
| `containers.image` | Points at the container image release. |
| `ports.name` | Gives the container port a readable name so probes and Services can refer to `http`. |
| `readinessProbe` | Controls whether the pod should receive traffic. |
| `livenessProbe` | Controls whether Kubernetes should restart a stuck container. |
| `resources.requests` | Reserves CPU and memory for scheduling decisions. |
| `resources.limits` | Caps memory use so one container cannot grow without bound. |

Now give the pods a stable internal address:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api
  namespace: orders
spec:
  type: ClusterIP
  selector:
    app: orders-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

`type: ClusterIP` creates an internal Service address. `selector.app: orders-api` finds pods with the matching label. `port: 80` is the Service port inside the cluster. `targetPort: http` sends traffic to the named container port, which is port `3000` in the Deployment. A label mismatch between the Service and pods creates a Service with no endpoints, which is a very common cause of failed traffic.

External HTTP routing usually uses an Ingress managed by a controller:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: orders-api
  namespace: orders
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/healthcheck-path: /ready
spec:
  ingressClassName: alb
  rules:
    - host: orders.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: orders-api
                port:
                  number: 80
```

`ingressClassName: alb` asks the AWS Load Balancer Controller to handle this Ingress. `scheme: internet-facing` creates a public ALB. `target-type: ip` sends traffic directly to pod IPs. `healthcheck-path: /ready` tells the ALB which path to check. The rule maps `orders.example.com` to the `orders-api` Service on port `80`.

Check the objects after applying them:

```bash
kubectl -n orders get deployment orders-api
kubectl -n orders get service orders-api
kubectl -n orders get endpoints orders-api
kubectl -n orders describe ingress orders-api
```

Example endpoints output:

```bash
NAME         ENDPOINTS                                      AGE
orders-api   10.20.31.45:3000,10.20.42.18:3000,10.20.12.9:3000   4m
```

The endpoint list should show ready pod IPs and ports. If it shows `<none>`, the Service selector may be wrong, the pods may be unready, or the Deployment may have failed to create pods.

Those manifests run the app. The next layer is how pods connect to the VPC and call AWS APIs.

## Networking and Pod AWS Permissions
<!-- section-summary: EKS pod networking connects workloads to the VPC, while Pod Identity gives pods scoped AWS permissions without static keys. -->

EKS commonly uses the Amazon VPC CNI plugin. The plugin assigns VPC IP addresses to pods running on EC2 nodes. That makes pod traffic visible in the VPC, and it also means subnet IP capacity matters. A cluster can run out of pod IP addresses before it runs out of CPU.

Security group design depends on the cluster pattern. Some workloads use node security groups. Some clusters use security groups for pods where the environment supports it. In either pattern, the database should accept traffic only from the expected workload path, and the pod should still need IAM permission for AWS API calls.

Pods need AWS permissions for actions such as reading Secrets Manager, writing to S3, or publishing events. **EKS Pod Identity** associates a Kubernetes service account with an IAM role. The application uses the normal AWS SDK credential chain, and the pod receives scoped temporary credentials for that role.

Create an association for the `orders-api` service account:

```bash
aws eks create-pod-identity-association \
  --cluster-name commerce-prod \
  --namespace orders \
  --service-account orders-api \
  --role-arn arn:aws:iam::123456789012:role/prod-orders-api-pod-role \
  --region eu-west-2
```

Example output:

```json
{
  "association": {
    "clusterName": "commerce-prod",
    "namespace": "orders",
    "serviceAccount": "orders-api",
    "roleArn": "arn:aws:iam::123456789012:role/prod-orders-api-pod-role",
    "associationId": "a-0abc123def4567890"
  }
}
```

`clusterName`, `namespace`, and `serviceAccount` identify the Kubernetes workload identity. `roleArn` is the IAM role the pod can use. `associationId` is the EKS identifier for this binding. The Deployment uses `serviceAccountName: orders-api`, so new pods in the `orders` namespace can receive this role.

List associations during debugging:

```bash
aws eks list-pod-identity-associations \
  --cluster-name commerce-prod \
  --region eu-west-2
```

Example output:

```json
{
  "associations": [
    {
      "clusterName": "commerce-prod",
      "namespace": "orders",
      "serviceAccount": "orders-api",
      "associationArn": "arn:aws:eks:eu-west-2:123456789012:podidentityassociation/commerce-prod/a-0abc123def4567890",
      "associationId": "a-0abc123def4567890",
      "roleArn": "arn:aws:iam::123456789012:role/prod-orders-api-pod-role"
    }
  ]
}
```

If the app receives `AccessDenied`, compare four facts: the pod namespace, the pod service account, the Pod Identity association, and the IAM role policy. If the app cannot reach the database, compare pod IPs, node or pod security groups, NetworkPolicy if used, DNS, routes, and database security group rules.

Now the platform can run the app and give it AWS permissions. The long-term work is operating the cluster safely.

![The pod path separates network reachability from cloud permission delivery so pod IPs and role credentials do not blur together](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-eks/eks-pod-network-permissions.png)

*The pod path separates network reachability from cloud permission delivery so pod IPs and role credentials do not blur together.*


## Operating an EKS Cluster
<!-- section-summary: EKS operations include Kubernetes upgrades, add-ons, node capacity, autoscaling, observability, and policy guardrails. -->

EKS gives a powerful platform, and the platform needs steady care. The team plans Kubernetes version upgrades, managed add-on versions, node AMI updates, autoscaling, admission policies, network policies, image scanning, and observability. This is the work that makes EKS a platform instead of a loose collection of pods.

The core operational signals include:

| Signal | Why it matters |
|---|---|
| Deployment rollout status | Shows whether a release reached the desired pod state. |
| Pod readiness and restarts | Shows whether app containers are healthy enough for traffic. |
| Node readiness and pressure | Shows whether worker capacity can run pods safely. |
| Resource requests and limits | Controls scheduling, autoscaling, and eviction risk. |
| ALB target health | Shows whether AWS can reach the ready pods or nodes. |
| Pod logs and traces | Explains app-level errors after the platform routes traffic. |
| Add-on versions | VPC CNI, CoreDNS, kube-proxy, and controller versions affect networking and cluster behavior. |

For a rollout, start with:

```bash
kubectl -n orders rollout status deployment/orders-api
kubectl -n orders get pods -l app=orders-api -o wide
```

Example output:

```bash
deployment "orders-api" successfully rolled out
NAME                          READY   STATUS    RESTARTS   AGE   IP           NODE
orders-api-6b7c8d9f4f-2mrls   1/1     Running   0          4m    10.20.31.45  ip-10-20-11-24.eu-west-2.compute.internal
orders-api-6b7c8d9f4f-f8x92   1/1     Running   0          4m    10.20.42.18  ip-10-20-42-19.eu-west-2.compute.internal
orders-api-6b7c8d9f4f-x9q7p   1/1     Running   0          4m    10.20.12.9   ip-10-20-11-24.eu-west-2.compute.internal
```

`READY 1/1` means the container in each pod is ready. `STATUS Running` means the pod is running. `RESTARTS 0` means the container has not crashed since startup. The `IP` and `NODE` columns show VPC placement, which helps connect Kubernetes endpoints to ALB target health and node capacity.

Cluster upgrades need planning. Test the upgrade in a non-production cluster, check deprecated APIs in manifests, update managed add-ons such as VPC CNI, CoreDNS, and kube-proxy, roll node groups, and verify workloads. App teams should know the supported Kubernetes version window and when platform upgrades will happen.

Autoscaling also has layers. The Horizontal Pod Autoscaler changes pod replicas based on metrics. Cluster Autoscaler or Karpenter can add worker capacity when pods cannot schedule. These tools depend on realistic resource requests. Tiny requests can pack pods too tightly and create memory pressure. Oversized requests can waste nodes and block scheduling.

Policy guardrails matter because Kubernetes gives many teams one powerful API. Admission policies can require resource requests, approved registries, labels, non-root containers, and safe Ingress settings. Network policies can limit pod-to-pod traffic when the chosen networking setup supports enforcement. These controls keep the platform predictable as more services join.

With operations in mind, teams can make an honest ECS-versus-EKS decision.

## Choosing EKS or ECS
<!-- section-summary: The choice depends on whether Kubernetes as a platform is worth the additional operating responsibility. -->

ECS with Fargate is often the simpler AWS-native path for containers. It gives task definitions, services, IAM roles, load balancing, logs, and rolling deployments without a Kubernetes cluster. For a small number of AWS-only services, that simplicity is a real advantage.

EKS earns its place when Kubernetes solves an organization-level problem. GitOps, Helm standards, custom controllers, admission policy, service mesh, multi-cluster patterns, or a shared platform team can make Kubernetes valuable across many services. The value comes from the platform contract and ecosystem, while the cost is cluster operations.

Use these questions during design review:

| Question | ECS with Fargate often fits when | EKS often fits when |
|---|---|---|
| Who owns the platform? | The app team wants AWS-managed container hosting with fewer cluster duties. | A platform team owns Kubernetes standards, upgrades, and guardrails. |
| How many services share the pattern? | A few services need straightforward container hosting. | Many teams need one Kubernetes deployment contract. |
| Which tools matter? | AWS IAM, ALB, CloudWatch, and ECS deployments cover the need. | Helm, GitOps, controllers, policy, service mesh, or Kubernetes-native tooling are central. |
| What does debugging require? | ECS service events, task logs, target health, and IAM roles. | Kubernetes object state plus AWS load balancers, networking, nodes, and IAM. |
| What skills does on-call have? | Responders are comfortable with AWS-native service evidence. | Responders can use `kubectl`, AWS CLI, controller logs, and cluster metrics together. |

For `orders-api` alone, ECS with Fargate may be enough. For the commerce platform with many teams and Kubernetes standards, EKS can provide the shared operating layer. The decision should name who owns upgrades, add-ons, security policy, cost controls, and incident response before production traffic moves in.

## An EKS Debugging Path
<!-- section-summary: EKS debugging follows rollout state, pod scheduling, Service endpoints, Ingress events, ALB target health, node capacity, networking, and pod permissions. -->

At 11:40, `orders-api` returns intermittent `503` responses after a deployment. Start with Kubernetes rollout state:

```bash
kubectl -n orders rollout status deployment/orders-api
kubectl -n orders get pods -l app=orders-api -o wide
```

Example output:

```bash
Waiting for deployment "orders-api" rollout to finish: 1 old replicas are pending termination...
NAME                          READY   STATUS             RESTARTS   AGE   IP           NODE
orders-api-6b7c8d9f4f-2mrls   1/1     Running            0          20m   10.20.31.45  ip-10-20-11-24.eu-west-2.compute.internal
orders-api-7d8e9f5c6b-f8x92   0/1     CrashLoopBackOff   4          5m    10.20.42.18  ip-10-20-42-19.eu-west-2.compute.internal
orders-api-7d8e9f5c6b-x9q7p   0/1     CrashLoopBackOff   4          5m    10.20.12.9   ip-10-20-11-24.eu-west-2.compute.internal
```

The new replica set is crashing, so the rollout cannot finish. Describe a failed pod and read the previous container logs:

```bash
kubectl -n orders describe pod orders-api-7d8e9f5c6b-f8x92
kubectl -n orders logs orders-api-7d8e9f5c6b-f8x92 --previous
```

Example event lines from `describe pod`:

```bash
Events:
  Type     Reason     Age                  From               Message
  Normal   Scheduled  5m                   default-scheduler  Successfully assigned orders/orders-api-7d8e9f5c6b-f8x92 to ip-10-20-42-19.eu-west-2.compute.internal
  Normal   Pulled     4m                   kubelet            Successfully pulled image
  Warning  BackOff    2m (x5 over 4m)      kubelet            Back-off restarting failed container api
```

The scheduler placed the pod, the image pulled successfully, and the container crashed after startup. The logs might show `AccessDenied` for Secrets Manager. Check the service account and Pod Identity association:

```bash
kubectl -n orders get pod orders-api-7d8e9f5c6b-f8x92 \
  -o jsonpath='{.spec.serviceAccountName}'

aws eks list-pod-identity-associations \
  --cluster-name commerce-prod \
  --region eu-west-2
```

If the pod service account is `default` instead of `orders-api`, the Deployment manifest is wrong. If the service account is correct but the association points at another namespace or role, fix the association or IAM role policy. If both are correct, inspect the exact ARN in the error and the role policy resource.

If pods are ready but traffic still fails, inspect Service endpoints and Ingress events:

```bash
kubectl -n orders get endpoints orders-api
kubectl -n orders describe ingress orders-api
```

Example broken endpoint output:

```bash
NAME         ENDPOINTS   AGE
orders-api   <none>      12m
```

An empty endpoint list means the Service has no ready pods behind it. The common causes are a selector mismatch, failing readiness probes, or pods in a different namespace. If endpoints exist, move to ALB target health:

```bash
aws elbv2 describe-target-health \
  --target-group-arn "$TG_ARN" \
  --region eu-west-2 \
  --query 'TargetHealthDescriptions[].{Target:Target.Id,Port:Target.Port,State:TargetHealth.State,Reason:TargetHealth.Reason,Description:TargetHealth.Description}'
```

Example output:

```json
[
  {
    "Target": "10.20.31.45",
    "Port": 3000,
    "State": "healthy",
    "Reason": null,
    "Description": null
  },
  {
    "Target": "10.20.42.18",
    "Port": 3000,
    "State": "unhealthy",
    "Reason": "Target.Timeout",
    "Description": "Request timed out"
  }
]
```

The first pod IP is healthy. The second times out. That points toward readiness, app listener binding, pod security group or node security group, NetworkPolicy, or an app startup issue on that pod.

If pods stay pending, check scheduling:

```bash
kubectl -n orders describe pod "$POD_NAME"
```

Example event excerpt:

```console
Events:
  Type     Reason             Age   From               Message
  Warning  FailedScheduling   2m    default-scheduler  0/4 nodes are available: 3 Insufficient cpu, 1 node(s) had untolerated taint {dedicated: batch}.
```

`FailedScheduling` means Kubernetes has not found a node for the pod. `Insufficient cpu` points toward requested CPU versus node capacity. An untolerated taint means the pod does not have the toleration required for a restricted node pool.

Then compare node readiness and current usage:

```bash
kubectl get nodes
kubectl top nodes
```

Example output:

```console
NAME                                          STATUS   ROLES    AGE   VERSION
ip-10-20-31-12.eu-west-2.compute.internal    Ready    <none>   18d   v1.31.4
ip-10-20-42-19.eu-west-2.compute.internal    Ready    <none>   18d   v1.31.4
ip-10-20-53-44.eu-west-2.compute.internal    NotReady <none>   2h    v1.31.4

NAME                                          CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
ip-10-20-31-12.eu-west-2.compute.internal    1840m        92%    6230Mi          78%
ip-10-20-42-19.eu-west-2.compute.internal    1760m        88%    5901Mi          74%
```

`STATUS` separates node health from scheduling pressure. `NotReady` sends the investigation toward node group health, kubelet, networking, and recent node changes. High CPU or memory in `kubectl top nodes` supports the scheduler's capacity complaint. If resource capacity looks fine but pods still fail networking, check subnet IP capacity and VPC CNI health from the AWS side.

EKS incidents rarely live in one layer. A good investigation moves from Deployment rollout to pod events, then to Service endpoints, Ingress events, ALB target health, node capacity, networking, and pod AWS permissions. The value of EKS comes from the platform, and the responsibility is reading both Kubernetes and AWS evidence together.

![The debugging path gives an investigation order from rollout and pod events through target health, node capacity, networking, and permissions](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-eks/eks-debugging-path.png)

*The debugging path gives an investigation order from rollout and pod events through target health, node capacity, networking, and permissions.*


## References

- [What is Amazon EKS?](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)
- [Amazon EKS managed node groups](https://docs.aws.amazon.com/eks/latest/userguide/managed-node-groups.html)
- [Learn how EKS Pod Identity grants pods access to AWS services](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html)
- [Amazon VPC CNI](https://docs.aws.amazon.com/eks/latest/best-practices/vpc-cni.html)
- [Amazon EKS add-ons](https://docs.aws.amazon.com/eks/latest/userguide/eks-add-ons.html)
- [AWS Load Balancer Controller](https://docs.aws.amazon.com/eks/latest/userguide/aws-load-balancer-controller.html)
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/)
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
