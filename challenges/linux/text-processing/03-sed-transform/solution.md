```bash
sed 's/localhost/0.0.0.0/g' config.txt
sed '/^#/d' config.txt
sed -i 's/localhost/0.0.0.0/g' config.txt
cat config.txt
```

The first command previews the substitution. The second removes comment lines. The third applies the change permanently with `-i`. Finally `cat` confirms the file was updated.
