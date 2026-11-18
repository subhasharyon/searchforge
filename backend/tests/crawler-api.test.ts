import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createHash } from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import { DocumentModel } from "../src/features/documents/models/document.model.js";
import { UserModel } from "../src/features/users/models/user.model.js";
import { CrawlRunModel } from "../src/features/crawler/models/crawl-run.model.js";
import { crawlRunRepository } from "../src/features/crawler/repositories/crawl-run.repository.js";
import { crawlerNetworkDeps } from "../src/features/crawler/services/crawler.service.js";
import { clearRobotsCache } from "../src/features/crawler/services/robots.service.js";
import { getCrawlSource } from "../src/features/crawler/config/crawl-sources.js";
import type {
  FetchLike,
  FetchResponseLike,
} from "../src/features/crawler/types/crawler.types.js";
import { startTestDb, stopTestDb } from "./helpers/test-db.js";

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

let accessToken: string;
const authHeader = () => ({ Authorization: `Bearer ${accessToken}` });

const textBody = (text: string): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield new TextEncoder().encode(text);
  })();

const responseOf = (
  body: string,
  contentType = "text/html",
  status = 200
): FetchResponseLike => ({
  status,
  statusText: "OK",
  headers: {
    get: (name: string) => {
      const key = name.toLowerCase();
      if (key === "content-type") {
        return contentType;
      }
      if (key === "content-length") {
        return String(body.length);
      }
      return null;
    },
  },
  // Getter: each fetch consumes the body once, so yield a fresh iterable per
  // access (a plain property would be exhausted after the first read).
  get body() {
    return textBody(body);
  },
});

const MDN = "developer.mozilla.org";

const PAGE_HTML = `<!doctype html><html><head><title>Streams Guide</title></head>
<body><nav>nav junk</nav><main><h1>Streams</h1>
<p>Streams read data continuously.</p>
<pre><code>const rs = fs.createReadStream("f");
  rs.pipe(out);</code></pre></main><footer>footer junk</footer></body></html>`;

const PAGE2_HTML = `<!doctype html><html><head><title>Buffers</title></head>
<body><main><h1>Buffers</h1><p>Raw binary data.</p></main></body></html>`;

const SITEMAP_XML = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://${MDN}/en-US/docs/streams</loc></url>
  <url><loc>https://${MDN}/en-US/docs/buffers</loc></url>
  <url><loc>https://${MDN}/en-US/private/blocked</loc></url>
</urlset>`;

const ROBOTS_TXT = `User-agent: *
Disallow: /en-US/private/
Sitemap: https://${MDN}/sitemap.xml`;

const mdnFetch = (
  overrides: Partial<Record<string, FetchResponseLike>> = {}
): FetchLike => {
  const routes: Record<string, FetchResponseLike> = {
    [`https://${MDN}/robots.txt`]: responseOf(ROBOTS_TXT, "text/plain"),
    [`https://${MDN}/sitemap.xml`]: responseOf(SITEMAP_XML, "application/xml"),
    [`https://${MDN}/en-US/docs/streams`]: responseOf(PAGE_HTML),
    [`https://${MDN}/en-US/docs/buffers`]: responseOf(PAGE2_HTML),
    ...overrides,
  };
  return async (url) => {
    const hit = routes[url];
    if (!hit) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return hit;
  };
};

const publicLookup = async () => [
  { address: "151.101.1.55", family: 4 },
];

const waitForRun = async (id: string, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await crawlRunRepository.findById(id);
    if (run && ["completed", "failed", "stopped"].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`run ${id} did not reach a terminal state`);
};

beforeAll(async () => {
  await startTestDb();
  await DocumentModel.ensureIndexes();
  await CrawlRunModel.ensureIndexes();

  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: "Crawler Tester",
      email: "crawler@example.com",
      password: "password1",
    });
  accessToken = res.body.data.tokens.accessToken;

  // Crawl mutations are admin-only; promote the test user. The authenticate
  // middleware reads role fresh from the DB, so the existing token works.
  await UserModel.updateOne(
    { email: "crawler@example.com" },
    { role: "admin" }
  );
});

beforeEach(async () => {
  await DocumentModel.deleteMany({});
  await CrawlRunModel.deleteMany({});
  clearRobotsCache();

  // Zero per-domain delay so test runs complete quickly; sources ship
  // disabled by default so re-enable mdn for the pipeline tests.
  const mdn = getCrawlSource("mdn");
  if (mdn) {
    (mdn as { crawlDelayMs: number }).crawlDelayMs = 0;
    (mdn as { enabled: boolean }).enabled = true;
  }
  crawlerNetworkDeps.fetchImpl = mdnFetch();
  crawlerNetworkDeps.lookup = publicLookup;
});

