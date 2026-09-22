/**
 * @file scripts/lite/verify-lite.mjs
 * 文件职责：校验 Lite 分支构建产物不再包含被裁剪的重型资产与入口，防止一次上游合并把重型依赖悄悄带回来。
 * 主要内容：读取 lite/exclude.json，检查各浏览器产物目录中不存在被排除的资产路径，检查 manifest 未引用被排除的入口或资源，并以非零退出码报告失败项。
 * 模块边界：只读产物与清单，不修改源码、不执行构建；构建由 package.json 的 build:lite 负责，裁剪理由见 lite/README.md。
 */
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, 'lite', 'exclude.json'), 'utf8'));

/** 扩展产物目录；只校验存在的目录，避免未构建目标导致误报。 */
const outputDirectories = [
    '.output/chrome-mv3',
    '.output/firefox-mv2',
    '.output/userscript',
];

const failures = [];

for (const directory of outputDirectories) {
    const absolute = resolve(root, directory);
    if (!existsSync(absolute)) continue;

    for (const relativeDest of manifest.removedOutputAssets) {
        if (existsSync(resolve(absolute, relativeDest))) {
            failures.push(`${directory}: 仍包含被排除资产 ${relativeDest}`);
        }
    }

    const manifestPath = resolve(absolute, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const text = readFileSync(manifestPath, 'utf8');
    for (const name of manifest.removedEntrypoints) {
        // WXT 产物里入口以文件名形式出现；命中说明过滤逻辑失效。
        if (text.includes(`${name}.js`) || text.includes(`${name}.html`)) {
            failures.push(`${directory}/manifest.json: 仍引用被排除入口 ${name}`);
        }
    }
}

if (failures.length > 0) {
    console.error('[verify-lite] 失败：');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

console.log('[verify-lite] 通过：产物不包含被裁剪的重型资产与入口。');
