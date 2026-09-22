/**
 * @file .github/scripts/pin-onnxruntime-node.cjs
 *
 * 文件职责：在构建宿主进程中把 onnxruntime-node 收敛到单一版本，规避双版本原生库互斥。
 * 主要内容：扫描 node_modules/.pnpm 下所有 onnxruntime-node@<version> 安装，选出最高版本作为唯一目标，
 *   重写 Module._load，把裸模块名、子路径以及指向其它副本的绝对路径请求全部重定向到该副本。
 * 模块边界：只影响本 Node 进程的模块解析，不修改磁盘上的 node_modules，也不参与浏览器产物构建；
 *   浏览器端始终使用 onnxruntime-web，因此该脚本不会改变扩展运行时行为。
 *
 * 背景：@huggingface/transformers 3.x 依赖 onnxruntime-node@1.21.0，kokoro/transformers 4.x 依赖
 *   onnxruntime-node@1.24.3。两者原生库的 soname 都是 libonnxruntime.so.1，同一进程先加载哪个版本，
 *   后加载的绑定就会因符号版本不匹配而 dlopen 失败（`version 'VERS_1.24.3' not found`）。
 *   pnpm 的隔离布局无法从依赖声明层面消除该冲突；构建工具链还会按解析后的绝对路径直接 import，
 *   因此必须连绝对路径一起重定向，才能保证两个调用方拿到同一份模块。
 * 用法：NODE_OPTIONS="--require $PWD/.github/scripts/pin-onnxruntime-node.cjs" pnpm install/build
 */

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PACKAGE_NAME = 'onnxruntime-node';
const PACKAGE_DIRECTORY_PATTERN = new RegExp(`[\\\\/]${PACKAGE_NAME}[\\\\/]`, 'u');

/** 把 "1.24.3" 这类版本（可能带 peer 后缀）解析成可比较的数字数组。 */
function parseVersion(version) {
    const parts = version.replace(/[^0-9.].*$/u, '').split('.').map((part) => Number.parseInt(part, 10));
    return parts.length > 0 && parts.every((part) => Number.isFinite(part)) ? parts : [0];
}

/** 按语义版本顺序比较两个版本数组，返回负数 / 0 / 正数。 */
function compareVersion(left, right) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

/** 列出 .pnpm 中所有实际存在的 onnxruntime-node 副本，并按版本升序排列。 */
function listInstalledCopies(pnpmRoot) {
    let entries;
    try {
        entries = fs.readdirSync(pnpmRoot);
    } catch {
        return [];
    }
    return entries
        .filter((entry) => entry.startsWith(`${PACKAGE_NAME}@`))
        .map((entry) => {
            const directory = path.join(pnpmRoot, entry, 'node_modules', PACKAGE_NAME);
            return fs.existsSync(directory)
                ? {directory, version: parseVersion(entry.slice(PACKAGE_NAME.length + 1))}
                : null;
        })
        .filter((copy) => copy !== null)
        .sort((left, right) => compareVersion(left.version, right.version));
}

/**
 * 把任意 onnxruntime-node 请求改写到目标副本：
 * - `onnxruntime-node` / `onnxruntime-node/xxx` 这类裸模块与子路径；
 * - `.../onnxruntime-node@1.21.0/node_modules/onnxruntime-node/dist/index.js` 这类已解析的绝对路径。
 * 返回 null 表示不是本包请求，按原样交给原始 loader。
 */
function rewriteToTarget(request, target) {
    if (typeof request !== 'string' || !request.includes(PACKAGE_NAME)) return null;
    if (request === PACKAGE_NAME) return target;
    if (request.startsWith(`${PACKAGE_NAME}/`)) return path.join(target, request.slice(PACKAGE_NAME.length + 1));
    const match = PACKAGE_DIRECTORY_PATTERN.exec(request);
    if (!match) return null;
    return path.join(target, request.slice(match.index + match[0].length));
}

const pnpmRoot = path.resolve(process.cwd(), 'node_modules', '.pnpm');
const target = listInstalledCopies(pnpmRoot).at(-1)?.directory;

if (target) {
    const originalLoad = Module._load;
    Module._load = function pinnedOnnxRuntimeLoad(request, parent, isMain) {
        const rewritten = rewriteToTarget(request, target);
        if (rewritten !== null && rewritten !== request) {
            return originalLoad.call(this, rewritten, parent, isMain);
        }
        return originalLoad.apply(this, arguments);
    };
}
