// @ts-check

/**
 * End-to-end tests running the server *inside* the cluster, deployed with the very manifests this
 * repository ships in `k8s/examples/`.
 *
 * On top of the RDF export itself, these tests cover the examples: that the manifests are valid,
 * that the container starts as a non-root user, that the probes answer, and that each example
 * grants exactly the permissions the exporter needs.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  apply,
  kubectl,
  portForward,
  remove,
  requireCluster,
  waitForRollout,
} from "./lib/kubectl.js";
import { fetchDataset } from "./lib/server.js";
import { hasResource, k8s, rdf, subjectsOfType, valuesOf } from "../helpers/rdf.js";

const workloads = fileURLToPath(new URL("./fixtures/workloads.yaml", import.meta.url));
const overlay = (example) => fileURLToPath(new URL(`./fixtures/overlays/${example}`, import.meta.url));

/** The image built from this checkout, side-loaded into the node before the tests run. */
const IMAGE = "urn:oci:docker.io/library/k8s-rdf-exporter-server:e2e";

const NAMESPACE = "default";
const NAME = "k8s-rdf-exporter";

// Deployed in the cluster, the exporter authenticates with its service account, and the Kubernetes
// client calls that configuration "inCluster". CLUSTER_NAME is not used on this code path.
const clusterIri = "urn:k8s:cluster/inCluster";
const namespaceIri = (name) => `${clusterIri}/namespace/${name}`;
const resourceIri = (namespace, kind, name) => `${namespaceIri(namespace)}/${kind}/${name}`;

before(async () => {
  await requireCluster();
  await apply(workloads, { serverSide: true });
});

after(async () => {
  await remove(workloads);
});

/**
 * Deploy one of the examples, and export the cluster through it.
 *
 * @param {string} example name of the example, under `k8s/examples/`.
 * @returns {{
 *   dataset: () => import("@zazuko/env/lib/Dataset.js").Dataset,
 *   url: () => string,
 * }} accessors, only valid once the suite hooks have run.
 */
const deployedExample = (example) => {
  /** @type {import("@zazuko/env/lib/Dataset.js").Dataset} */
  let dataset;
  /** @type {{ url: string, stop: () => Promise<void> } | undefined} */
  let forward;

  before(async () => {
    await apply(overlay(example), { kustomize: true });

    // A successful rollout already proves a lot: the image runs as the non-root user the manifests
    // ask for, and the readiness probe on /healthz answers.
    await waitForRollout(NAMESPACE, NAME);

    forward = await portForward(NAMESPACE, NAME, 3000);
    dataset = await fetchDataset(forward.url);
  });

  after(async () => {
    await forward?.stop();
    await remove(overlay(example), { kustomize: true });
  });

  return {
    dataset: () => dataset,
    url: () => {
      if (!forward) {
        throw new Error("the port-forward is not up");
      }
      return forward.url;
    },
  };
};

/**
 * Read the number of times the containers of the exporter have been restarted.
 *
 * @returns {Promise<number[]>} one count per container.
 */
const restartCounts = async () => {
  const { stdout } = await kubectl([
    "-n", NAMESPACE,
    "get", "pods",
    "-l", `app.kubernetes.io/name=${NAME}`,
    "-o", "jsonpath={.items[*].status.containerStatuses[*].restartCount}",
  ]);

  return stdout.trim().split(/\s+/).filter(Boolean).map(Number);
};

describe("deployed with the ClusterRole example", () => {
  const deployed = deployedExample("clusterrole");

  it("answers the health check through its service", async () => {
    const response = await fetch(`${deployed.url()}/healthz`);

    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ok");
  });

  it("runs without restarting", async () => {
    assert.deepEqual(await restartCounts(), [0]);
  });

  it("names the cluster after the in-cluster configuration", () => {
    assert.deepEqual(subjectsOfType(deployed.dataset(), k8s.Cluster), [clusterIri]);
  });

  it("exports every namespace of the cluster", () => {
    const namespaces = subjectsOfType(deployed.dataset(), k8s.Namespace);

    for (const name of ["default", "kube-system", "e2e-alpha", "e2e-beta"]) {
      assert.ok(namespaces.includes(namespaceIri(name)), `missing namespace ${name}`);
    }
  });

  it("exports the workloads of every namespace", () => {
    const deployments = subjectsOfType(deployed.dataset(), k8s.Deployment);

    assert.ok(deployments.includes(resourceIri("e2e-alpha", "deployment", "alpha-api")));
    assert.ok(deployments.includes(resourceIri("e2e-beta", "deployment", "beta-worker")));
    assert.ok(subjectsOfType(deployed.dataset(), k8s.StatefulSet)
      .includes(resourceIri("e2e-alpha", "statefulset", "alpha-db")));
    assert.ok(subjectsOfType(deployed.dataset(), k8s.Ingress)
      .includes(resourceIri("e2e-alpha", "ingress", "alpha-ingress")));
  });

  it("exports its own deployment, image included", () => {
    const self = resourceIri(NAMESPACE, "deployment", NAME);

    assert.ok(hasResource(deployed.dataset(), self, k8s.Deployment));
    assert.deepEqual(valuesOf(deployed.dataset(), self, rdf.ns.rdfs.label), [NAME]);
    assert.deepEqual(valuesOf(deployed.dataset(), self, k8s.image), [IMAGE]);
  });
});

describe("deployed with the Role example", () => {
  const deployed = deployedExample("role");

  it("answers the health check through its service", async () => {
    const response = await fetch(`${deployed.url()}/healthz`);

    assert.equal(response.status, 200);
  });

  // The example binds a Role in the "default" namespace only, and restricts the exporter to that
  // namespace with NAMESPACES=default. Nothing else in the cluster may be read.
  it("exports the configured namespace, and only that one", () => {
    assert.deepEqual(subjectsOfType(deployed.dataset(), k8s.Namespace), [namespaceIri(NAMESPACE)]);
  });

  it("exports its own deployment", () => {
    const self = resourceIri(NAMESPACE, "deployment", NAME);

    assert.ok(hasResource(deployed.dataset(), self, k8s.Deployment));
    assert.deepEqual(valuesOf(deployed.dataset(), self, k8s.image), [IMAGE]);
  });

  it("does not export the workloads it has no permission for", () => {
    const deployments = subjectsOfType(deployed.dataset(), k8s.Deployment);

    assert.ok(!deployments.includes(resourceIri("e2e-alpha", "deployment", "alpha-api")));
    assert.ok(!deployments.includes(resourceIri("e2e-beta", "deployment", "beta-worker")));
  });
});
