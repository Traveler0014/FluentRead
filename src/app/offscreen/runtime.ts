/**
 * @file src/app/offscreen/runtime.ts
 * 文件职责：作为 Chrome Offscreen 与 Firefox 后台 iframe 共用 DOM 页面的组合根，创建独占 TTS 播放器并安装一次 runtime 消息监听，把浏览器资源适配给仍在使用的离屏用例。
 * 主要内容：将 base64 音频解码为 Uint8Array，注入 Audio、Blob URL 创建/释放和状态回传，组合 Chrome Translation 与划词朗读播放依赖，注册 message listener。
 * 模块边界：本文件只负责 Web API 资源与用例装配，不解析业务消息、不实现翻译，也不创建 Offscreen document；文档生命周期由 platform/offscreen client 和 WXT 入口管理。
 * Lite 说明：本分支移除了图片 OCR、区域翻译、本地翻译与本地 TTS，离屏页面只保留 Chrome 内置翻译与在线划词朗读播放。
 */
import {createOffscreenMessageListener} from './messageRouter';
import {createSelectionTtsPlayer} from './ttsPlayback';
import {translateWithChromeApi, type ChromeTranslationEnvironment} from './translation';

function decodeAudioBase64(audioBase64: string): Uint8Array {
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

/** 组装 Offscreen 的实验翻译 API、Audio/Blob 与播放状态回传。 */
export function startOffscreenApp(): void {
    const ttsPlayer = createSelectionTtsPlayer({
        createAudio: () => new Audio(),
        decodeBase64: decodeAudioBase64,
        createObjectUrl: (bytes, contentType) => URL.createObjectURL(new Blob([bytes], {type: contentType})),
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
        notify: (request, state, error) => {
            void chrome.runtime.sendMessage({
                type: 'selectionTtsPlaybackState',
                tabId: request.tabId,
                clientRequestId: request.clientRequestId,
                state,
                error: error instanceof Error ? error.message : error ? String(error) : undefined,
            }, () => {
                // Firefox 的 chrome 命名空间只提供 callback；两种容器共用此通知路径。
                void chrome.runtime.lastError;
            });
        },
    });
    const listener = createOffscreenMessageListener({
        translate: (data, signal) => translateWithChromeApi(data, self as ChromeTranslationEnvironment, signal),
        ttsPlayer,
    });

    chrome.runtime.onMessage.addListener(listener);
    window.addEventListener('pagehide', () => {
        ttsPlayer.dispose();
    }, {once: true});
}
