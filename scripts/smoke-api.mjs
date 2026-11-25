#!/usr/bin/env node
/**
 * End-to-end API smoke test.
 * Usage:
 *   BASE_URL=http://127.0.0.1:8787 node scripts/smoke-api.mjs
 *
 * Public surface checks only; admin access requires GitHub OAuth.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
let passed = 0;

function ok(label) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body !== undefined && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(BASE + path, { ...options, headers, body, redirect: "manual" });
  const text = await response.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep text
  }
  return { status: response.status, data, headers: response.headers };
}

async function publicFlow() {
  console.log("\nPublic surface");
  const health = await request("/api/health");
  assert(health.status === 200 && health.data.ok, "health endpoint failed");
  ok("health endpoint");

  const nav = await request("/api/nav");
  assert(nav.status === 200, "nav endpoint failed");
  assert(Array.isArray(nav.data.categories) && Array.isArray(nav.data.sites), "nav shape is invalid");
  assert(Array.isArray(nav.data.pages), "nav pages are missing");
  assert(nav.data.sites.length > 0, "no sites returned; run npm run db:seed");
  ok(`nav payload (${nav.data.sites.length} sites, ${nav.data.categories.length} root categories)`);

  const detailSite = nav.data.sites.find((site) => site.detailEnabled);
  assert(detailSite, "no detail-enabled site found");
  const detail = await request(`/api/sites/${detailSite.slug}`);
  assert(detail.status === 200 && detail.data.id === detailSite.id, "site detail endpoint failed");
  ok("site detail page payload");

  const comments = await request(`/api/sites/${detailSite.slug}/comments?page=1&pageSize=5`);
  assert(comments.status === 200 && Array.isArray(comments.data.comments), "comments list failed");
  ok("comments list");

  const captcha = await request("/api/captcha");
  assert(captcha.status === 200 && captcha.data.question && captcha.data.token, "captcha failed");
  ok("math captcha challenge");

  const sitemap = await request("/sitemap.xml");
  assert(sitemap.status === 200 && String(sitemap.data).includes("<urlset"), "sitemap failed");
  ok("sitemap");

  const home = await request("/");
  assert(home.status === 200 && String(home.data).includes("<div id=\"app\">"), "frontend shell failed");
  ok("public app shell");

  const adminShell = await request("/admin");
  assert(adminShell.status === 200 && String(adminShell.data).includes("<div id=\"root\">"), "admin app shell failed");
  assert(String(adminShell.data).includes("/assets/admin-"), "admin entry bundle missing");
  ok("admin app shell");

  const demoPage = nav.data.pages.find((item) => item.slug === "friends");
  if (demoPage) {
    const page = await request("/api/pages/friends");
    assert(page.status === 200 && page.data.title, "standalone page endpoint failed");
    ok("standalone page payload");
  }
}



try {
  console.log(`iNav API smoke test → ${BASE}`);
  await publicFlow();
  console.log(`\nAll checks passed (${passed}).`);
} catch (error) {
  console.error(`\n✗ Smoke test failed: ${error.message}`);
  process.exitCode = 1;
}
