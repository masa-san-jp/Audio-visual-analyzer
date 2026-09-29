import test from 'node:test';
import assert from 'node:assert/strict';

test('U15-00 正常系: テストランナーが成功を返す', () => {
  assert.equal(1, 1);
});

test('U15-00 異常系: テストランナーが失敗を返す', {
  skip: process.env.AVZ_RUNNER_INCLUDE_EXPECTED_FAILURE !== '1'
}, () => {
  assert.fail('U15-00 runner self-test: intentional failure');
});
