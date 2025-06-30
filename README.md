# `k8s-rdf-exporter` as a HTTP server

This is a simple HTTP server that exports Kubernetes resources in RDF format.
It is using the [Kubernetes RDF Exporter](https://github.com/zazuko/k8s-rdf-exporter) tool to convert Kubernetes resources to RDF.

## Deploy it on Kubernetes

This will deploy it in the `default` namespace in your current Kubernetes cluster (current context).

```sh
# Deploy the k8s-rdf-exporter in the "default" namespace (this would use the ClusterRole example)
kubectl kustomize k8s/examples/clustrrole | kubectl apply -f -
# or, if you want to use the Role example:
# kubectl kustomize k8s/examples/role | kubectl apply -f -

# Check that the pod is running
kubectl -n default get pods

# Port-forward the service to your local machine
kubectl -n default port-forward service/k8s-rdf-exporter http

# Access the service in your browser
http://localhost:3000/

# You should see the RDF in turtle format
```

To deploy it in a different namespace, you can change the `namespace` field in the `kustomization.yaml` file for your desired example.
Get more information depending on the example you are using in the [`k8s/examples/`](./k8s/examples/) directory.
