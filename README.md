# Solutions

 - if not gracefully 1M requests found 50 requests
 - new pod want start need to know is ready

![screenshot](503.png)


# Command Load Test

```sh
wrk -t4 -c100 -d30s http://localhost:5000/load
```

