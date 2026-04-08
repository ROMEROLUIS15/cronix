const fs = require('fs');
const path = require('path');

const locales = ['es', 'en', 'pt', 'fr', 'it', 'de'];
const namespaces = ['settings', 'team', 'setup', 'adminPulse'];
const messagesPath = path.join(__dirname, 'messages');

let allTestsPassed = true;
let logs = [];

function log(msg) {
  logs.push(msg);
}

// 1. Check if all files exist
for (const locale of locales) {
  const filePath = path.join(messagesPath, `${locale}.json`);
  if (!fs.existsSync(filePath)) {
    log(`❌ ERROR: Missing translation file ${locale}.json`);
    allTestsPassed = false;
    continue;
  }
}

// Read English as reference
const enData = JSON.parse(fs.readFileSync(path.join(messagesPath, 'en.json'), 'utf-8'));

for (const ns of namespaces) {
  if (!enData[ns]) {
     log(`❌ ERROR: Missing namespace '${ns}' in en.json`);
     allTestsPassed = false;
     continue;
  }
  
  const refKeys = Object.keys(enData[ns]).sort();
  
  for (const locale of locales) {
    if (locale === 'en') continue;
    
    const localePath = path.join(messagesPath, `${locale}.json`);
    const localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
    
    if (!localeData[ns]) {
      log(`❌ ERROR: Namespace '${ns}' is missing in ${locale}.json`);
      allTestsPassed = false;
      continue;
    }
    
    const targetKeys = Object.keys(localeData[ns]).sort();
    
    // Check missing keys
    const missingKeys = refKeys.filter(k => !targetKeys.includes(k));
    if (missingKeys.length > 0) {
      log(`❌ ERROR: ${locale}.json is missing keys in '${ns}': ${missingKeys.join(', ')}`);
      allTestsPassed = false;
    }
  }
}

if (allTestsPassed) {
  log(`✅ ALL TESTS PASSED: All ${locales.length} languages contain identical translation keys for namespaces: ${namespaces.join(', ')}.`);
}

console.log(logs.join('\n'));
