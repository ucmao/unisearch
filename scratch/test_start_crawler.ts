import { startServer } from '../src/server';
import axios from 'axios';

async function test() {
  const port = 9091;
  await startServer(port);
  console.log('[Test] Server started on port', port);

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

    console.log('[Test] Sending start request...');
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

  process.exit(0);
}

test();
