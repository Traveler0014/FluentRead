/**
 * @file src/app/background/messageRuntime.ts
 * 文件职责：构建并安装后台消息总运行时，把配置、翻译、划词朗读、词典、输入框与标签页状态等公开 handler 连接到 browser.runtime。
 * 主要内容：绑定翻译请求表与能力门控传输，注入配置、翻译、本机统计（模型用量与翻译统计）和词典依赖，注册类型化 router 并管理响应与错误。
 * 模块边界：本文件是 composition root，只决定依赖装配和监听生命周期，不实现各 feature 的业务算法、provider 协议或存储事务；具体实现均来自 features、services、providers 与 platform。
 * Lite 说明：本分支不再装配图片/区域翻译、视频字幕、本地翻译、本地 TTS、生词本、写作助手与阅读卡片；它们对应的 feature 目录已移除。
 */
import {formatConnectionTestError, getFreeTranslationWeightSnapshot, runTranslationServiceConnectionTestWithUsage} from './providerRuntime';
import {config, configReady} from '@/src/services/config/store';
import {lookupWord} from '@/src/features/selection-translation/services/wordDictionary';
import {synthesizeEdgeTts} from '@/src/features/selection-translation/services/edgeTts';
import {clearTranslationCache, getTranslationCacheStats, translateWithCache} from '@/src/app/translation/runtime';
import {serializeTranslationError} from '@/src/services/translation/errors';
import {createBackgroundMessageRouter, createBackgroundRuntimeMessageListener, type BackgroundMessageHandler} from './messageRouter';
import {createTranslationCacheHandlers, createTranslationCacheInvalidationBroadcaster} from './handlers/translationCache';
import {type ConfigPersistenceContext} from './handlers/configPersistence';
import {createConnectionTestHandler} from './handlers/connectionTest';
import {
    createFullPageTranslationStateHandlers, createQqMailFrameBackgroundHandlers,
    type FullPageBackgroundContext, type QQMailFrameBackgroundContext,
} from './handlers/fullPageTranslationState';
import {createInputBoxTranslationHandler} from './handlers/inputTranslation';
import {createLocalInsightsHandlers} from './localInsightsHandlers';
import {createFreeTranslationWeightsHandler} from './handlers/freeTranslationWeights';
import {createOpenOptionsPageHandler} from './handlers/openOptions';
import {createTranslationCancelHandler, createTranslationRequestFallback, createTranslationRequestRegistry} from './handlers/translation';
import {createSelectionTtsBackgroundHandlers, type SelectionTtsContext} from './handlers/selectionTts';
import {createSelectionWordLookupHandler} from './handlers/selectionWordLookup';
import {isBrowserTabId, type TabTranslationStateStore} from './tabTranslationState';
import {browserCapabilities, type BrowserCapabilities} from '@/src/platform/browser/capabilities';
import {selectionTtsOffscreenAdapter} from '@/src/features/selection-translation/background/offscreenAdapter';
import {createCapabilityGatedSelectionTtsTransport} from './capabilityRegistry';
import {createConfigBackgroundHandlers} from './configMessageHandlers';
import {installBrowserConfigStorageBroadcast} from './configStorageRuntime';
import {createSelectionTtsSynthesizer} from '@/src/features/selection-translation/background/selectionTtsSynthesis';
type BackgroundRuntimeContext = QQMailFrameBackgroundContext & ConfigPersistenceContext & SelectionTtsContext
    & FullPageBackgroundContext;
export interface BackgroundMessageRuntimeOptions {
    tabTranslationStates: TabTranslationStateStore;
    onFullPageStateChanged(tabId: number): void;
    capabilities?: BrowserCapabilities;
}
/** 用静态 handler registry 组装唯一的 runtime.onMessage 入口。 */
export function installBackgroundMessageRuntime(options: BackgroundMessageRuntimeOptions): void {
    const capabilities = options.capabilities ?? browserCapabilities;
    const translationRequestRegistry = createTranslationRequestRegistry();
    const selectionTtsTransport = createCapabilityGatedSelectionTtsTransport(capabilities, selectionTtsOffscreenAdapter);
    const selectionTtsSynthesizer = createSelectionTtsSynthesizer({
        getOnlineVoices: () => config.selectionTtsVoices,
        synthesizeOnline: synthesizeEdgeTts,
    });
    const handlers: Array<BackgroundMessageHandler<BackgroundRuntimeContext>> = [
        createTranslationCancelHandler(translationRequestRegistry),
        ...createQqMailFrameBackgroundHandlers({sendTabMessage: (tabId, message, options) => browser.tabs.sendMessage(tabId, message, options)}),
        ...createTranslationCacheHandlers(clearTranslationCache, getTranslationCacheStats, createTranslationCacheInvalidationBroadcaster({
            queryTabs: () => browser.tabs.query({}) as Promise<Array<{id?: number}>>,
            sendTabMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message),
            warn: (message, error) => console.warn(message, error),
        })),
        ...createLocalInsightsHandlers<BackgroundRuntimeContext>((url) => url.startsWith(browser.runtime.getURL('/options.html'))),
        createFreeTranslationWeightsHandler({
            ready: configReady,
            getSnapshot: getFreeTranslationWeightSnapshot,
            isOptionsUrl: (url) => url.startsWith(browser.runtime.getURL('/options.html')),
        }),
        ...createConfigBackgroundHandlers<BackgroundRuntimeContext>(),
        createConnectionTestHandler({
            ready: configReady,
            runConnectionTest: runTranslationServiceConnectionTestWithUsage,
            formatError: formatConnectionTestError,
        }),
        createInputBoxTranslationHandler({
            ready: configReady,
            getConfig: () => config,
            translate: translateWithCache,
        }),
        createOpenOptionsPageHandler({
            openDefaultPage: () => browser.runtime.openOptionsPage(),
            openSection: async (section) => {
                await browser.tabs.create({url: `${browser.runtime.getURL('/options.html')}#${section}`});
            },
        }),
        ...createFullPageTranslationStateHandlers({
            stateStore: options.tabTranslationStates,
            isTabId: isBrowserTabId,
            onStateChanged: options.onFullPageStateChanged,
        }),
        createSelectionWordLookupHandler({
            lookupWord,
            getDefaultTargetLanguage: () => config.to,
            translate: translateWithCache,
            warn: (message, error) => console.warn(message, error),
        }),
        ...createSelectionTtsBackgroundHandlers({
            getPreferredVoices: () => config.selectionTtsVoices,
            synthesize: selectionTtsSynthesizer,
            playWithOffscreen: selectionTtsTransport.play,
            stopWithOffscreen: selectionTtsTransport.stop,
            offscreenPlaybackEnabled: capabilities.selectionTtsExtensionPlayback,
            sendTabMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message),
            warn: (message, error) => console.warn(message, error),
        }),
    ];
    const router = createBackgroundMessageRouter(
        handlers,
        createTranslationRequestFallback({
            translate: translateWithCache,
            serializeError: serializeTranslationError,
            requestRegistry: translationRequestRegistry,
        }),
    );
    browser.runtime.onMessage.addListener(createBackgroundRuntimeMessageListener(router, (sender) => ({sender}) as BackgroundRuntimeContext));
    installBrowserConfigStorageBroadcast();
}
