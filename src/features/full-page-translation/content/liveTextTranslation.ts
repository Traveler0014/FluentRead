/**
 * @file src/features/full-page-translation/content/liveTextTranslation.ts
 * 文件职责：按候选类型、展示模式和识别范围选择文本槽请求，保留异步提交所需的来源与译文快照。
 * 主要内容：为正文双语构造文本快照，为交互控件和仅译文模式构造带前后缀的实时 Text 槽结果，为按钮型 input 构造属性替换结果，对机器翻译服务把多片段候选整块送出并只回填首个槽位，统一传递取消、重试、范围与会话参数。
 * 模块边界：本文件不管理 DOM 状态、不决定候选、不监听 mutation；runtime 负责 generation 校验和最终渲染。
 */
import {
    collectLiveTranslationTextSlots,
    getCurrentTranslationCore,
    getTranslatableControlValueAttribute,
    getTranslationSlotTextNodes,
    normalizeTranslationText,
} from '@/src/core/translation/public';
import type {TranslationScope, TranslationTextProtectionOptions, TranslationTextSlot} from '@/src/core/translation/public';
import {servicesType} from '@/src/core/config/catalog';
import type {TranslationQueueSession} from '@/src/services/translation/queue';
import {
    translateTextSlots,
    type FullPageTranslationConfigSnapshot,
    type FullPageTranslationSessionCache,
} from './translationRequest';

export interface LiveTextTranslationResult {
    kind: 'live-text';
    complete: boolean;
    changed: boolean;
    sources: readonly string[];
    translations: readonly string[];
    nodes: readonly Text[];
    slots: readonly {node: Text; text: string}[];
}

export interface ControlValueTranslationResult {
    kind: 'control-value';
    /** 承载按钮标签的属性名；恢复原文与复验都以同一属性为准。 */
    attribute: string;
    complete: boolean;
    changed: boolean;
    sources: readonly string[];
    translations: readonly string[];
    /** 写回宿主属性的最终文本。 */
    text: string;
}

/**
 * 宿主格式（加粗、链接、斜体、上下标）会把一句话切成多个 Text 槽。标记协议型 AI 服务
 * 能在保留内联结构的同时按标记回填，但机器翻译接口只会把每个槽位当成独立句子翻译，
 * 碎片会得到脱离上下文的译文。此时改为整块请求，只把整段译文交给首个槽位。
 */
function shouldTranslateCandidateAsWholeBlock(
    slots: readonly TranslationTextSlot[],
    snapshot: FullPageTranslationConfigSnapshot,
): boolean {
    return slots.length > 1 && !servicesType.isUseAIContext(snapshot.service, snapshot.model);
}

/** 用前后缀重建候选原始文本，保留宿主页原有的空白与标点衔接。 */
function wholeBlockSourceText(slots: readonly TranslationTextSlot[]): string {
    return slots.map((slot) => `${slot.prefix}${slot.source}${slot.suffix}`).join('');
}

/** 整块译文的回填形态：整段译文交给首个槽位，其余槽位留空以避免原文碎片残留。 */
function wholeBlockTranslations(sources: readonly string[], translation: string): string[] {
    if (!normalizeTranslationText(translation) || translation === sources[0]) return [...sources];
    return sources.map((_, index) => index === 0 ? translation : '');
}

/** 槽位按节点展开展示文本：译文只写首个节点，词内合并的后续节点清空。 */
function slotDisplayTexts(
    parts: readonly TranslationTextSlot[],
    translations: readonly string[],
): Array<{node: Text; text: string}> {
    return parts.flatMap((part, index) => {
        const text = `${part.prefix}${translations[index] ?? part.source}${part.suffix}`;
        return getTranslationSlotTextNodes(part).map((node, position) => ({
            node,
            text: position === 0 ? text : '',
        }));
    });
}

/**
 * 把一个候选的多个文本槽改写为整块请求。返回 null 表示调用方仍需按槽位请求。
 * 整块请求的缓存身份就是整段原文，不再产生脱离上下文的碎片缓存。
 */
async function translateCandidateAsWholeBlock(
    slots: readonly TranslationTextSlot[],
    snapshot: FullPageTranslationConfigSnapshot,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
    fullPageSession?: FullPageTranslationSessionCache,
    forceFailedRequest = false,
): Promise<string[] | null> {
    const sources = slots.map((slot) => slot.source);
    const [translation] = await translateTextSlots(
        [wholeBlockSourceText(slots)],
        snapshot,
        signal,
        queueSession,
        fullPageSession,
        forceFailedRequest,
    );
    return translation ? wholeBlockTranslations(sources, translation) : null;
}

