```yaml
      - name: Run Alpine Scanner
        uses: docker://alpine:3.20
        with:
          entrypoint: /bin/sh
          args: -c "echo 'Scanning...'"
```

The `docker://` prefix tells GitHub to pull the image and run the step inside it. The runner itself is still Ubuntu, but this specific step executes inside the Alpine container. This is useful when tools only compile or run on certain distros.
