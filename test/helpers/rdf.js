// @ts-check

import { Readable } from "node:stream";

import rdf from "@zazuko/env-node";

export { default as rdf } from "@zazuko/env-node";

/** Vocabulary used by the exporter for Kubernetes resources. */
export const k8s = rdf.namespace("https://k8s.described.at/");

/** Vocabulary used by the exporter for OCI images. */
export const oci = rdf.namespace("https://oci.described.at/");

/**
 * Parse a Turtle document into a dataset.
 *
 * @param {string} turtle Turtle document.
 * @returns {Promise<import("@zazuko/env/lib/Dataset.js").Dataset>} the parsed dataset.
 */
export const parseTurtle = (turtle) => rdf.dataset()
  .import(rdf.formats.parsers.import("text/turtle", Readable.from([turtle])));

/**
 * List the IRIs of all subjects of a given type.
 *
 * @param {import("@rdfjs/types").DatasetCore} dataset dataset to look into.
 * @param {import("@rdfjs/types").NamedNode} type type to look for.
 * @returns {string[]} sorted IRIs of the matching subjects.
 */
export const subjectsOfType = (dataset, type) => [...dataset.match(null, rdf.ns.rdf.type, type)]
  .map(({ subject }) => subject.value)
  .sort();

/**
 * List the values of a given property of a given subject.
 *
 * @param {import("@rdfjs/types").DatasetCore} dataset dataset to look into.
 * @param {string | import("@rdfjs/types").NamedNode} subject subject to look at.
 * @param {import("@rdfjs/types").NamedNode} predicate property to read.
 * @returns {string[]} sorted values of the matching objects.
 */
export const valuesOf = (dataset, subject, predicate) => [
  ...dataset.match(typeof subject === "string" ? rdf.namedNode(subject) : subject, predicate),
]
  .map(({ object }) => object.value)
  .sort();

/**
 * Check whether the dataset contains a given resource with a given type.
 *
 * @param {import("@rdfjs/types").DatasetCore} dataset dataset to look into.
 * @param {string} iri IRI of the resource.
 * @param {import("@rdfjs/types").NamedNode} type expected type.
 * @returns {boolean} true if the resource exists with that type.
 */
export const hasResource = (dataset, iri, type) => dataset
  .match(rdf.namedNode(iri), rdf.ns.rdf.type, type).size > 0;
