// Test script to validate Paper Map JSON using the same logic as the web app
const fs = require('fs');

function cleanArchiveKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
}

function validateArchivePayload(payload, expectedVersion) {
  if (!payload || Number(payload.archiveVersion) !== expectedVersion || !Array.isArray(payload.papers)) {
    throw new Error("Paper Map archive metadata has an unsupported structure.");
  }
  if (!Array.isArray(payload.edges) || !Array.isArray(payload.topics) || !payload.meta || typeof payload.meta !== "object") {
    throw new Error("Paper Map archive metadata is missing database collections.");
  }

  const keySet = new Set();
  for (const item of payload.papers) {
    const key = cleanArchiveKey(item?.key);
    if (!key || key !== item.key || !item.paper || typeof item.paper !== "object") {
      console.error(`FAIL: Paper with key "${item.key}" fails validation:`);
      console.error(`  cleanArchiveKey("${item.key}") = "${cleanArchiveKey(item.key)}"`);
      console.error(`  key === cleanArchiveKey(key): ${key === item.key}`);
      console.error(`  has paper: ${!!item.paper}`);
      console.error(`  paper is object: ${typeof item.paper === "object"}`);
      throw new Error("Paper Map archive contains an invalid citation key.");
    }
    if (keySet.has(key.toLowerCase())) {
      throw new Error("Paper Map archive contains duplicate citation keys.");
    }
    keySet.add(key.toLowerCase());
  }
  
  return payload;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node test_paper_map_validation.js <json-file>");
    process.exit(1);
  }
  
  const jsonFile = args[0];
  try {
    const content = fs.readFileSync(jsonFile, 'utf8');
    const payload = JSON.parse(content);
    
    console.log(`Testing ${jsonFile}...`);
    console.log(`Archive version: ${payload.archiveVersion}`);
    console.log(`Schema version: ${payload.schemaVersion}`);
    console.log(`Number of papers: ${payload.papers?.length || 0}`);
    console.log(`Has meta: ${!!payload.meta}`);
    console.log(`Has edges: ${Array.isArray(payload.edges)}`);
    console.log(`Has topics: ${Array.isArray(payload.topics)}`);
    
    // Test with both supported versions
    const version = Number(payload?.archiveVersion);
    if (![1, 2, 3].includes(version)) {
      console.error(`Unsupported archive version: ${version}`);
      process.exit(1);
    }
    
    validateArchivePayload(payload, version);
    console.log("✅ JSON validation passed!");
    
  } catch (error) {
    console.error(`❌ Validation failed: ${error.message}`);
    process.exit(1);
  }
}

main();