# Examples

## ClusterRole Example

This uses the `view` ClusterRole to allow the `k8s-rdf-exporter` to read all resources in the cluster.

```sh
# Deploy the k8s-rdf-exporter in the "default" namespace (this would use the ClusterRole example)
kubectl kustomize clusterrole | kubectl apply -f -

# Check that the pod is running
kubectl -n default get pods

# Port-forward the service to your local machine
kubectl -n default port-forward service/k8s-rdf-exporter http

# Access the service in your browser
http://localhost:3000/

# You should see the RDF in turtle format
```

By default, all namespaces are exported.

## Role Example

This uses a precise Role to allow the `k8s-rdf-exporter` to read resources in the `default` namespace.

```sh
# Deploy the k8s-rdf-exporter in the "default" namespace (this would use the Role example)
kubectl kustomize role | kubectl apply -f -

# Check that the pod is running
kubectl -n default get pods

# Port-forward the service to your local machine
kubectl -n default port-forward service/k8s-rdf-exporter http

# Access the service in your browser
http://localhost:3000/

# You should see the RDF in turtle format
```

This is useful if you want to limit the access of the `k8s-rdf-exporter` to a specific namespace, in case you have very restricted permissions in your cluster.

You will need to change the `namespace` field in the [`kustomization.yaml`](./role/kustomization.yaml) file to match your desired namespace.

By default, only the `default` namespace is exported.
You can change this by modifying the `NAMESPACES` environment variable in the overrides done in the [`kustomization.yaml`](./role/kustomization.yaml) file.
You can also specify multiple namespaces by separating them with commas, e.g. `default,kube-system`, but you will also need to create the required Role and RoleBinding for each namespace.
