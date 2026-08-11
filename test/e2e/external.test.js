// @ts-check

/**
 * End-to-end tests running the server *outside* of the cluster, against the Kubernetes API of a
 * real k3s instance.
 *
 * This is the code path where the exporter builds its own Kubernetes configuration out of
 * API_URL / SERVICE_TOKEN / CERTIFICATE_PATH / CLUSTER_NAME, which is also the only path where
 * CLUSTER_NAME ends up in the exported IRIs.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  apply,
  apiUrl,
  createToken,
  kubeconfigClusterName,
  remove,
  requireCluster,
  writeClusterCa,
  writeUnrelatedCa,
} from "./lib/kubectl.js";
import { fetchDataset, withServer } from "./lib/server.js";
import {
  hasResource,
  k8s,
  oci,
  rdf,
  subjectsOfType,
  valuesOf,
} from "../helpers/rdf.js";

const workloads = fileURLToPath(new URL("./fixtures/workloads.yaml", import.meta.url));
const rbac = fileURLToPath(new URL("./fixtures/rbac.yaml", import.meta.url));

const CLUSTER_NAME = "e2e-cluster";

const clusterIri = `urn:k8s:cluster/${CLUSTER_NAME}`;
const namespaceIri = (name) => `${clusterIri}/namespace/${name}`;
const resourceIri = (namespace, kind, name) => `${namespaceIri(namespace)}/${kind}/${name}`;

/** @type {Record<string, string>} */
let baseEnv;

before(async () => {
  await requireCluster();

  // Server-side apply keeps Kubernetes from adding a `last-applied-configuration` annotation,
  // which would otherwise show up in the exported RDF as an annotation of every fixture.
  await apply(workloads, { serverSide: true });
  await apply(rbac, { serverSide: true });

  baseEnv = {
    CLUSTER_NAME,
    API_URL: await apiUrl(),
    CERTIFICATE_PATH: await writeClusterCa(),
  };
});

after(async () => {
  await remove(rbac);
  await remove(workloads);
});

