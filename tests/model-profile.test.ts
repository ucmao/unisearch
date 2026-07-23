import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isRetryableModelError, ModelService } from '../src/server/services/ModelService';

test('model retries only transient failures', () => {
  for (const status of [408, 425, 429, 500, 502, 503]) {
    assert.equal(isRetryableModelError({ response: { status } }), true, `${status} should retry`);
  }
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isRetryableModelError({ response: { status } }), false, `${status} should stop immediately`);
  }
  assert.equal(isRetryableModelError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isRetryableModelError({ code: 'ENOTFOUND' }), true);
});

test('model providers keep isolated credentials and clearing one key does not affect another', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-profile-'));
  const configPath = path.join(directory, 'model-profile.json');

  try {
    const service = new ModelService(configPath);
    assert.equal(service.getProfile(false).provider, 'minimax');
    assert.equal(service.getProfile(false).apiKeyConfigured, false);

    service.saveProfile({ provider: 'minimax', apiKey: 'minimax-secret' });
    service.saveProfile({ provider: 'deepseek' });

    let profiles = service.getProfiles();
    assert.equal(profiles.activeProvider, 'deepseek');
    assert.equal(profiles.profiles.find((profile) => profile.provider === 'minimax')?.apiKeyConfigured, true);
    assert.equal(profiles.profiles.find((profile) => profile.provider === 'deepseek')?.apiKeyConfigured, false);

    service.saveProfile({ provider: 'deepseek', apiKey: 'deepseek-secret' });
    service.saveProfile({ provider: 'deepseek', clearApiKey: true });

    profiles = service.getProfiles();
    assert.equal(profiles.profiles.find((profile) => profile.provider === 'minimax')?.apiKeyConfigured, true);
    assert.equal(profiles.profiles.find((profile) => profile.provider === 'deepseek')?.apiKeyConfigured, false);

    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(stored.version, 2);
    assert.equal(stored.activeProvider, 'deepseek');
    assert.equal('apiKeyEncrypted' in stored, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy single-profile files are ignored instead of migrated', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-model-profile-'));
  const configPath = path.join(directory, 'model-profile.json');

  try {
    fs.writeFileSync(configPath, JSON.stringify({
      provider: 'deepseek',
      baseUrl: 'https://legacy.example.com',
      model: 'legacy-model',
      apiKeyEncrypted: 'legacy-key',
    }));

    const service = new ModelService(configPath);
    const profiles = service.getProfiles();
    assert.equal(profiles.activeProvider, 'minimax');
    assert.equal(profiles.profiles.every((profile) => !profile.apiKeyConfigured), true);
    assert.equal(profiles.profiles.find((profile) => profile.provider === 'deepseek')?.baseUrl, 'https://api.deepseek.com');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
