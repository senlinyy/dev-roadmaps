Use `echo '...' > hello.sh` to write the script file. Then `chmod +x hello.sh` to make it executable. Finally `./hello.sh` to run it.

---

If you get "Permission denied", you forgot `chmod +x`. If you get "No such file or directory", make sure you wrote the file first with `echo ... > hello.sh`.