afterAll(async () => {
  crawlerNetworkDeps.fetchImpl = undefined;
  crawlerNetworkDeps.lookup = undefined;
  await stopTestDb();
});

describe("GET /api/v1/crawler/sources", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/crawler/sources");
    expect(res.status).toBe(401);
  });

  it("lists approved sources", async () => {
    const res = await request(app)
      .get("/api/v1/crawler/sources")
      .set(authHeader());
    expect(res.status).toBe(200);
    const ids = res.body.data.sources.map((s: { id: string }) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining(["mdn", "nodejs", "react", "docker", "elastic"])
    );
    for (const source of res.body.data.sources) {
      expect(source).not.toHaveProperty("sitemapUrls");
      expect(source.allowedDomains.length).toBeGreaterThan(0);
    }
  });
});

describe("POST /api/v1/crawler/runs", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/v1/crawler/runs")
      .send({ sourceId: "mdn" });
    expect(res.status).toBe(401);
  });

  it("rejects invalid payloads", async () => {
    const res = await request(app)
      .post("/api/v1/crawler/runs")
      .set(authHeader())
      .send({ sourceId: "mdn", domain: "https://evil.com" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown sources", async () => {
    const res = await request(app)
      .post("/api/v1/crawler/runs")
      .set(authHeader())
      .send({ sourceId: "nonexistent" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CRAWL_SOURCE_NOT_FOUND");
  });

  it("runs a full crawl: robots -> sitemap -> fetch -> extract -> ingest", async () => {
    const res = await request(app)
      .post("/api/v1/crawler/runs")
      .set(authHeader())
      .send({ sourceId: "mdn" });
    expect(res.status).toBe(202);
    const runId = res.body.data.run._id;

    const run = await waitForRun(runId);
    expect(run.status).toBe("completed");
    expect(run.stats.discoveredUrls).toBe(2); // private page filtered by robots
    expect(run.stats.fetchedUrls).toBe(2);
    expect(run.stats.created).toBe(2);
    expect(run.stats.failed).toBe(0);

    const docs = await DocumentModel.find({ source: "mdn" });
    expect(docs).toHaveLength(2);
    const streams = docs.find((d) => d.url.includes("streams"));
    expect(streams?.title).toBe("Streams Guide");
    expect(streams?.contentType).toBe("markdown");
    expect(streams?.category).toBe("documentation");
    expect(streams?.technologies).toContain("javascript");
    expect(streams?.content).toContain("rs.pipe(out)");
    expect(streams?.content).not.toContain("nav junk");
    expect(streams?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(streams?.contentHash).toBe(sha256(streams?.content ?? ""));
  });

  it("reports unchanged documents on re-crawl", async () => {
    await request(app)
      .post("/api/v1/crawler/runs")
      .set(authHeader())
      .send({ sourceId: "mdn" });
    const first = await waitForRun(
      (await crawlRunRepository.list({ limit: 1 }))[0]!._id.toString()
    );
    expect(first.stats.created).toBe(2);

    const second = await request(app)
      .post("/api/v1/crawler/runs")
      .set(authHeader())
      .send({ sourceId: "mdn" });
    const run2 = await waitForRun(second.body.data.run._id);
    expect(run2.status).toBe("completed");
    expect(run2.stats.unchanged).toBe(2);
    expect(run2.stats.created).toBe(0);
    expect(await DocumentModel.countDocuments()).toBe(2);
  });

  it("rejects a second concurrent run for the same source", async () => {
    // Hold fetches open so the first run stays active deterministically.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    crawlerNetworkDeps.fetchImpl = async (url) => {
      await gate;
      return mdnFetch()(url);
    };

    const first = await request(app)
      .post("/api/v1/crawler/runs")
      .set(authHeader())
      .send({ sourceId: "mdn" });
    expect(first.status).toBe(202);

    const second = await request(app)
      .post("/api/v1/crawler/runs")
      .set(authHeader())
      .send({ sourceId: "mdn" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CRAWL_ALREADY_RUNNING");

    release();
    await waitForRun(first.body.data.run._id);
    crawlerNetworkDeps.fetchImpl = mdnFetch();
  });

  it("counts fetch failures without crashing the run", async () => {
    crawlerNetworkDeps.fetchImpl = mdnFetch({
      [`https://${MDN}/en-US/docs/buffers`]: responseOf(
        "nope",
        "text/plain",
        404
      ),
    });

    const res = await request(app)
      .post("/api/v1/crawler/runs")
      .set(authHeader())
      .send({ sourceId: "mdn" });
    const run = await waitForRun(res.body.data.run._id);

    expect(run.status).toBe("completed");
    expect(run.stats.created).toBe(1);
    expect(run.stats.failed).toBe(1);
  });
});

describe("GET /api/v1/crawler/runs", () => {
  it("lists runs newest first and respects limit", async () => {
    await crawlRunRepository.create({
      sourceId: "mdn",
      requestedBy: "test",
      status: "completed",
      stats: {
        discoveredUrls: 0, queuedUrls: 0, processedUrls: 0, fetchedUrls: 0,
        created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0,
      },
    });

    const res = await request(app)
      .get("/api/v1/crawler/runs")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.runs.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.runs[0].sourceId).toBe("mdn");
  });
});

describe("GET /api/v1/crawler/runs/:id", () => {
  it("returns a run", async () => {
    const run = await crawlRunRepository.create({
      sourceId: "mdn",
      requestedBy: "test",
      status: "completed",
      stats: {
        discoveredUrls: 0, queuedUrls: 0, processedUrls: 0, fetchedUrls: 0,
        created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0,
      },
    });

    const res = await request(app)
      .get(`/api/v1/crawler/runs/${run._id}`)
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.run.status).toBe("completed");
  });

  it("400s on malformed id and 404s on missing run", async () => {
    const bad = await request(app)
      .get("/api/v1/crawler/runs/not-an-id")
      .set(authHeader());
    expect(bad.status).toBe(400);

    const missing = await request(app)
      .get("/api/v1/crawler/runs/65f1a2b3c4d5e6f7a8b9c0d1")
      .set(authHeader());
    expect(missing.status).toBe(404);
  });
});

describe("POST /api/v1/crawler/runs/:id/stop", () => {
  it("stops a stale running run", async () => {
    const run = await crawlRunRepository.create({
      sourceId: "mdn",
      requestedBy: "test",
      status: "running",
      stats: {
        discoveredUrls: 0, queuedUrls: 0, processedUrls: 0, fetchedUrls: 0,
        created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0,
      },
    });

    const res = await request(app)
      .post(`/api/v1/crawler/runs/${run._id}/stop`)
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.run.status).toBe("stopped");
    expect(res.body.data.run.stopRequested).toBe(true);
  });

  it("returns 409 when the run is not active", async () => {
    const run = await crawlRunRepository.create({
      sourceId: "mdn",
      requestedBy: "test",
      status: "completed",
      stats: {
        discoveredUrls: 0, queuedUrls: 0, processedUrls: 0, fetchedUrls: 0,
        created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0,
      },
    });

    const res = await request(app)
      .post(`/api/v1/crawler/runs/${run._id}/stop`)
      .set(authHeader());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CRAWL_RUN_NOT_ACTIVE");
  });
});

describe("crawl authorization", () => {
  it("forbids non-admin users from starting or stopping crawls", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Regular User",
        email: "regular@example.com",
        password: "password1",
      });
    const userToken = res.body.data.tokens.accessToken;
    const userAuth = { Authorization: `Bearer ${userToken}` };

    const start = await request(app)
      .post("/api/v1/crawler/runs")
      .set(userAuth)
      .send({ sourceId: "mdn" });
    expect(start.status).toBe(403);
    expect(start.body.error.code).toBe("FORBIDDEN");

    const stop = await request(app)
      .post("/api/v1/crawler/runs/65f1a2b3c4d5e6f7a8b9c0d1/stop")
      .set(userAuth);
    expect(stop.status).toBe(403);

    // Read endpoints remain available to any authenticated user.
    const sources = await request(app)
      .get("/api/v1/crawler/sources")
      .set(userAuth);
    expect(sources.status).toBe(200);
  });
});

describe("crawler service edge cases", () => {
  it("rejects disabled sources", async () => {
    const mdn = getCrawlSource("mdn");
    if (!mdn) throw new Error("mdn source missing");
    const original = mdn.enabled;
    (mdn as { enabled: boolean }).enabled = false;
    try {
      const res = await request(app)
        .post("/api/v1/crawler/runs")
        .set(authHeader())
        .send({ sourceId: "mdn" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CRAWL_SOURCE_DISABLED");
    } finally {
      (mdn as { enabled: boolean }).enabled = original;
    }
  });
});
