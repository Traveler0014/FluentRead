/**
 * @file src/features/selection-translation/background/selectionTtsSynthesis.ts
 * 文件职责：把在线 TTS 与用户音色偏好组装成划词朗读合成器，作为后台 handler 与具体语音服务之间的稳定契约。
 * 主要内容：读取用户配置的在线音色顺序，并把合成委托给注入的在线实现；不再包含本地 Kokoro 模型的分支与回退。
 * 模块边界：只决定合成来源与音色参数，不播放音频；播放和停止仍由 selectionTts handler 与 Offscreen 负责。
 * Lite 说明：本分支移除了本地 TTS feature，因此合成策略收敛为“仅在线”，保留工厂以维持后台装配结构。
 */
import type {SelectionTtsAudio} from './ttsHandler';

export interface SelectionTtsSynthesisDependencies {
    readonly getOnlineVoices: () => unknown;
    readonly synthesizeOnline: (
        text: string,
        language: string,
        preferredVoices: unknown,
        signal?: AbortSignal,
    ) => Promise<SelectionTtsAudio>;
}

/** 创建可注入的在线合成器，便于单元测试音色传递与错误透传。 */
export function createSelectionTtsSynthesizer(
    dependencies: SelectionTtsSynthesisDependencies,
) {
    return async function synthesizeSelectionTts(
        text: string,
        language: string,
        _preferredVoices: unknown,
        signal?: AbortSignal,
    ): Promise<SelectionTtsAudio> {
        return dependencies.synthesizeOnline(text, language, dependencies.getOnlineVoices(), signal);
    };
}
