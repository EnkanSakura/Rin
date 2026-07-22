#!/usr/bin/env bun
/**
 * Local Data Viewer
 * 
 * Starts a web-based dashboard to inspect local D1 and KV data
 * during development. Run alongside `bun run dev`.
 * 
 * Usage: bun run scripts/data-viewer.ts
 * Then open http://localhost:3030 in your browser.
 */

import { Database } from "bun:sqlite";
import { readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const STATE_DIR = ".wrangler/state/v3";
const VIEWER_PORT = 3030;

// ── Locate the local D1 SQLite file ──────────────────────────────
function findD1Database(): string | null {
  const d1Dir = join(STATE_DIR, "d1", "miniflare-D1DatabaseObject");
  if (!existsSync(d1Dir)) return null;
  const files = readdirSync(d1Dir).filter((f) => f.endsWith(".sqlite") && !f.endsWith("-wal") && !f.endsWith("-shm"));
  return files.length > 0 ? join(d1Dir, files[0]) : null;
}

// ── Locate the local KV SQLite file ──────────────────────────────
function findKVDatabase(): string | null {
  const kvDir = join(STATE_DIR, "kv", "miniflare-KVNamespaceObject");
  if (!existsSync(kvDir)) return null;
  const files = readdirSync(kvDir).filter((f) => f.endsWith(".sqlite") && !f.endsWith("-wal") && !f.endsWith("-shm"));
  return files.length > 0 ? join(kvDir, files[0]) : null;
}

// ── HTML template ────────────────────────────────────────────────
function htmlPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rin 本地数据浏览器</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f7; color: #1d1d1f; padding: 20px; }
h1 { font-size: 1.5rem; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
h1 small { font-size: 0.85rem; font-weight: 400; color: #86868b; }

.tabs { display: flex; gap: 0; border-bottom: 1px solid #d2d2d7; margin-bottom: 16px; }
.tab-btn { padding: 10px 20px; border: none; background: transparent; cursor: pointer; font-size: 0.9rem; color: #86868b; border-bottom: 2px solid transparent; transition: all .15s; }
.tab-btn:hover { color: #1d1d1f; }
.tab-btn.active { color: #1d1d1f; border-bottom-color: #0071e3; }

.tab-panel { display: none; }
.tab-panel.active { display: block; }

.query-area { margin-bottom: 16px; }
.query-area textarea { width: 100%; min-height: 100px; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 0.85rem; padding: 12px; border: 1px solid #d2d2d7; border-radius: 8px; resize: vertical; background: #fff; }
.query-area .actions { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.query-area button { padding: 8px 20px; border: none; border-radius: 20px; background: #0071e3; color: #fff; font-size: 0.85rem; cursor: pointer; }
.query-area button:hover { background: #0077ed; }
.query-area button.secondary { background: #e8e8ed; color: #1d1d1f; }
.query-area button.secondary:hover { background: #d2d2d7; }
.query-area .status { font-size: 0.8rem; color: #86868b; }

.results { overflow-x: auto; background: #fff; border-radius: 8px; border: 1px solid #d2d2d7; }
.results table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.results th { background: #f5f5f7; text-align: left; padding: 10px 12px; font-weight: 600; border-bottom: 1px solid #d2d2d7; white-space: nowrap; }
.results td { padding: 8px 12px; border-bottom: 1px solid #eee; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 0.8rem; }
.results tr:hover td { background: #fafafa; }
.results .empty { padding: 40px 20px; text-align: center; color: #86868b; }

pre.json-view { background: #1d1d1f; color: #f5f5f7; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 0.8rem; line-height: 1.5; margin-top: 8px; }

.db-status { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 0.85rem; }
.db-status.ok { background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; }
.db-status.warn { background: #fff3e0; color: #e65100; border: 1px solid #ffe0b2; }
.db-status.err { background: #ffebee; color: #c62828; border: 1px solid #ffcdd2; }

.shortcuts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.shortcuts button { padding: 4px 12px; border: 1px solid #d2d2d7; border-radius: 14px; background: #fff; cursor: pointer; font-size: 0.8rem; color: #1d1d1f; }
.shortcuts button:hover { background: #f5f5f7; border-color: #0071e3; color: #0071e3; }

.kv-key { padding: 10px 12px; border: 1px solid #d2d2d7; border-radius: 8px; margin-bottom: 8px; background: #fff; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
.kv-key:hover { border-color: #0071e3; }
.kv-key .key-name { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-weight: 600; font-size: 0.9rem; }
.kv-key .key-action { color: #0071e3; font-size: 0.8rem; }
.kv-value { background: #1d1d1f; color: #f5f5f7; padding: 16px; border-radius: 8px; margin-bottom: 12px; overflow-x: auto; font-size: 0.8rem; display: none; }
.kv-value.open { display: block; }
</style>
</head>
<body>
<h1>🔍 Rin 本地数据浏览器 <small>— .wrangler/state/v3</small></h1>

<div class="tabs" id="tabs">
  <button class="tab-btn active" data-tab="d1">🗄️ D1 数据库</button>
  <button class="tab-btn" data-tab="kv">🔑 KV 存储</button>
</div>

<!-- D1 Tab -->
<div class="tab-panel active" id="panel-d1">
  <div id="d1-status"></div>

  <div class="shortcuts" id="d1-shortcuts">
    <button data-sql="SELECT name FROM sqlite_master WHERE type='table'">📋 所有表</button>
    <button data-sql="SELECT * FROM feeds ORDER BY id DESC LIMIT 20">📝 文章</button>
    <button data-sql="SELECT * FROM users">👤 用户</button>
    <button data-sql="SELECT * FROM comments ORDER BY id DESC LIMIT 20">💬 评论</button>
    <button data-sql="SELECT * FROM friends">🔗 友链</button>
    <button data-sql="SELECT * FROM moments ORDER BY id DESC LIMIT 20">📌 动态</button>
    <button data-sql="SELECT * FROM cache LIMIT 30">🗃️ 缓存</button>
    <button data-sql="SELECT * FROM visit_stats">📊 访问统计</button>
    <button data-sql="SELECT * FROM hashtags">🏷️ 标签</button>
  </div>

  <div class="query-area">
    <textarea id="d1-sql" placeholder="输入 SQL 查询语句...">SELECT name FROM sqlite_master WHERE type='table'</textarea>
    <div class="actions">
      <button id="d1-run">▶ 运行</button>
      <button id="d1-run-all" class="secondary">▶▶ 运行全部</button>
      <span class="status" id="d1-status-text"></span>
    </div>
  </div>
  <div class="results" id="d1-results"></div>
</div>

<!-- KV Tab -->
<div class="tab-panel" id="panel-kv">
  <div id="kv-status"></div>

  <div class="query-area">
    <div class="actions" style="margin-bottom:12px">
      <button id="kv-list">📋 列出所有键</button>
    </div>
  </div>
  <div id="kv-list-result"></div>
  <div id="kv-value-display"></div>
</div>

<script>
// ── Tab switching ──
document.getElementById('tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
});

// ── D1 helpers ──
async function runD1Query(sql, runAll = false) {
  const status = document.getElementById('d1-status-text');
  const results = document.getElementById('d1-results');
  status.textContent = '⏳ 查询中...';
  results.innerHTML = '';

  try {
    const endpoint = runAll ? '/api/d1/run-all' : '/api/d1/query';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    if (!res.ok) {
      const err = await res.text();
      status.textContent = '❌ ' + err;
      results.innerHTML = '<div class="empty">查询失败</div>';
      return;
    }
    const data = await res.json();
    status.textContent = '✅ 返回 ' + data.rows.length + ' 行 (' + data.duration + 'ms)';
    renderTable(results, data.columns, data.rows);
  } catch (e) {
    status.textContent = '❌ ' + e.message;
    results.innerHTML = '<div class="empty">查询失败</div>';
  }
}

function renderTable(container, columns, rows) {
  if (!columns || columns.length === 0 || rows.length === 0) {
    container.innerHTML = '<div class="empty">(空结果)</div>';
    return;
  }

  let html = '<table><thead><tr>';
  for (const col of columns) html += '<th>' + escapeHtml(String(col)) + '</th>';
  html += '</tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr>';
    for (const col of columns) {
      const val = row[col];
      html += '<td title="' + escapeHtml(String(val ?? 'NULL')) + '">' + escapeHtml(String(val ?? 'NULL')) + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// D1 tab - run button
document.getElementById('d1-run').addEventListener('click', () => {
  const sql = document.getElementById('d1-sql').value.trim();
  if (sql) runD1Query(sql, false);
});

document.getElementById('d1-run-all').addEventListener('click', () => {
  const sql = document.getElementById('d1-sql').value.trim();
  if (sql) runD1Query(sql, true);
});

// D1 shortcuts
document.getElementById('d1-shortcuts').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.getElementById('d1-sql').value = btn.dataset.sql;
  runD1Query(btn.dataset.sql, false);
});

// Auto-run initial query
setTimeout(() => runD1Query("SELECT name FROM sqlite_master WHERE type='table'", false), 200);

// ── KV helpers ──
async function loadKVList() {
  const status = document.getElementById('kv-status');
  const result = document.getElementById('kv-list-result');
  const valueDisplay = document.getElementById('kv-value-display');
  valueDisplay.innerHTML = '';
  status.textContent = '⏳ 加载中...';
  result.innerHTML = '';

  try {
    const res = await fetch('/api/kv/list');
    if (!res.ok) {
      status.textContent = '❌ KV 不可用（可能未运行 wrangler dev）';
      result.innerHTML = '<div class="empty">KV namespace 未绑定或 worker 未运行</div>';
      return;
    }
    const data = await res.json();
    status.textContent = '✅ 共 ' + data.keys.length + ' 个键';
    if (data.keys.length === 0) {
      result.innerHTML = '<div class="empty">(空)</div>';
      return;
    }
    let html = '';
    for (const key of data.keys) {
      html += '<div class="kv-key" data-key="' + escapeHtml(key.name) + '">';
      html += '<span class="key-name">' + escapeHtml(key.name) + '</span>';
      html += '<span class="key-action">点击查看 →</span>';
      html += '</div>';
    }
    result.innerHTML = html;

    // Click to view value
    result.querySelectorAll('.kv-key').forEach(el => {
      el.addEventListener('click', async () => {
        const key = el.dataset.key;
        const valRes = await fetch('/api/kv/get?key=' + encodeURIComponent(key));
        if (valRes.ok) {
          const valData = await valRes.json();
          valueDisplay.innerHTML = '<h3 style="margin-bottom:8px;font-size:0.95rem">' + escapeHtml(key) + '</h3>';
          valueDisplay.innerHTML += '<pre class="json-view">' + escapeHtml(JSON.stringify(valData.value, null, 2)) + '</pre>';
        }
      });
    });
  } catch (e) {
    status.textContent = '❌ ' + e.message;
    result.innerHTML = '<div class="empty">加载失败</div>';
  }
}

document.getElementById('kv-list').addEventListener('click', loadKVList);
setTimeout(() => loadKVList(), 500);
</script>
</body>
</html>`;
}

// ── HTTP Server ──────────────────────────────────────────────────
const server = Bun.serve({
  port: VIEWER_PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Serve HTML page
    if (path === "/") {
      return new Response(htmlPage(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // ── D1 API ──
    if (path === "/api/d1/query" || path === "/api/d1/run-all") {
      const d1Path = findD1Database();
      if (!d1Path) {
        return new Response(JSON.stringify({ error: "D1 database not found. Run bun run dev first." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const sql = body.sql?.trim();
      if (!sql) {
        return new Response(JSON.stringify({ error: "SQL query is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const db = new Database(d1Path, { readonly: true });
        const start = performance.now();

        let columns: string[] = [];
        let rows: Record<string, unknown>[] = [];

        if (path === "/api/d1/run-all") {
          // Execute multiple semicolon-separated statements
          const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
          for (const stmt of statements) {
            try {
              const result = db.query(stmt).all();
              if (Array.isArray(result) && result.length > 0) {
                columns = Object.keys(result[0]);
                rows = result as Record<string, unknown>[];
              }
            } catch (e) {
              // Skip non-query statements
            }
          }
        } else {
          const result = db.query(sql).all();
          if (Array.isArray(result) && result.length > 0) {
            columns = Object.keys(result[0]);
            rows = result as Record<string, unknown>[];
          }
        }

        const duration = (performance.now() - start).toFixed(1);
        db.close();

        return new Response(JSON.stringify({ columns, rows, duration }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // ── KV API ──
    // Helper to read KV value from blob by blob_id
    function readKVBlob(blobId: string): string | null {
      try {
        const blobPath = join(STATE_DIR, "kv", "local", "blobs", blobId);
        if (!existsSync(blobPath)) return null;
        return readFileSync(blobPath, "utf-8");
      } catch {
        return null;
      }
    }

    if (path === "/api/kv/list") {
      const kvPath = findKVDatabase();
      if (!kvPath) {
        return new Response(JSON.stringify({ error: "KV not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const db = new Database(kvPath, { readonly: true });
        const rows = db.query("SELECT key, blob_id, expiration, metadata FROM _mf_entries ORDER BY key").all() as Array<{
          key: string;
          blob_id: string;
          expiration: number | null;
          metadata: string | null;
        }>;
        db.close();

        const keys = rows.map((r) => ({
          name: r.key,
          blob_id: r.blob_id,
          expiration: r.expiration,
          value_preview: (() => {
            const raw = readKVBlob(r.blob_id);
            if (!raw) return null;
            return raw.length > 100 ? raw.substring(0, 100) + "…" : raw;
          })(),
        }));

        return new Response(JSON.stringify({ keys }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (path === "/api/kv/get") {
      const key = url.searchParams.get("key");
      if (!key) {
        return new Response(JSON.stringify({ error: "key parameter required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const kvPath = findKVDatabase();
      if (!kvPath) {
        return new Response(JSON.stringify({ error: "KV not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const db = new Database(kvPath, { readonly: true });
        const row = db.query("SELECT blob_id FROM _mf_entries WHERE key = ?").get(key) as {
          blob_id: string;
        } | null;
        db.close();

        let value: unknown = null;
        if (row) {
          const raw = readKVBlob(row.blob_id);
          if (raw !== null) {
            try {
              value = JSON.parse(raw);
            } catch {
              value = raw;
            }
          }
        }

        return new Response(JSON.stringify({ key, value }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

// ── Status ────────────────────────────────────────────────────────
const d1Path = findD1Database();
const kvPath = findKVDatabase();

console.log("\n" + "=".repeat(50));
console.log("🔍  Rin 本地数据浏览器");
console.log("=".repeat(50));
console.log(`📡  打开 http://localhost:${VIEWER_PORT}`);
console.log("");
console.log(`🗄️  D1 数据库: ${d1Path ? "✅ " + d1Path.split("miniflare-").pop() : "❌ 未找到 — 请先运行 bun run dev"}`);
console.log(`🔑  KV 存储:   ${kvPath ? "✅ " + kvPath.split("miniflare-").pop() : "❌ 未找到 — 请先运行 bun run dev"}`);
console.log("");
console.log("💡  提示：确保 bun run dev 已在另一个终端中运行");
console.log("💡  按 Ctrl+C 停止此服务\n");
