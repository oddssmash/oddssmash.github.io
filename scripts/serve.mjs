// Tiny static server for previewing ./public on your own computer.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/util.mjs";

const dir = path.join(ROOT, process.env.DIR || "public");
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch { res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad request"); return; } // malformed %-escape or URL
  let file = path.normalize(path.join(dir, rel));
  if (file !== dir && !file.startsWith(dir + path.sep)) { res.writeHead(403).end(); return; } // a sibling folder such as public-old must not be served
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(buf);
  });
}).listen(port, () => console.log(`AGAINST ALL ODDS preview: http://localhost:${port}`));
