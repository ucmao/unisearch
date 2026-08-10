import assert from 'node:assert/strict';
import test from 'node:test';
import { BOSS_CITY_CODES } from '../src/crawler/platforms/bossCities';
import { ZHAOPIN_CITY_CODES } from '../src/crawler/platforms/zhaopinCities';
import { JOB51_CITY_CODES } from '../src/crawler/platforms/job51Cities';
import { LIEPIN_CITY_CODES } from '../src/crawler/platforms/liepinCities';
import { buildJobSearchUrl, jobItemLimit, resolveJobLocation } from '../src/crawler/platforms/jobSearch';
import { listConnectorManifests } from '../src/connectors/registry';

test('job search resolves common Chinese city names into platform codes', () => {
  assert.equal(resolveJobLocation('boss', '上海市'), '101020100');
  assert.equal(resolveJobLocation('zhaopin', '北京'), '530');
  assert.equal(resolveJobLocation('zhaopin', '北京市'), '530');
  assert.equal(resolveJobLocation('zhaopin', '东莞市'), '779');
  assert.equal(resolveJobLocation('zhaopin', '南昌'), '691');
  assert.equal(resolveJobLocation('zhaopin', '延边朝鲜族自治州'), '621');
  assert.equal(resolveJobLocation('zhaopin', '恩施'), '748');
  assert.equal(resolveJobLocation('zhaopin', '西双版纳'), '840');
  assert.equal(resolveJobLocation('zhaopin', '765'), '765');
  assert.equal(resolveJobLocation('job51', '深圳'), '040000');
  assert.equal(resolveJobLocation('job51', '东莞市'), '030800');
  assert.equal(resolveJobLocation('job51', '延边朝鲜族自治州'), '241100');
  assert.equal(resolveJobLocation('liepin', '杭州'), '070020');
  assert.equal(resolveJobLocation('liepin', '东莞市'), '050040');
  assert.equal(resolveJobLocation('liepin', '延边朝鲜族自治州'), '190110');
  assert.equal(resolveJobLocation('boss', '101190400'), '101190400');
  assert.equal(resolveJobLocation('boss', '泉州市'), '101230500');
  assert.equal(resolveJobLocation('boss', '恩施'), '101201300');
  assert.equal(resolveJobLocation('boss', '阿里地区'), '101140700');
  assert.equal(resolveJobLocation('boss', '北屯市'), '101132100');
});

test('BOSS city table covers every city-level entry from the official city API', () => {
  assert.equal(Object.keys(BOSS_CITY_CODES).length, 374);
  assert.ok(Object.values(BOSS_CITY_CODES).every((code) => /^\d{9}$/.test(code)));
  assert.equal(BOSS_CITY_CODES.乌鲁木齐, '101130100');
  assert.equal(BOSS_CITY_CODES.拉萨, '101140100');
  assert.equal(BOSS_CITY_CODES.海口, '101310100');
  assert.equal(BOSS_CITY_CODES.香港, '101320300');
});

test('Zhaopin city table covers 374 city-level entries with alias support', () => {
  assert.equal(Object.keys(ZHAOPIN_CITY_CODES).length, 374);
  assert.ok(Object.values(ZHAOPIN_CITY_CODES).every((code) => /^\d+$/.test(code)));
  assert.equal(ZHAOPIN_CITY_CODES.全国, '489');
  assert.equal(ZHAOPIN_CITY_CODES.乌鲁木齐, '890');
  assert.equal(ZHAOPIN_CITY_CODES.拉萨, '847');
  assert.equal(ZHAOPIN_CITY_CODES.海口, '799');
  assert.equal(ZHAOPIN_CITY_CODES.东莞, '779');
  assert.equal(ZHAOPIN_CITY_CODES.香港, '561');
  assert.equal(ZHAOPIN_CITY_CODES.澳门, '562');
  assert.equal(ZHAOPIN_CITY_CODES.台湾, '563');
});

test('51job city table covers 380+ city-level entries with alias support', () => {
  assert.ok(Object.keys(JOB51_CITY_CODES).length >= 374);
  assert.ok(Object.values(JOB51_CITY_CODES).every((code) => /^\d{6}$/.test(code)));
  assert.equal(JOB51_CITY_CODES.全国, '000000');
  assert.equal(JOB51_CITY_CODES.北京, '010000');
  assert.equal(JOB51_CITY_CODES.广州, '030200');
  assert.equal(JOB51_CITY_CODES.东莞, '030800');
  assert.equal(JOB51_CITY_CODES.佛山, '030600');
  assert.equal(JOB51_CITY_CODES.无锡, '070400');
});

test('Liepin city table covers 374 city-level entries with alias support', () => {
  assert.equal(Object.keys(LIEPIN_CITY_CODES).length, 374);
  assert.ok(Object.values(LIEPIN_CITY_CODES).every((code) => /^\d{3,6}$/.test(code)));
  assert.equal(LIEPIN_CITY_CODES.全国, '410');
  assert.equal(LIEPIN_CITY_CODES.北京, '010');
  assert.equal(LIEPIN_CITY_CODES.上海, '020');
  assert.equal(LIEPIN_CITY_CODES.广州, '050020');
  assert.equal(LIEPIN_CITY_CODES.深圳, '050090');
  assert.equal(LIEPIN_CITY_CODES.东莞, '050040');
  assert.equal(LIEPIN_CITY_CODES.佛山, '050050');
  assert.equal(LIEPIN_CITY_CODES.无锡, '060100');
});

test('job search URLs carry both keyword and location through pagination', () => {
  assert.match(buildJobSearchUrl('boss', '数据分析', 4, '上海'), /query=%E6%95%B0%E6%8D%AE%E5%88%86%E6%9E%90/);
  assert.match(buildJobSearchUrl('boss', '数据分析', 4, '上海'), /city=101020100/);
  assert.match(buildJobSearchUrl('zhaopin', 'Java', 2, '北京'), /\/sou\/jl530\/kwjava\/p2$/);
  assert.match(buildJobSearchUrl('zhaopin', '前端', 3, '东莞'), /\/sou\/jl779\/kw%E5%89%8D%E7%AB%AF\/p3$/);
  assert.match(buildJobSearchUrl('job51', '产品经理', 3, '深圳'), /jobArea=040000/);
  assert.match(buildJobSearchUrl('job51', '前端', 2, '东莞'), /jobArea=030800/);
  assert.match(buildJobSearchUrl('liepin', '算法', 3, '杭州'), /currentPage=2/);
  assert.match(buildJobSearchUrl('liepin', '算法', 3, '杭州'), /dq=070020/);
  assert.match(buildJobSearchUrl('liepin', '前端', 2, '东莞'), /dq=050040/);
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