describe("full export with a complete cluster configuration", () => {
  /** @type {import("@zazuko/env/lib/Dataset.js").Dataset} */
  let dataset;
  /** @type {Response} */
  let response;

  before(async () => {
    const env = { ...baseEnv, SERVICE_TOKEN: await createToken("default", "e2e-viewer") };

    await withServer(env, async ({ url }) => {
      response = await fetch(url);
      dataset = await fetchDataset(url);
    });
  });

  it("serves Turtle", () => {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/turtle/);
  });

  it("names the cluster after CLUSTER_NAME", () => {
    assert.deepEqual(subjectsOfType(dataset, k8s.Cluster), [clusterIri]);
    assert.deepEqual(valuesOf(dataset, clusterIri, rdf.ns.rdfs.label), [CLUSTER_NAME]);
  });

  it("exports every namespace of the cluster, linked to the cluster", () => {
    const namespaces = subjectsOfType(dataset, k8s.Namespace);

    for (const name of ["default", "kube-system", "e2e-alpha", "e2e-beta"]) {
      assert.ok(namespaces.includes(namespaceIri(name)), `missing namespace ${name}`);
      assert.deepEqual(valuesOf(dataset, namespaceIri(name), k8s.cluster), [clusterIri]);
    }
  });

  it("exports the labels and annotations of a namespace", () => {
    // Keys containing a slash end up in the IRI as-is, hence the `.../label/e2e.zazuko.com/suite`.
    const label = `${namespaceIri("e2e-alpha")}/label/e2e.zazuko.com/suite`;
    const annotation = `${namespaceIri("e2e-alpha")}/annotation/e2e.zazuko.com/description`;

    assert.ok(hasResource(dataset, label, k8s.Label));
    assert.deepEqual(valuesOf(dataset, label, rdf.ns.rdfs.label), ["e2e.zazuko.com/suite"]);
    assert.deepEqual(valuesOf(dataset, label, rdf.ns.rdf.value), ["rdf-exporter"]);
    assert.ok(valuesOf(dataset, namespaceIri("e2e-alpha"), k8s.label).includes(label));

    assert.ok(hasResource(dataset, annotation, k8s.Annotation));
    assert.deepEqual(
      valuesOf(dataset, annotation, rdf.ns.rdf.value),
      ["Namespace used by the end-to-end tests"],
    );
  });

  it("exports deployments with their label, namespace and metadata", () => {
    const deployment = resourceIri("e2e-alpha", "deployment", "alpha-api");

    assert.ok(hasResource(dataset, deployment, k8s.Deployment));
    assert.deepEqual(valuesOf(dataset, deployment, rdf.ns.rdfs.label), ["alpha-api"]);
    assert.deepEqual(valuesOf(dataset, deployment, k8s.namespace), [namespaceIri("e2e-alpha")]);

    const tier = `${deployment}/label/e2e.zazuko.com/tier`;
    assert.deepEqual(valuesOf(dataset, tier, rdf.ns.rdf.value), ["backend"]);

    const owner = `${deployment}/annotation/e2e.zazuko.com/owner`;
    assert.deepEqual(valuesOf(dataset, owner, rdf.ns.rdf.value), ["platform-team"]);
  });

  it("links every container image of a deployment", () => {
    assert.deepEqual(
      valuesOf(dataset, resourceIri("e2e-alpha", "deployment", "alpha-api"), k8s.image),
      ["urn:oci:docker.io/library/busybox:1.36", "urn:oci:ghcr.io/zazuko/alpha-api:1.4.2"],
    );
  });

  it("normalises image names without a registry or a tag", () => {
    const image = "urn:oci:docker.io/library/nginx:latest";

    assert.deepEqual(
      valuesOf(dataset, resourceIri("e2e-alpha", "deployment", "alpha-web"), k8s.image),
      [image],
    );

    // Image -> Repository -> Registry
    assert.ok(hasResource(dataset, image, oci.Image));
    assert.deepEqual(valuesOf(dataset, image, oci.repository), ["urn:oci:docker.io/library/nginx"]);
    assert.ok(hasResource(dataset, "urn:oci:docker.io/library/nginx", oci.Repository));
    assert.deepEqual(valuesOf(dataset, "urn:oci:docker.io/library/nginx", oci.registry), ["urn:oci:docker.io"]);
    assert.ok(hasResource(dataset, "urn:oci:docker.io", oci.Registry));
  });

  it("exports statefulsets", () => {
    const statefulSet = resourceIri("e2e-alpha", "statefulset", "alpha-db");

    assert.ok(hasResource(dataset, statefulSet, k8s.StatefulSet));
    assert.deepEqual(valuesOf(dataset, statefulSet, k8s.namespace), [namespaceIri("e2e-alpha")]);
    assert.deepEqual(valuesOf(dataset, statefulSet, k8s.image), ["urn:oci:docker.io/library/postgres:17.2-alpine"]);
    assert.deepEqual(
      valuesOf(dataset, `${statefulSet}/annotation/e2e.zazuko.com/backup`, rdf.ns.rdf.value),
      ["nightly"],
    );
  });

  it("exports ingresses with one node per host", () => {
    const ingress = resourceIri("e2e-alpha", "ingress", "alpha-ingress");

    assert.ok(hasResource(dataset, ingress, k8s.Ingress));
    assert.deepEqual(valuesOf(dataset, ingress, k8s.namespace), [namespaceIri("e2e-alpha")]);
    assert.deepEqual(valuesOf(dataset, ingress, k8s.host), [
      `${ingress}/host/alpha.e2e.example.org`,
      `${ingress}/host/www.alpha.e2e.example.org`,
    ]);
    assert.deepEqual(
      valuesOf(dataset, `${ingress}/host/alpha.e2e.example.org`, rdf.ns.rdfs.label),
      ["alpha.e2e.example.org"],
    );
  });

  it("exports an ingress that has no host at all", () => {
    const ingress = resourceIri("e2e-alpha", "ingress", "alpha-hostless");

    assert.ok(hasResource(dataset, ingress, k8s.Ingress));
    assert.deepEqual(valuesOf(dataset, ingress, k8s.host), []);
  });
});

