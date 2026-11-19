import type { IngestDocumentInput } from "../../documents/types/document.types.js";

/**
 * Evaluation corpus: real technical documentation ingested through the
 * canonical ingestion pipeline (see scripts/seed-eval-corpus.ts). The
 * (source, url) identities are the ones the evaluation dataset judges
 * against - they are real public documentation locations.
 *
 * This is a curated dev/eval corpus, not a production crawl.
 */
export const EVAL_CORPUS: IngestDocumentInput[] = [
  {
    title: "Stream | Node.js API Docs",
    url: "https://nodejs.org/api/stream.html",
    source: "nodejs",
    category: "documentation",
    contentType: "html",
    technologies: ["nodejs", "javascript", "streams"],
    content: `A stream is an abstract interface for working with streaming data in Node.js. The node:stream module provides an API for implementing the stream interface. There are many stream objects provided by Node.js: a request to an HTTP server and process.stdout are both stream instances.

Streams can be readable, writable, or both. All streams are instances of EventEmitter. The four fundamental stream types are Readable, Writable, Duplex, and Transform. A Duplex stream is both Readable and Writable, while a Transform stream is a Duplex stream where the output is computed from the input.

The stream API supports backpressure: when a Writable stream cannot accept data as fast as a Readable produces it, the readable side pauses until the writable drains. Use stream.pipe() and pipeline() to compose streams; pipeline() propagates errors and cleans up destroyed streams automatically.`,
  },
  {
    title: "Events | Node.js API Docs",
    url: "https://nodejs.org/api/events.html",
    source: "nodejs",
    category: "documentation",
    contentType: "html",
    technologies: ["nodejs", "javascript", "events"],
    content: `Much of the Node.js core API is built around an idiomatic asynchronous event-driven architecture in which certain kinds of objects, called emitters, emit named events that cause Function objects, called listeners, to be called.

All objects that emit events are instances of the EventEmitter class. These objects expose an eventEmitter.on() function that allows one or more functions to be attached to named events emitted by the object. Typically event names are camel-cased strings but any valid JavaScript property key can be used.

When the EventEmitter object emits an event, all of the functions attached to that specific event are called synchronously, in the order they were registered. The eventEmitter.emit() method triggers the event; once() registers a listener invoked at most once; removeListener() detaches handlers. Error events require a listener or the process throws.`,
  },
  {
    title: "File system | Node.js API Docs",
    url: "https://nodejs.org/api/fs.html",
    source: "nodejs",
    category: "documentation",
    contentType: "html",
    technologies: ["nodejs", "javascript", "filesystem"],
    content: `The node:fs module enables interacting with the file system in a way modeled on standard POSIX functions. To use the promise-based API import from node:fs/promises.

fs.promises.readFile(path) asynchronously reads the entire contents of a file and resolves with the data. fs.promises.writeFile writes data to a file, replacing it if it exists. For large files prefer fs.createReadStream() and fs.createWriteStream(), which stream data in chunks without loading everything into memory.

The callback-based variants such as fs.readFile(path, callback) follow the error-first convention. Synchronous variants like fs.readFileSync() block the event loop and should be used only at startup. Watchers via fs.watch() notify on file changes; stat() reports size, permissions and timestamps.`,
  },
  {
    title: "Buffer | Node.js API Docs",
    url: "https://nodejs.org/api/buffer.html",
    source: "nodejs",
    category: "documentation",
    contentType: "html",
    technologies: ["nodejs", "javascript", "buffers"],
    content: `The Buffer class is a subclass of JavaScript's Uint8Array that provides methods for working with binary data directly in memory. Node.js uses buffers to handle octet streams for file system operations, TCP streams, and crypto.

Buffer.alloc(size) creates a zero-filled buffer; Buffer.from(string, encoding) creates one from a string, defaulting to UTF-8. buffer.toString('base64') or 'hex' converts between representations. Buffer.concat(list) joins buffers efficiently.

Buffers are fixed-length: they cannot be resized after creation. Avoid Buffer.allocUnsafe() unless performance is critical, since it may expose previous memory contents. Modern code often prefers Uint8Array and TextEncoder/TextDecoder for cross-platform compatibility.`,
  },
  {
    title: "Promise - JavaScript | MDN",
    url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise",
    source: "mdn",
    category: "reference",
    contentType: "html",
    technologies: ["javascript", "async", "promises"],
    content: `The Promise object represents the eventual completion or failure of an asynchronous operation and its resulting value. A Promise is in one of three states: pending, fulfilled, or rejected. Once settled, a promise's state and value cannot change.

promise.then(onFulfilled, onRejected) schedules callbacks; it returns a new promise, enabling chaining. catch() handles rejections and errors thrown in handlers; finally() runs cleanup regardless of outcome. Promise.all() resolves when every input resolves or rejects on the first rejection; Promise.allSettled() waits for all outcomes; Promise.race() settles with the first settled input.

Promises are the foundation of async/await: an async function returns a promise, and await unwraps it, propagating rejections to the surrounding try/catch.`,
  },
  {
    title: "Array - JavaScript | MDN",
    url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array",
    source: "mdn",
    category: "reference",
    contentType: "html",
    technologies: ["javascript", "arrays"],
    content: `The Array object enables storing a collection of multiple items under a single variable name and has members for performing common array operations.

Array.prototype.map() creates a new array populated with the results of calling a function on every element. filter() returns elements passing a test. reduce() executes a reducer callback, accumulating to a single value. forEach() iterates for side effects; find() and findIndex() locate elements; some() and every() test predicates.

Methods like slice() and concat() return new arrays without mutating the original, while push(), pop(), splice(), and sort() mutate in place. Array.from() and the spread syntax create arrays from iterables and array-like objects.`,
  },
  {
    title: "Closures - JavaScript | MDN",
    url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures",
    source: "mdn",
    category: "documentation",
    contentType: "html",
    technologies: ["javascript", "scope", "closures"],
    content: `A closure is the combination of a function bundled together with references to its surrounding state, the lexical environment. In JavaScript, closures are created every time a function is created, at function creation time.

A closure gives you access to an outer function's scope from an inner function, even after the outer function has returned. This enables data privacy through function factories: variables captured by the closure are not reachable from outside code.

Common uses include callback state, curried functions, and emulating private methods. A common pitfall is capturing a loop variable in a var-declared loop, where every closure shares the same binding; using let gives each iteration its own binding.`,
  },
  {
    title: "Generics - TypeScript Handbook",
    url: "https://www.typescriptlang.org/docs/handbook/2/generics.html",
    source: "typescript",
    category: "documentation",
    contentType: "html",
    technologies: ["typescript", "generics", "types"],
    content: `Generics allow components to work over a variety of types rather than a single one, capturing the type an argument so it can be used in the signature. function identity<Type>(arg: Type): Type returns whatever type it is given.

Type parameters are declared in angle brackets and can be constrained with extends: <T extends { length: number }>. Generic interfaces and classes parameterize whole shapes, for example interface Box<T> { value: T }.

Inference usually supplies the type argument automatically; explicit arguments are needed when inference cannot determine the intent. Generic constraints preserve type safety while keeping APIs flexible, and utility types like Partial<T>, Required<T> and Record<K,V> are built on generics.`,
  },
  {
    title: "Narrowing - TypeScript Handbook",
    url: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
    source: "typescript",
    category: "documentation",
    contentType: "html",
    technologies: ["typescript", "types", "narrowing"],
    content: `Narrowing refines a union type to a more specific type using runtime checks the compiler can analyze. The typeof operator narrows primitives: typeof x === "string" restricts x to string inside the branch.

Truthiness narrowing removes falsy members like null, undefined and empty strings. instanceof narrows classes by prototype chain. The in operator checks property presence to distinguish union members, and discriminated unions use a shared literal tag field so switch statements narrow exhaustively.

Type predicates declared as value is Type let user-defined functions participate in narrowing. The never type marks unreachable branches; assigning the remaining union to never is the standard exhaustiveness check.`,
  },
  {
    title: "Indexes - MongoDB Manual",
    url: "https://www.mongodb.com/docs/manual/indexes/",
    source: "mongodb",
    category: "documentation",
    contentType: "html",
    technologies: ["mongodb", "indexes", "performance"],
    content: `Indexes support the efficient execution of queries in MongoDB. Without indexes, MongoDB must perform a collection scan, reading every document to select those matching the query. Appropriate indexes can dramatically improve query performance.

A single-field index orders values on one field; a compound index on multiple fields supports queries filtered and sorted on its prefix fields following the ESR rule: equality, sort, range. Covered queries return results entirely from the index without fetching documents.

Unique indexes enforce uniqueness; sparse and partial indexes cover subsets; TTL indexes expire documents automatically; text indexes support full-text search. Use explain("executionStats") to check whether a query uses an index or scans the collection.`,
  },
  {
    title: "Aggregation - MongoDB Manual",
    url: "https://www.mongodb.com/docs/manual/aggregation/",
    source: "mongodb",
    category: "documentation",
    contentType: "html",
    technologies: ["mongodb", "aggregation", "pipeline"],
    content: `Aggregation operations process data records and return computed results. An aggregation pipeline consists of one or more stages that process documents: each stage transforms the documents as they pass through.

Common stages include $match to filter documents, $group to group by a key and compute accumulators like $sum, $avg and $count, $project to reshape fields, $sort to order, and $lookup to join with another collection. $unwind expands array fields into separate documents.

Pipelines execute in order and early $match and $limit stages reduce the working set. The explain plan reports stage timing; indexes accelerate leading $match and $sort stages.`,
  },
  {
    title: "Redis data types | Redis Docs",
    url: "https://redis.io/docs/latest/develop/data-types/",
    source: "redis",
    category: "documentation",
    contentType: "html",
    technologies: ["redis", "cache", "data-structures"],
    content: `Redis is an in-memory data structure store used as a database, cache and message broker. Strings are the simplest type and support GET, SET, INCR and expiration via EXPIRE, making them ideal for caching.

Hashes store field-value pairs for objects (HSET, HGETALL). Lists are ordered collections (LPUSH, RPOP) used for queues. Sets are unordered collections with membership tests and set operations; Sorted sets score each member for leaderboards (ZADD, ZRANGE).

Key expiration and eviction policies turn Redis into an effective cache: SET key value EX seconds bounds lifetime, and maxmemory policies such as allkeys-lru evict least-recently-used keys under pressure.`,
  },
  {
    title: "Similarity module | Elasticsearch Guide",
    url: "https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-similarity.html",
    source: "elastic",
    category: "documentation",
    contentType: "html",
    technologies: ["elasticsearch", "bm25", "relevance"],
    content: `Elasticsearch scores matching documents with the BM25 similarity algorithm by default. BM25 combines term frequency, inverse document frequency and field-length normalization: rare terms across the corpus weigh more, and matches in shorter fields score higher.

Term frequency saturates: additional occurrences of a term increase the score less and less, controlled by the k1 parameter; b controls how strongly document length is normalized. TF/IDF historically used raw term frequency and document frequency, while BM25 adds saturation and length normalization.

Relevance tuning adjusts which fields are searched and their boosts rather than replacing BM25; a custom similarity can be configured per field through index settings when a different scoring model is required.`,
  },
  {
    title: "Mapping | Elasticsearch Guide",
    url: "https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping.html",
    source: "elastic",
    category: "documentation",
    contentType: "html",
    technologies: ["elasticsearch", "mapping", "schema"],
    content: `Mapping is the process of defining how a document and the fields it contains are stored and indexed. Each field has a data type such as text, keyword, date or numeric.

Text fields are analyzed into terms for full-text search, while keyword fields are stored as-is for filtering, sorting and aggregations. A field can have both representations using multi-fields, for example a text field with a keyword sub-field.

Dynamic mapping detects types for new fields automatically, which can cause mapping explosion in uncontrolled documents; setting dynamic to false or strict keeps the schema controlled. Analyzers control how text is tokenized; the english analyzer applies stemming so search matches word variants.`,
  },
  {
    title: "Docker overview | Docker Docs",
    url: "https://docs.docker.com/get-started/docker-overview/",
    source: "docker",
    category: "documentation",
    contentType: "html",
    technologies: ["docker", "containers", "images"],
    content: `Docker is a platform for developing, shipping and running applications in containers. A container is a runnable instance of an image: an isolated process with its own filesystem, networking and resource limits.

An image is a read-only template built from a Dockerfile: each instruction creates a layer, and unchanged layers are cached and shared between images. Containers are created with docker run; docker build produces images; docker push publishes them to a registry such as Docker Hub.

Volumes persist data outside the container's writable layer. Docker Compose defines multi-container applications declaratively. Images should be small and single-purpose; multi-stage builds compile in one stage and copy artifacts into a minimal runtime image.`,
  },
  {
    title: "Networking overview | Docker Engine",
    url: "https://docs.docker.com/engine/network/",
    source: "docker",
    category: "documentation",
    contentType: "html",
    technologies: ["docker", "networking", "containers"],
    content: `Container networking connects containers to each other and to external networks. Docker provides several network drivers: bridge networks connect containers on the same host through a private internal network; the host driver shares the host's network stack; overlay networks span multiple Docker hosts for swarm services.

User-defined bridge networks provide automatic DNS resolution: containers reach each other by name. Publishing ports with -p maps host ports to container ports; unpublised container ports are reachable only inside the network.

Containers on the default bridge communicate by IP only, so production applications should use a user-defined bridge or compose networks where service discovery by name is needed.`,
  },
  {
    title: "Built-in React Hooks | React Docs",
    url: "https://react.dev/reference/react/hooks",
    source: "react",
    category: "reference",
    contentType: "html",
    technologies: ["react", "hooks", "usestate", "useeffect"],
    content: `Hooks let function components use state and other React features. useState declares a state variable whose updates trigger re-rendering; it returns the current value and a setter.

useEffect synchronizes a component with an external system: it runs after render and re-runs when dependencies change. Effects that subscribe, fetch or mutate the DOM should clean up in the returned function. useMemo and useCallback memoize expensive values and stable callbacks.

State updates are batched and queued; the setter may receive an updater function for the next state based on the previous one. Hooks must be called at the top level of a component - never inside conditions or loops - so React can preserve state between calls.`,
  },
  {
    title: "REST API design best practices",
    url: "https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design",
    source: "microsoft",
    category: "article",
    contentType: "html",
    technologies: ["api", "rest", "design", "http"],
    content: `REST APIs are designed around resources, which are entities such as objects or collections identified by URIs. HTTP methods map to operations: GET retrieves, POST creates, PUT replaces, PATCH modifies and DELETE removes a resource.

Resource URIs should name nouns, not verbs: /orders/42 is preferred to /getOrder?id=42. Collections use plural nouns and support filtering, sorting and pagination through query parameters. Proper status codes communicate outcomes: 201 for creation, 204 for successful deletion, 400 for invalid input, 404 for missing resources.

Idempotency matters for retries: GET, PUT and DELETE should be idempotent. Versioning through a URI prefix such as /v1/ isolates breaking changes. Responses should be consistent, avoid exposing internal implementation, and never return raw stack traces.`,
  },
  {
    title: "Introduction to JSON Web Tokens",
    url: "https://jwt.io/introduction",
    source: "jwt",
    category: "article",
    contentType: "html",
    technologies: ["jwt", "authentication", "security", "tokens"],
    content: `JSON Web Token is an open standard defining a compact, self-contained way to transmit information between parties as a JSON object. The token is digitally signed so claims can be verified and trusted.

A JWT has three parts separated by dots: header, payload and signature. The header names the signing algorithm; the payload carries claims such as subject, issuer and expiration; the signature is computed over the encoded header and payload with a secret or private key.

Servers verify the signature to authenticate requests without server-side session state. Access tokens should be short-lived with refresh tokens for renewal. Sensitive data must never be placed in the payload since it is only encoded, not encrypted. Always validate the algorithm claim and never accept the 'none' algorithm.`,
  },
];
