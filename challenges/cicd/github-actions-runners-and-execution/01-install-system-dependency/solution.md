```yaml
      - name: Install System Dependencies
        run: sudo apt-get update && sudo apt-get install -y libpq-dev
      - run: pip install -r requirements.txt
```

GitHub-hosted runners are ephemeral VMs. They come with many tools pre-installed, but not everything. System-level C libraries like `libpq-dev` (needed by Python's `psycopg2`) must be installed explicitly. The step must come before `pip install` because the C compiler needs the library headers during the build.