describe("custom base IRIs", () => {
  /** @type {import("@zazuko/env/lib/Dataset.js").Dataset} */
  let dataset;

  before(async () => {
    const env = {
      ...baseEnv,
      SERVICE_TOKEN: await createToken("default", "e2e-viewer"),
      BASE_IRI: "https://example.org/k8s/",
      BASE_IRI_OCI: "https://example.org/oci/",
    };

    dataset = await withServer(env, ({ url }) => fetchDataset(url));
  });

  it("uses BASE_IRI for Kubernetes resources", () => {
    assert.deepEqual(subjectsOfType(dataset, k8s.Cluster), [`https://example.org/k8s/cluster/${CLUSTER_NAME}`]);
    assert.ok(subjectsOfType(dataset, k8s.Deployment)
      .includes(`https://example.org/k8s/cluster/${CLUSTER_NAME}/namespace/e2e-alpha/deployment/alpha-api`));
  });

  it("uses BASE_IRI_OCI for images", () => {
    assert.ok(subjectsOfType(dataset, oci.Image).includes("https://example.org/oci/docker.io/library/nginx:latest"));
  });

  it("leaves no resource under the default base IRIs", () => {
    const stragglers = [...dataset]
      .flatMap(({ subject, object }) => [subject.value, object.value])
      .filter((value) => value.startsWith("urn:k8s:") || value.startsWith("urn:oci:"));

    assert.deepEqual(stragglers, []);
  });
});

describe("NAMESPACES", () => {
  it("exports a single namespace, ignoring the surrounding whitespace", async () => {
    const env = {
      ...baseEnv,
      SERVICE_TOKEN: await createToken("default", "e2e-viewer"),
      NAMESPACES: "  e2e-alpha  ",
    };

    const dataset = await withServer(env, ({ url }) => fetchDataset(url));

    assert.deepEqual(subjectsOfType(dataset, k8s.Namespace), [namespaceIri("e2e-alpha")]);
    assert.deepEqual(subjectsOfType(dataset, k8s.Deployment), [
      resourceIri("e2e-alpha", "deployment", "alpha-api"),
      resourceIri("e2e-alpha", "deployment", "alpha-web"),
    ]);
  });

  it("exports several namespaces, and nothing else", async () => {
    const env = {
      ...baseEnv,
      SERVICE_TOKEN: await createToken("default", "e2e-viewer"),
      NAMESPACES: "e2e-alpha, e2e-beta",
    };

    const dataset = await withServer(env, ({ url }) => fetchDataset(url));

    assert.deepEqual(
      subjectsOfType(dataset, k8s.Namespace),
      [namespaceIri("e2e-alpha"), namespaceIri("e2e-beta")],
    );
    assert.ok(subjectsOfType(dataset, k8s.Deployment).includes(resourceIri("e2e-beta", "deployment", "beta-worker")));

    // The cluster is still exported, it is not tied to any namespace.
    assert.deepEqual(subjectsOfType(dataset, k8s.Cluster), [clusterIri]);
  });

  it("fails loudly when one of the namespaces does not exist", async () => {
    const env = {
      ...baseEnv,
      SERVICE_TOKEN: await createToken("default", "e2e-viewer"),
      NAMESPACES: "e2e-alpha,does-not-exist",
    };

    const status = await withServer(env, async ({ url }) => (await fetch(url)).status);

    assert.equal(status, 500);
  });
});

