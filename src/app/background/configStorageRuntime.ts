/**
 * @file src/app/background/configStorageRuntime.ts
 *
 * 文件职责：把后台配置 IndexedDB 端口连接到浏览器 runtime/tabs 变化广播。
 * 主要内容：用真实 browser API 安装仅携带键名的配置变化通知。
 * 模块边界：本文件是后台 composition glue，不实现加密、迁移、授权或存储领域规则；纯广播策略与配置仓库分别在相邻模块中测试。
 * Lite 说明：本分支移除了图片 OCR，因此不再提供 OCR 语言包元数据的加密存储 adapter。
 */

import {configStorage} from '@/src/platform/storage/configStorageRuntime';
import {installConfigStorageBroadcast} from './configStorageBroadcast';

export function installBrowserConfigStorageBroadcast(): void {
    installConfigStorageBroadcast(configStorage, {
        sendRuntimeMessage: message => browser.runtime.sendMessage(message),
        queryTabs: () => browser.tabs.query({}) as Promise<Array<{id?: number}>>,
        sendTabMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message),
        warn: (message, error) => console.warn(message, error),
    });
}
