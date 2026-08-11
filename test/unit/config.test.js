// @ts-check

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildConfigFromEnv, buildServerOptionsFromEnv } from "../../src/config.js";

describe("buildConfigFromEnv", () => {
  it("uses sane defaults when nothing is configured", () => {
    const config = buildConfigFromEnv({});

    assert.deepEqual(config, {
      clusterName: "k8s-cluster",
      baseIri: "urn:k8s:",
      baseIriOci: "urn:oci:",
      namespaces: undefined,
      generateNamespaces: false,
      skipTLSVerify: false,
      namespace: undefined,
      apiUrl: undefined,
      serviceToken: undefined,
      certificatePath: undefined,
    });
  });

  it("reads every supported environment variable", () => {
    const config = buildConfigFromEnv({
      CLUSTER_NAME: "prod",
      BASE_IRI: "https://example.org/k8s/",
      BASE_IRI_OCI: "https://example.org/oci/",
      NAMESPACES: "alpha,beta",
      GENERATE_NAMESPACES: "true",
      SKIP_TLS_VERIFY: "true",
      NAMESPACE: "alpha",
      API_URL: "https://kubernetes.example.org:6443",
      SERVICE_TOKEN: "a-token",
      CERTIFICATE_PATH: "/etc/ssl/ca.crt",
    });

    assert.deepEqual(config, {
      clusterName: "prod",
      baseIri: "https://example.org/k8s/",
      baseIriOci: "https://example.org/oci/",
      namespaces: ["alpha", "beta"],
      generateNamespaces: true,
      skipTLSVerify: true,
      namespace: "alpha",
      apiUrl: "https://kubernetes.example.org:6443",
      serviceToken: "a-token",
      certificatePath: "/etc/ssl/ca.crt",
    });
  });

  describe("NAMESPACES", () => {
    it("splits on commas and trims the surrounding whitespace", () => {
      const { namespaces } = buildConfigFromEnv({ NAMESPACES: " alpha , beta ,gamma" });

      assert.deepEqual(namespaces, ["alpha", "beta", "gamma"]);
    });

    it("handles a single namespace", () => {
      const { namespaces } = buildConfigFromEnv({ NAMESPACES: "alpha" });

      assert.deepEqual(namespaces, ["alpha"]);
    });

    // An empty list means "all namespaces" for the exporter, which is also what `undefined` means:
    // this keeps `NAMESPACES=""` from turning into a request for a namespace named "".
    it("is undefined when empty, so that all namespaces are exported", () => {
      assert.equal(buildConfigFromEnv({ NAMESPACES: "" }).namespaces, undefined);
    });
  });

  describe("boolean flags", () => {
    for (const variable of ["GENERATE_NAMESPACES", "SKIP_TLS_VERIFY"]) {
      const key = variable === "GENERATE_NAMESPACES" ? "generateNamespaces" : "skipTLSVerify";

      it(`enables ${key} only for the exact string "true" (${variable})`, () => {
        assert.equal(buildConfigFromEnv({ [variable]: "true" })[key], true);

        for (const value of ["TRUE", "True", "1", "yes", "false", ""]) {
          assert.equal(
            buildConfigFromEnv({ [variable]: value })[key],
            false,
            `expected ${variable}="${value}" not to enable ${key}`,
          );
        }
      });
    }
  });

  it("reads from process.env by default", () => {
    const previous = process.env.CLUSTER_NAME;
    process.env.CLUSTER_NAME = "from-process-env";

    try {
      assert.equal(buildConfigFromEnv().clusterName, "from-process-env");
    } finally {
      if (previous === undefined) {
        delete process.env.CLUSTER_NAME;
      } else {
        process.env.CLUSTER_NAME = previous;
      }
    }
  });
});

describe("buildServerOptionsFromEnv", () => {
  it("listens on 0.0.0.0:3000 by default", () => {
    assert.deepEqual(buildServerOptionsFromEnv({}), { port: 3000, host: "0.0.0.0" });
  });

  it("honours PORT and HOST", () => {
    assert.deepEqual(
      buildServerOptionsFromEnv({ PORT: "8080", HOST: "127.0.0.1" }),
      { port: 8080, host: "127.0.0.1" },
    );
  });
});
