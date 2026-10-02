// 目的 — Node で classic script を読み込む（計画書 §3.2、T15-11 で高速化）。
//
// 実装方針: 全ファイルを 1 つの関数スコープに連結し、メイン実行コンテキスト上で
// vm.runInThisContext で評価する。
//  - vm.createContext + runInContext だと、トップレベルの const / class / function だけでなく
//    Math / Float32Array などのグローバル参照も contextified global 経由の遅い参照になり、
//    数値計算のホットパスが約 15 倍遅くなる。
//  - 関数スコープにまとめれば、ファイル間のトップレベル束縛（const / class を含む）は
//    通常のクロージャ変数として共有され、ファイルをまたいで見える（従来の共有スクリプトスコープと同じ）。
//  - 注入グローバル（globals）は関数の仮引数として渡す。`context` は globals を保持する
//    プレーンオブジェクト（呼び出し側が後から書き換えた値は get() では参照されない点のみ従来と異なる）。
//  - get(name) は同じスコープの直接 eval で名前を引く。未定義なら ReferenceError（従来どおり）。
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadClassic(files, globals = {}) {
  const injected = {
    console,
    performance,
    Blob,
    TextEncoder,
    TextDecoder,
    URL,
    ...globals
  };
  const names = Object.keys(injected);
  const body = files
    .map((file) => fs.readFileSync(path.resolve(ROOT, file), 'utf8'))
    .join('\n;\n');
  const source = `(function (${names.join(', ')}) {\n${body}\n;return function (__avzName) { return eval(__avzName); };\n})`;
  const factory = vm.runInThisContext(source, { filename: `load-classic:${files.join(',')}` });
  const lookup = factory(...names.map((name) => injected[name]));
  return {
    get(name) {
      return lookup(name);
    },
    context: injected
  };
}
