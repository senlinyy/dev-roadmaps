```bash
pwd
ls -a
cd ../../downloads
pwd
cd /home/dev/projects/api/config
```

- `../../downloads` is resolved from the starting directory.
- The final path begins at `/`, so it resolves independently of the current directory.
