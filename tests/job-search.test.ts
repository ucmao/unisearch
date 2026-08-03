import assert from 'node:assert/strict';
import test from 'node:test';
import { buildJobSearchUrl, jobItemLimit, resolveJobLocation } from '../src/crawler/platforms/jobSearch';
import { listConnectorManifests } from '../src/connectors/registry';

test('job search resolves common Chinese city names into platform codes', () => {
  assert.equal(resolveJobLocation('boss', '上海市'), '101020100');
  assert.equal(resolveJobLocation('zhaopin', '北京'), '530');
  assert.equal(resolveJobLocation('job51', '深圳'), '040000');
  assert.equal(resolveJobLocation('liepin', '杭州'), '070020');
  assert.equal(resolveJobLocation('boss', '101190400'), '101190400');
});

test('job search URLs carry both keyword and location through pagination', () => {
  assert.match(buildJobSearchUrl('boss', '数据分析', 4, '上海'), /query=%E6%95%B0%E6%8D%AE%E5%88%86%E6%9E%90/);
  assert.match(buildJobSearchUrl('boss', '数据分析', 4, '上海'), /city=101020100/);
  assert.match(buildJobSearchUrl('zhaopin', 'Java', 2, '北京'), /\/sou\/jl530\/kwjava\/p2$/);
  assert.match(buildJobSearchUrl('job51', '产品经理', 3, '深圳'), /jobArea=040000/);
  assert.match(buildJobSearchUrl('liepin', '算法', 3, '杭州'), /currentPage=2/);
  assert.match(buildJobSearchUrl('liepin', '算法', 3, '杭州'), /dq=070020/);
});

test('job search item target is capped at 500', () => {
  assert.equal(jobItemLimit(999), 500);
  assert.equal(jobItemLimit(0), 20);
});

test('all job manifests expose location, start page, and a 500 item ceiling', () => {
  for (const manifest of listConnectorManifests().filter((item) => item.category === 'job_platform')) {
    const search = manifest.capabilities.find((capability) => capability.id === 'keyword_search');
    assert.ok(search, `${manifest.id} should expose keyword search`);
    assert.equal(search.budgetModel, 'true_pagination');
    assert.equal(search.inputFields.find((field) => field.key === 'location')?.runtimeConfigKey, 'job_location');
    assert.equal(search.inputFields.find((field) => field.key === 'start_page')?.runtimeConfigKey, 'start_page');
    assert.equal(search.inputFields.find((field) => field.key === 'max_items')?.max, 500);
  }
});
