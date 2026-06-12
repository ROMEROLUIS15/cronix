const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 1. Read .env.local manually to get PayPal credentials
const envPath = path.join(__dirname, '..', '.env.local');
let envContent = '';
try {
  envContent = fs.readFileSync(envPath, 'utf8');
} catch (e) {
  console.error("Error: Could not read .env.local file at:", envPath);
  process.exit(1);
}

let clientId = '';
let clientSecret = '';
let paypalEnv = 'sandbox'; // default

envContent.split(/\r?\n/).forEach(line => {
  const match = line.trim().match(/^([^#=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    let val = match[2].trim();
    // Remove quotes if present
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    if (key === 'NEXT_PUBLIC_PAYPAL_CLIENT_ID' || key === 'PAYPAL_CLIENT_ID') {
      clientId = val;
    } else if (key === 'PAYPAL_CLIENT_SECRET') {
      clientSecret = val;
    } else if (key === 'PAYPAL_ENV') {
      paypalEnv = val;
    }
  }
});

if (!clientId || !clientSecret) {
  console.error("Error: Missing NEXT_PUBLIC_PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env.local");
  process.exit(1);
}

// 2. Obtain PayPal Access Token
const apiBase = paypalEnv === 'live' 
  ? 'https://api-m.paypal.com' 
  : 'https://api-m.sandbox.paypal.com';

const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

fetch(`${apiBase}/v1/oauth2/token`, {
  method: 'POST',
  body: 'grant_type=client_credentials',
  headers: {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
})
.then(res => {
  if (!res.ok) {
    return res.text().then(err => { throw new Error(err); });
  }
  return res.json();
})
.then(data => {
  const accessToken = data.access_token;
  
  // 3. Spawn npx @paypal/mcp as a child process
  const childEnv = {
    ...process.env,
    PAYPAL_ACCESS_TOKEN: accessToken,
  };
  
  // Under Windows, npx is a cmd script, so we run it using 'npx.cmd' or cmd.exe /c npx
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  
  const child = spawn(cmd, ['@paypal/mcp', '--tools=all', `--paypal-environment=${paypalEnv}`], {
    env: childEnv,
    stdio: ['pipe', 'pipe', 'inherit'], // pipe stdin, pipe stdout, inherit stderr
    shell: true
  });
  
  // Pipe stdin of parent to child
  process.stdin.pipe(child.stdin);
  
  // Pipe stdout of child to parent
  child.stdout.pipe(process.stdout);
  
  child.on('exit', (code) => {
    process.exit(code || 0);
  });
  
  child.on('error', (err) => {
    console.error("Failed to start child process:", err);
    process.exit(1);
  });
})
.catch(err => {
  console.error("Failed to generate PayPal Access Token:", err.message);
  process.exit(1);
});
