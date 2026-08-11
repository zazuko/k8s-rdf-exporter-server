// @ts-check

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import rdf from "@zazuko/env-node";

import { createApp } from "../../src/app.js";
import { parseTurtle } from "../helpers/rdf.js";

const config = { clusterName: "test-cluster", baseIri: "urn:k8s:", baseIriOci: "urn:oci:" };

const clusterIri = rdf.namedNode("urn:k8s:cluster/test-cluster");
const clusterType = rdf.namedNode("https://k8s.described.at/Cluster");

/** A minimal dataset, standing in for what the exporter would return. */
const sampleDataset = () => rdf.dataset([
  rdf.quad(clusterIri, rdf.ns.rdf.type, clusterType),
  rdf.quad(clusterIri, rdf.ns.rdfs.label, rdf.literal("test-cluster")),
]);

/**
 * Build an app with a stubbed dataset builder.
 *
 * @param {(config: unknown) => Promise<unknown>} buildDataset stub to use.
 * @returns {import("fastify").FastifyInstance} the application, with the logger turned off.
 */
const appWith = (buildDataset) => createApp({
  config,
  logger: false,
  // @ts-expect-error -- the stub only needs to be call-compatible with the real builder
  buildDataset,
});

describe("GET /healthz", () => {
  it("reports that the server is up", async () => {
    const app = appWith(async () => sampleDataset());

    const response = await app.inject({ method: "GET", url: "/healthz" });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /^application\/json/);
    assert.equal(response.json().status, "ok");
  });

  it("returns a parsable ISO 8601 timestamp", async () => {
    const app = appWith(async () => sampleDataset());

    const { timestamp } = (await app.inject({ method: "GET", url: "/healthz" })).json();

    assert.equal(new Date(timestamp).toISOString(), timestamp);
  });

  // The health check is what the Kubernetes probes hit, so it must not depend on the cluster
  // being reachable: an exporter that cannot talk to the API server should not be restarted in a
  // loop by the kubelet.
  it("stays healthy even when the exporter cannot reach the cluster", async () => {
    const app = appWith(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const response = await app.inject({ method: "GET", url: "/healthz" });

    assert.equal(response.statusCode, 200);
  });
});

describe("GET /", () => {
  it("serves the dataset as Turtle", async () => {
    const app = appWith(async () => sampleDataset());

    const response = await app.inject({ method: "GET", url: "/" });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /^text\/turtle/);

    const dataset = await parseTurtle(response.body);
    assert.equal(dataset.match(clusterIri, rdf.ns.rdf.type, clusterType).size, 1);
    assert.equal([...dataset.match(clusterIri, rdf.ns.rdfs.label)][0]?.object.value, "test-cluster");
  });

  it("passes the configuration to the exporter", async () => {
    /** @type {unknown[]} */
    const calls = [];
    const app = appWith(async (received) => {
      calls.push(received);
      return sampleDataset();
    });

    await app.inject({ method: "GET", url: "/" });

    assert.deepEqual(calls, [config]);
  });

  it("serves an empty body for an empty dataset", async () => {
    const app = appWith(async () => rdf.dataset());

    const response = await app.inject({ method: "GET", url: "/" });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.trim(), "");
  });

  it("answers 500 with a JSON error when the exporter fails", async () => {
    const app = appWith(async () => {
      throw new Error("Forbidden: namespaces is forbidden");
    });

    const response = await app.inject({ method: "GET", url: "/" });

    assert.equal(response.statusCode, 500);
    assert.match(response.headers["content-type"] ?? "", /^application\/json/);
    assert.equal(response.json().status, "error");
  });

  // The upstream error can carry the service account token or the API server address; the client
  // has no business seeing either, they belong in the logs.
  it("does not leak the underlying error to the client", async () => {
    const app = appWith(async () => {
      throw new Error("Bearer eyJhbGciOiJSUzI1NiJ9.super-secret-token");
    });

    const response = await app.inject({ method: "GET", url: "/" });

    assert.doesNotMatch(response.body, /super-secret-token/);
  });
});
