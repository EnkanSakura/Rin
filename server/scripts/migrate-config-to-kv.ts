/**
 * Config Migration Script
 * 
 * Migrates site settings (config) from D1 database to Workers KV.
 * Run this BEFORE deploying the KV-backed worker for the first time.
 * 
 * Usage:
 *   bun run server/scripts/migrate-config-to-kv.ts [--remote]
 * 
 * Prerequisites:
 *   - wrangler.toml must have both D1 and KV namespace bindings configured
 *   - KV namespace ID must be set in wrangler.toml
 *   - Run `bun x wrangler kv namespace create rin-server-config` first if needed
 */

import { $ } from "bun";

async function main() {
  const isRemote = process.argv.includes("--remote");
  const dbFlag = isRemote ? "--remote" : "--local";

  console.log(`🔄 Migrating config from D1 to KV (${isRemote ? "remote" : "local"})...`);

  // Read wrangler.toml to get KV namespace ID and D1 database name
  const wranglerContent = await Bun.file("wrangler.toml").text();
  const kvMatch = wranglerContent.match(/binding\s*=\s*"CONFIG_KV"\s*\n\s*id\s*=\s*"([^"]+)"/);
  const dbMatch = wranglerContent.match(/binding\s*=\s*"DB"\s*\n\s*database_name\s*=\s*"([^"]+)"/);

  if (!kvMatch) {
    console.error("❌ CONFIG_KV binding not found in wrangler.toml. Please add it first.");
    process.exit(1);
  }

  if (!dbMatch) {
    console.error("❌ DB binding not found in wrangler.toml");
    process.exit(1);
  }

  const kvNamespaceId = kvMatch[1];
  const dbName = dbMatch[1];

  console.log(`📦 KV namespace ID: ${kvNamespaceId}`);
  console.log(`🗄️  D1 database: ${dbName}`);

  // Config types to migrate
  const configTypes = ["client.config", "server.config"];

  for (const configType of configTypes) {
    console.log(`\n📤 Migrating "${configType}"...`);

    // Query D1 for config rows
    const query = `SELECT key, value FROM cache WHERE type = '${configType}' ORDER BY key`;
    const result = await $`bun x wrangler d1 execute ${dbName} ${dbFlag} --command ${query} --json`.quiet();

    let rows: Array<{ key: string; value: string }> = [];
    try {
      const stdout = result.stdout.toString().trim();
      const jsonStart = stdout.indexOf("[");
      if (jsonStart >= 0) {
        rows = JSON.parse(stdout.slice(jsonStart));
      }
    } catch (e) {
      console.warn(`  ⚠️  Could not parse D1 result for "${configType}"`);
      continue;
    }

    if (rows.length === 0) {
      console.log(`  ℹ️  No existing config found for "${configType}", skipping.`);
      continue;
    }

    // Build config object
    const configObj: Record<string, any> = {};
    for (const row of rows) {
      try {
        configObj[row.key] = JSON.parse(row.value);
      } catch {
        configObj[row.key] = row.value;
      }
    }

    // Write to KV
    const jsonStr = JSON.stringify(configObj);
    const putResult = await $`echo ${jsonStr} | bun x wrangler kv key put ${configType} --namespace-id ${kvNamespaceId}`.quiet().nothrow();

    if (putResult.exitCode === 0) {
      console.log(`  ✅ Migrated ${rows.length} config keys to KV`);
    } else {
      console.error(`  ❌ Failed to write to KV: ${putResult.stderr.toString().trim()}`);
    }
  }

  console.log("\n🎉 Migration complete!");
  console.log("Now you can deploy the KV-backed worker with: bun run deploy");
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
