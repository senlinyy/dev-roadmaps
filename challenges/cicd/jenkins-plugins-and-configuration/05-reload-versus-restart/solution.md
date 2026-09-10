### maintenance.yaml

```yaml
operations:
  - reload
  - build
  - boot
  - smoke
  - promote
```

### plugins.txt

```text
configuration-as-code:lab-2
git:lab-2
git-client:lab-2
workflow-aggregator:lab-2
```

Evidence contains both JCasC reload and fresh boot, followed by smoke and promotion. Loaded code ends at lab-core-2; a startup migration failure prevents promotion.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Configuration as Code](https://www.jenkins.io/doc/book/managing/casc/).
