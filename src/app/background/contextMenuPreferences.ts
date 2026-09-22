/**
 * @file src/app/background/contextMenuPreferences.ts
 * 文件职责：把共享配置和浏览器能力读成右键菜单需要的一份快照，决定哪些入口可用、菜单标题带什么信息。
 * 主要内容：合并总开关、各入口偏好与功能可用性，解析界面语言、目标语言名和全文翻译快捷键显示名，并给出用于判断是否需要重建菜单的签名。
 * 模块边界：本文件只读配置，不创建菜单、不发送消息、不渲染标题；结构推导属于 core/context-menu，菜单生命周期属于 contextMenuRuntime。
 */
import {
    resolveContextMenuEntryToggles,
    type ContextMenuDisplayOptions,
    type ContextMenuEntryToggles,
} from '@/src/core/context-menu/domain';
import {parseHotkey, resolveConfiguredHotkey} from '@/src/core/hotkey';
import {config} from '@/src/services/config/store';
import {
    getContextMenuTargetLanguage,
    type ContextMenuTitleContext,
} from '@/src/core/context-menu/presentation';
import {normalizeUiLanguage} from '@/src/core/i18n';

export interface ContextMenuSettingsSnapshot {
    /** 扩展总开关或右键菜单开关关闭时，整套菜单直接不创建，不留无效入口。 */
    readonly enabled: boolean;
    readonly toggles: ContextMenuEntryToggles;
    readonly display: ContextMenuDisplayOptions;
    readonly titleContext: ContextMenuTitleContext;
    /** 结构与文案的组合签名；只有它变化时才需要重建菜单。 */
    readonly signature: string;
}

type ContextMenuConfigSource = typeof config;

function resolveShortcutDisplayName(source: ContextMenuConfigSource): string {
    const configured = resolveConfiguredHotkey(source.floatingBallHotkey, source.customFloatingBallHotkey);
    if (!configured || configured === 'none') return '';
    const parsed = parseHotkey(configured);
    return parsed.isValid ? parsed.displayName : '';
}

/** 读取当前配置下右键菜单应有的样子；调用方只比较 signature，不需要逐字段比对。 */
export function readContextMenuSettings(source: ContextMenuConfigSource = config): ContextMenuSettingsSnapshot {
    const pluginOn = source.on !== false;
    const language = normalizeUiLanguage(source.uiLanguage);
    const toggles = resolveContextMenuEntryToggles(source.contextMenuEntries, {
        selectionTranslation: pluginOn && source.selectionTranslatorMode !== 'disabled' && source.disableSelectionTranslator !== true,
    });
    const display: ContextMenuDisplayOptions = {
        showTargetLanguage: source.contextMenuShowTargetLanguage !== false,
        showShortcut: source.contextMenuShowShortcut !== false,
    };
    const titleContext: ContextMenuTitleContext = {
        language,
        targetLanguage: display.showTargetLanguage ? getContextMenuTargetLanguage(source.to, language) : '',
        shortcut: display.showShortcut ? resolveShortcutDisplayName(source) : '',
    };
    const enabled = pluginOn && source.contextMenuEnabled !== false;
    return {
        enabled,
        toggles,
        display,
        titleContext,
        signature: JSON.stringify([enabled, toggles, display, titleContext]),
    };
}
