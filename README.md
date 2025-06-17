# `k8s-rdf-exporter` as a HTTP server

## Deploy it on Kubernetes

This will deploy it in the `default` namespace in your current Kubernetes cluster (current context).

```sh
# Deploy the k8s-rdf-exporter in the "default" namespace
kubectl kustomize k8s | kubectl apply -f -

# Check that the pod is running
kubectl -n default get pods

# Port-forward the service to your local machine
kubectl -n default port-forward service/k8s-rdf-exporter 3000:3000

# Access the service in your browser
http://localhost:3000/

# You should see the RDF in turtle format
```

To deploy it in a different namespace, you can change the `namespace` field in the [`kustomization.yaml`](./k8s/kustomization.yaml) file.

By default, only the `default` and `kube-system` namespaces are exported.
You can change this by modifying the `NAMESPACES` environment variable in the [`deployment.yaml`](./k8s/deployment.yaml) file.
If you comment it out, all namespaces will be exported.
