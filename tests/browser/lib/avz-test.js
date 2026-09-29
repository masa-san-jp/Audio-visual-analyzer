// 目的 — ブラウザテストの登録・アサーション・結果収集を提供する（計画書 §3.4.2）。
(function (global) {
  'use strict';

  var tests = [];
  var activeArtifacts = null;

  function avzTest(id, name, fn, options) {
    options = options || {};
    if (typeof fn !== 'function') throw new Error('avzTest のテスト本体は関数で指定してください。');
    tests.push({
      id: id,
      name: name,
      fn: fn,
      timeoutMs: options.timeoutMs === undefined ? 30000 : options.timeoutMs,
      slow: options.slow === true,
      expectedFailure: options.expectedFailure === true
    });
  }

  function assertionError(message) {
    return new Error(message || 'アサーションに失敗しました。');
  }

  var avzAssert = {
    ok: function (condition, message) {
      if (!condition) throw assertionError(message || '条件が真ではありません。');
    },
    equal: function (actual, expected, message) {
      if (actual !== expected) {
        throw assertionError((message || '値が一致しません。') +
          ` (actual: ${String(actual)}, expected: ${String(expected)})`);
      }
    },
    close: function (actual, expected, tolerance, message) {
      if (Math.abs(actual - expected) > tolerance) {
        throw assertionError((message || '値が許容範囲に収まりません。') +
          ` (actual: ${String(actual)}, expected: ${String(expected)}, tolerance: ${String(tolerance)})`);
      }
    },
    deepEqual: function (actual, expected, message) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw assertionError((message || '構造が一致しません。') +
          ` (actual: ${JSON.stringify(actual)}, expected: ${JSON.stringify(expected)})`);
      }
    }
  };

  function formatConsoleArguments(args) {
    return Array.prototype.map.call(args, function (value) {
      try { return typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); }
    }).join(' ');
  }

  function errorMessage(error) {
    if (!error) return '不明なエラー';
    return error.stack || error.message || String(error);
  }

  async function runOne(test) {
    var started = performance.now();
    var consoleErrors = [];
    var uncaughtErrors = [];
    var originalConsoleError = console.error;
    var onError = function (event) { uncaughtErrors.push(event.error || new Error(event.message)); };
    var onUnhandledRejection = function (event) { uncaughtErrors.push(event.reason || new Error('未処理の Promise rejection')); };
    console.error = function () {
      consoleErrors.push(formatConsoleArguments(arguments));
      return originalConsoleError.apply(console, arguments);
    };
    global.addEventListener('error', onError);
    global.addEventListener('unhandledrejection', onUnhandledRejection);
    activeArtifacts = [];
    var status = 'pass';
    var error = null;
    var timeoutId;
    var timeout = new Promise(function (_, reject) {
      timeoutId = setTimeout(function () {
        reject(new Error(`タイムアウト (${test.timeoutMs}ms)`));
      }, test.timeoutMs);
    });
    try {
      await Promise.race([Promise.resolve().then(test.fn), timeout]);
      if (uncaughtErrors.length) throw uncaughtErrors[0];
      if (consoleErrors.length) throw new Error(`console.error が発生しました: ${consoleErrors.join(' / ')}`);
    } catch (caught) {
      status = 'fail';
      error = errorMessage(caught);
    } finally {
      clearTimeout(timeoutId);
      global.removeEventListener('error', onError);
      global.removeEventListener('unhandledrejection', onUnhandledRejection);
      console.error = originalConsoleError;
    }
    if (status === 'pass' && uncaughtErrors.length) {
      status = 'fail';
      error = errorMessage(uncaughtErrors[0]);
    }
    if (status === 'pass' && consoleErrors.length) {
      status = 'fail';
      error = `console.error が発生しました: ${consoleErrors.join(' / ')}`;
    }
    var result = {
      id: test.id,
      name: test.name,
      status: status,
      ms: Math.round(performance.now() - started),
      error: error,
      expectedFailure: test.expectedFailure
    };
    if (status === 'fail' && activeArtifacts.length) result.artifacts = activeArtifacts;
    activeArtifacts = null;
    return result;
  }

  async function runAll(filterRegexSource) {
    var filter = filterRegexSource ? new RegExp(filterRegexSource) : null;
    var results = [];
    for (var index = 0; index < tests.length; index += 1) {
      var test = tests[index];
      if (filter && !filter.test(`${test.id} ${test.name}`)) continue;
      if (test.slow && global.__avzSkipSlow) {
        results.push({ id: test.id, name: test.name, status: 'skip', ms: 0, error: null });
        continue;
      }
      var result = await runOne(test);
      // 通常実行では意図的な失敗ケースを反転判定する（失敗を検知できれば pass）
      if (test.expectedFailure && !global.__avzIncludeExpectedFailure) {
        result.name = `${test.name}（期待どおり失敗）`;
        if (result.status === 'fail') {
          result.status = 'pass';
          result.error = null;
        } else {
          result.status = 'fail';
          result.error = '失敗するはずのテストが成功しました。';
        }
      }
      results.push(result);
    }
    return results;
  }

  global.avzTest = avzTest;
  global.avzAssert = avzAssert;
  global.avzArtifact = function (name, dataUrl) {
    if (activeArtifacts) activeArtifacts.push({ name: name, dataUrl: dataUrl });
  };
  global.__avzRun = runAll;
})(window);
