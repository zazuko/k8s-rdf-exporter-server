# Tests

```sh
npm test           # lint + unit tests, no cluster needed
npm run test:e2e   # end-to-end tests, needs a Kubernetes cluster
```

## Unit tests

[`test/unit/`](./unit/) covers the parts that do not need a cluster:

- [`config.test.js`](./unit/config.test.js): how the environment variables are turned into the
  exporter configuration (defaults, `NAMESPACES` splitting and trimming, boolean flags).
- [`app.test.js`](./unit/app.test.js): both routes, through Fastify's `inject()`, with a stubbed
  dataset builder. This covers the Turtle response, the 500 answer when the exporter fails, and the
  fact that `/healthz` stays green in that case, so that Kubernetes does not restart a pod that is
  merely unable to reach the API server.

## End-to-end tests

[`test/e2e/`](./e2e/) runs the real server against a real cluster, in the two ways it can be
configured. They are what the [`Tests` workflow](../.github/workflows/test.yaml) runs on k3s.

- [`external.test.js`](./e2e/external.test.js) runs the server as a child process, pointing it at
  the API server with `API_URL` / `SERVICE_TOKEN` / `CERTIFICATE_PATH` / `CLUSTER_NAME`. This is the
  configuration path where `CLUSTER_NAME` actually shapes the exported IRIs. It covers the shape of
  the export (namespaces, deployments, statefulsets, ingresses, labels, annotations, OCI images),
  the `BASE_IRI` / `BASE_IRI_OCI` / `NAMESPACES` / `GENERATE_NAMESPACES` / `SKIP_TLS_VERIFY`
  options, and what the server answers when the service account is not allowed to read the cluster.
- [`in-cluster.test.js`](./e2e/in-cluster.test.js) deploys the server in the cluster with the
  manifests of [`k8s/examples/`](../k8s/examples/), and queries it through its service. On top of
  the export itself, this covers the examples: that the manifests are valid, that the image starts
  as a non-root user, that the probes answer, and that each example grants exactly the permissions
  the exporter needs.

The fixtures in [`fixtures/workloads.yaml`](./e2e/fixtures/workloads.yaml) all declare
`replicas: 0`: the exporter reads Kubernetes objects and never looks at the running pods, so the
tests never have to schedule a workload or pull an image.

### Running them locally

The tests need `kubectl`, a `KUBECONFIG` pointing at a cluster you do not mind writing to, and — for
the in-cluster tests — the image of this repository available on the node, tagged
`k8s-rdf-exporter-server:e2e`.

Any cluster works. To get a throw-away k3s with nothing but Docker:

```sh
# Start the cluster
docker run -d --name k3s-e2e --privileged --tmpfs /run --tmpfs /var/run \
  -p 6443:6443 -e K3S_KUBECONFIG_OUTPUT=/output/kubeconfig.yaml -e K3S_KUBECONFIG_MODE=666 \
  -v k3s-e2e-out:/output \
  rancher/k3s:latest server --tls-san=127.0.0.1 --disable=traefik --disable=metrics-server

# Point kubectl at it
docker cp k3s-e2e:/output/kubeconfig.yaml ./kubeconfig.yaml
export KUBECONFIG="${PWD}/kubeconfig.yaml"

# Build the image and side-load it into the cluster
docker build -t k8s-rdf-exporter-server:e2e .
docker save k8s-rdf-exporter-server:e2e \
  | docker exec -i k3s-e2e ctr -a /run/k3s/containerd/containerd.sock images import -

npm run test:e2e

# Once you are done
docker rm -f k3s-e2e && docker volume rm k3s-e2e-out
```

The tests create their own namespaces (`e2e-alpha`, `e2e-beta`), service accounts and workloads, and
remove them afterwards.