/**
 * 按钮型 input 没有可写入的 Text 节点，只能整体替换属性文本。
 * 这与其他控件的产品语义一致：按钮尺寸由宿主样式钉死，只呈现译文，不做双语对照。
 */
export async function translateControlValue(
    node: HTMLElement,
    attribute: string,
    snapshot: FullPageTranslationConfigSnapshot,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
    fullPageSession?: FullPageTranslationSessionCache,
    forceFailedRequest = false,
): Promise<ControlValueTranslationResult> {
    const source = node.getAttribute(attribute) ?? '';
    const translations = await translateTextSlots(
        [source], snapshot, signal, queueSession, fullPageSession, forceFailedRequest,
    );
    const text = translations[0] ?? source;
    return {
        kind: 'control-value',
        attribute,
        complete: translations.length === 1,
        changed: normalizeTranslationText(text) !== normalizeTranslationText(source),
        sources: [source],
        translations,
        text,
    };
}

export async function translateLiveText(
    node: HTMLElement,
    snapshot: FullPageTranslationConfigSnapshot,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
    fullPageSession?: FullPageTranslationSessionCache,
    protectionOptions?: TranslationTextProtectionOptions,
    forceFailedRequest = false,
    scope?: TranslationScope,
): Promise<LiveTextTranslationResult> {
    const parts = collectLiveTranslationTextSlots(
        node,
        getCurrentTranslationCore(scope).shouldStayOriginal,
        undefined,
        protectionOptions,
    );
    if (parts.length === 0) return {
        kind: 'live-text',
        complete: false,
        changed: false,
        sources: [],
        translations: [],
        nodes: [],
        slots: [],
    };

    const origins = parts.map((part) => part.source);
    if (shouldTranslateCandidateAsWholeBlock(parts, snapshot)) {
        const wholeBlock = await translateCandidateAsWholeBlock(parts, snapshot, signal, queueSession,
            fullPageSession, forceFailedRequest);
        if (wholeBlock) {
            return {
                kind: 'live-text',
                complete: true,
                changed: true,
                sources: origins,
                translations: wholeBlock,
                nodes: parts.flatMap(getTranslationSlotTextNodes),
                slots: slotDisplayTexts(parts, wholeBlock),
            };
        }
    }
    const translations = await translateTextSlots(
        origins,
        snapshot,
        signal,
        queueSession,
        fullPageSession,
        forceFailedRequest,
    );
    const changed = translations.some((translation, index) =>
        translation.replace(/[\s\u3000]+/gu, ' ').trim() !== (origins[index] || '').replace(/[\s\u3000]+/gu, ' ').trim(),
    );

    return {
        kind: 'live-text',
        complete: translations.length === origins.length,
        changed,
        sources: origins,
        translations,
        nodes: parts.flatMap(getTranslationSlotTextNodes),
        slots: slotDisplayTexts(parts, translations),
    };
}

export type TranslationResult = LiveTextTranslationResult | ControlValueTranslationResult | {
    kind: 'snapshot';
    sources: readonly string[];
    translations: readonly string[];
};

/** 统一冻结候选范围；异步期间其他会话的范围变化不能改变本次请求的文本槽。 */
export async function createTranslationRequest(
    node: HTMLElement,
    kind: 'content' | 'control',
    mode: 'bilingual' | 'single',
    snapshot: FullPageTranslationConfigSnapshot,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
    fullPageSession?: FullPageTranslationSessionCache,
    protectionOptions?: TranslationTextProtectionOptions,
    forceFailedRequest = false,
    scope?: TranslationScope,
): Promise<TranslationResult> {
    const controlValueAttribute = getTranslatableControlValueAttribute(node);
    if (controlValueAttribute) {
        return translateControlValue(node, controlValueAttribute, snapshot, signal,
            queueSession, fullPageSession, forceFailedRequest);
    }
    if (kind === 'control' || mode === 'single') {
        return translateLiveText(node, snapshot, signal, queueSession, fullPageSession,
            protectionOptions, forceFailedRequest, scope);
    }
    const parts = collectLiveTranslationTextSlots(node, getCurrentTranslationCore(scope).shouldStayOriginal,
        undefined, protectionOptions);
    const origins = parts.map((part) => part.source);
    if (origins.length === 0) return {kind: 'snapshot', sources: [], translations: []};
    if (shouldTranslateCandidateAsWholeBlock(parts, snapshot)) {
        const wholeBlock = await translateCandidateAsWholeBlock(parts, snapshot, signal, queueSession,
            fullPageSession, forceFailedRequest);
        if (wholeBlock) return {kind: 'snapshot', sources: origins, translations: wholeBlock};
    }
    const translations = await translateTextSlots(origins, snapshot, signal, queueSession,
        fullPageSession, forceFailedRequest);
    return {kind: 'snapshot', sources: origins, translations};
}
