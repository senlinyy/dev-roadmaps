A clean run looks like this:

```bash
$ echo 'echo "Hello from DevPolaris!"' > hello.sh
$ chmod +x hello.sh
$ ./hello.sh
Hello from DevPolaris!
```

You create the script with `echo` and output redirection (`>`), make it executable with `chmod +x`, and run it with `./`. The `./` prefix tells the shell to look for the script in the current directory.
