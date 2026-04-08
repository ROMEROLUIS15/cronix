const fs = require('fs');
const path = require('path');

// Pages to scan for t() calls and their expected namespace
const pagesToScan = [
  { file: 'app/[locale]/dashboard/page.tsx', ns: 'dashboard' },
  { file: 'app/[locale]/dashboard/appointments/page.tsx', ns: 'appointments' },
  { file: 'app/[locale]/dashboard/clients/clients-view.tsx', ns: 'clients' },
  { file: 'app/[locale]/dashboard/services/page.tsx', ns: 'services' },
  { file: 'app/[locale]/dashboard/finances/page.tsx', ns: 'finances' },
  { file: 'app/[locale]/dashboard/reports/page.tsx', ns: 'reports' },
  { file: 'app/[locale]/dashboard/profile/page.tsx', ns: 'profile' },
  { file: 'app/[locale]/dashboard/settings/page.tsx', ns: 'settings' },
  { file: 'app/[locale]/dashboard/team/page.tsx', ns: 'team' },
  { file: 'app/[locale]/dashboard/setup/page.tsx', ns: 'setup' },
  { file: 'app/[locale]/dashboard/admin/pulse/page.tsx', ns: 'adminPulse' },
];

// Load reference locale
const enData = JSON.parse(fs.readFileSync('messages/en.json', 'utf8'));

/**
 * Checks if a dotted key path exists in an object
 */
function hasKey(obj, keyPath) {
  const parts = keyPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return false;
    current = current[part];
  }
  return current !== undefined;
}

let totalMissing = 0;

for (const { file, ns } of pagesToScan) {
  if (!fs.existsSync(file)) {
    console.log(`⚠️  Skip: ${file} not found`);
    continue;
  }

  const content = fs.readFileSync(file, 'utf8');
  
  // Extract all t('...') and t("...") calls
  const matches = [...content.matchAll(/t\(['"]([^'"]+)['"]\)/g)];
  const keys = [...new Set(matches.map(m => m[1]))];

  if (keys.length === 0) {
    console.log(`ℹ️  ${file} — no t() calls found`);
    continue;
  }

  const nsData = enData[ns];
  if (!nsData) {
    console.log(`❌ MISSING namespace '${ns}' in en.json (used in ${file})`);
    totalMissing++;
    continue;
  }

  const missing = keys.filter(k => !hasKey(nsData, k));
  
  if (missing.length === 0) {
    console.log(`✅ ${ns} (${file.split('/').pop()}) — all ${keys.length} keys present`);
  } else {
    console.log(`❌ ${ns} (${file.split('/').pop()}) — ${missing.length} MISSING keys:`);
    missing.forEach(k => console.log(`   → '${k}'`));
    totalMissing += missing.length;
  }
}

console.log(`\n${totalMissing === 0 ? '🎉 ALL KEYS VALID' : `⚠️  Total missing: ${totalMissing}`}`);
