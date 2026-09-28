import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadClassic(files, globals = {}) {
  const context = vm.createContext({
    console,
    performance,
    Blob,
    TextEncoder,
    TextDecoder,
    URL,
    ...globals
  });

  for (const file of files) {
    const fullPath = path.resolve(ROOT, file);
    const source = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(source, context, { filename: file });
  }

  return {
    get(name) {
      return vm.runInContext(name, context);
    },
    context
  };
}
