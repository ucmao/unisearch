import { spawn } from 'child_process';
import axios from 'axios';

async function main() {
  console.log('[Test] Spawning electron dev process...');
  const child = spawn('npx', ['electron', '.'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development' },
  });

  child.stdout.on('data', (data) => {
    const str = data.toString();
    console.log('[Electron STDOUT]', str);
  });

  let errorOutput = '';
  child.stderr.on('data', (data) => {
    const str = data.toString();
    errorOutput += str;
    console.error('[Electron STDERR]', str);
  });

  // Wait 6 seconds for electron to boot and start Fastify
  console.log('[Test] Waiting for server to boot...');
  await new Promise((r) => setTimeout(r, 6000));

  // Find port. In our main/index.ts, we find a free port starting at 8080.
  // We can try port 8080 first.
  let port = 8080;
  console.log('[Test] Sending test start request to port', port);

  try {
    const payload = {
      platform: 'xhs',
      login_type: 'qrcode',
      crawler_type: 'search',
      keywords: 'test',
      start_page: 1,
      enable_comments: false,
      enable_sub_comments: false,
      cookies: '',
      headless: true,
      loop_execution: false
    };

    const res = await axios.post(`http://127.0.0.1:${port}/api/crawler/start`, payload);
    console.log('[Test] Response status:', res.status);
    console.log('[Test] Response body:', res.data);
  } catch (err: any) {
    console.error('[Test] Request failed!');
    if (err.response) {
      console.error('[Test] Error Status:', err.response.status);
      console.error('[Test] Error Body:', err.response.data);
    } else {
      console.error('[Test] Error message:', err.message);
    }
  }

  // Keep running for 2 more seconds to print any async stack trace
  await new Promise((r) => setTimeout(r, 2000));
  console.log('[Test] Killing electron...');
  child.kill('SIGKILL');
}

main().catch(console.error);