describe("GENERATE_NAMESPACES, for a service account that cannot read namespaces", () => {
  /** @type {Record<string, string>} */
  let env;

  before(async () => {
    env = {
      ...baseEnv,
      SERVICE_TOKEN: await createToken("default", "e2e-workloads-only"),
      NAMESPACES: "e2e-alpha",
    };
  });

  it("fails without it, because reading the namespace is forbidden", async () => {
    const { status, body } = await withServer(env, async ({ url }) => {
      const response = await fetch(url);
      return { status: response.status, body: await response.text() };
    });

    assert.equal(status, 500);
    assert.equal(JSON.parse(body).status, "error");
  });

  it("succeeds with it, and generates the namespace instead of reading it", async () => {
    const dataset = await withServer(
      { ...env, GENERATE_NAMESPACES: "true" },
      ({ url }) => fetchDataset(url),
    );

    assert.deepEqual(subjectsOfType(dataset, k8s.Namespace), [namespaceIri("e2e-alpha")]);
    assert.ok(subjectsOfType(dataset, k8s.Deployment).includes(resourceIri("e2e-alpha", "deployment", "alpha-api")));

    // A generated namespace carries no metadata, since it was never read from the cluster.
    assert.deepEqual(valuesOf(dataset, namespaceIri("e2e-alpha"), k8s.label), []);
    assert.deepEqual(valuesOf(dataset, namespaceIri("e2e-alpha"), k8s.annotation), []);
  });
});

describe("a service account without any permission", () => {
  /** @type {Record<string, string>} */
  let env;

  before(async () => {
    env = { ...baseEnv, SERVICE_TOKEN: await createToken("default", "e2e-powerless") };
  });

  it("gets a 500 with a generic error message", async () => {
    const { status, body } = await withServer(env, async ({ url }) => {
      const response = await fetch(url);
      return { status: response.status, body: await response.text() };
    });

    assert.equal(status, 500);
    assert.deepEqual(JSON.parse(body), {
      status: "error",
      message: "Unable to retrieve Kubernetes state. Please check the logs for more details.",
    });
  });

  it("keeps the health check green, so that Kubernetes does not restart the pod", async () => {
    const status = await withServer(env, async ({ url }) => (await fetch(`${url}/healthz`)).status);

    assert.equal(status, 200);
  });
});

describe("SKIP_TLS_VERIFY", () => {
  /** @type {Record<string, string>} */
  let env;

  before(async () => {
    env = {
      ...baseEnv,
      SERVICE_TOKEN: await createToken("default", "e2e-viewer"),
      // A valid certificate, but not the one the API server certificate was signed with.
      CERTIFICATE_PATH: await writeUnrelatedCa(),
    };
  });

  it("fails against an untrusted API server when it is not set", async () => {
    const status = await withServer(env, async ({ url }) => (await fetch(url)).status);

    assert.equal(status, 500);
  });

  it("exports the cluster anyway when it is set", async () => {
    const dataset = await withServer(
      { ...env, SKIP_TLS_VERIFY: "true" },
      ({ url }) => fetchDataset(url),
    );

    assert.deepEqual(subjectsOfType(dataset, k8s.Cluster), [clusterIri]);
  });
});

describe("an incomplete cluster configuration", () => {
  // The exporter only uses API_URL / SERVICE_TOKEN / CERTIFICATE_PATH / CLUSTER_NAME when all four
  // are set; as soon as one is missing it silently falls back to the default Kubernetes
  // configuration. CLUSTER_NAME is then ignored, and the cluster is named after the kubeconfig.
  it("falls back to the default Kubernetes configuration, ignoring CLUSTER_NAME", async () => {
    // `baseEnv` has CLUSTER_NAME, API_URL and CERTIFICATE_PATH, but no SERVICE_TOKEN: the exporter
    // therefore reads the kubeconfig it inherited from the environment instead.
    const dataset = await withServer(baseEnv, ({ url }) => fetchDataset(url));

    const expected = `urn:k8s:cluster/${await kubeconfigClusterName()}`;

    assert.deepEqual(subjectsOfType(dataset, k8s.Cluster), [expected]);
    assert.notEqual(expected, clusterIri);
  });
});
