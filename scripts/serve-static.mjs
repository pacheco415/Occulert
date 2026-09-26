import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const root = await realpath(process.cwd());
const insideRoot = file => {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !isAbsolute(path);
};
const port = Number(process.env.PORT || 4173);
const vercel = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
const globalHeaders = Object.fromEntries(
  (vercel.headers?.find((rule) => rule.source === "/(.*)")?.headers || []).map(({ key, value }) => [key, value]),
);
const externalRewrites = new Map(
  (vercel.rewrites || [])
    .filter(({ source, destination }) => typeof source === "string" && /^https:\/\//.test(destination || ""))
    .map(({ source, destination }) => [source, destination]),
);
const types = {
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
};

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    const external = externalRewrites.get(pathname);
    if (external) {
      const upstream = await fetch(external);
      if (!upstream.ok) throw new Error("rewrite_failed");
      for (const [name, value] of Object.entries(globalHeaders)) res.setHeader(name, value);
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/javascript; charset=utf-8");
      res.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const candidate = resolve(root, requested);
    if (!insideRoot(candidate)) throw new Error("invalid_path");
    const file = await realpath(candidate);
    if (!insideRoot(file)) throw new Error("invalid_path");
    if (!(await stat(file)).isFile()) throw new Error("not_found");
    for (const [name, value] of Object.entries(globalHeaders)) res.setHeader(name, value);
    // Apply the same ordered static-header rules used by this site's Vercel config.
    for (const rule of vercel.headers || []) {
      if (new RegExp(`^${rule.source}$`).test(pathname)) {
        for (const { key, value } of rule.headers) res.setHeader(key, value);
      }
    }
    res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Occulert test server listening on ${port}`);
});
