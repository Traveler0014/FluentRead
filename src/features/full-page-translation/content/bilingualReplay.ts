/**
 * @file src/features/full-page-translation/content/bilingualReplay.ts
 * 文件职责：在 provider 文本槽未变化时，按宿主最新安全 DOM 骨架原子重放已提交双语译文。
 * 主要内容：复验可重放槽、构建最新快照、就地刷新 wrapper，并把状态重绑到实时 Text 节点。
 * 模块边界：本文件不监听 DOM、不调 provider、不管理会话；runtime 决定何时重放及何时熔断。
 */
import {
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    getTranslationSlotTextNodes,
    createTranslationSourceSnapshot,
    getCurrentTranslationCore,
    type TranslationTextProtectionOptions,
} from '@/src/core/translation/public';
import {refreshBilingualTranslation} from './renderer';
import {setBilingualContent, setRenderedStyleAttribute, type TranslationState} from './state';
import {isTranslationArtifactCurrent} from './translationStability';

function protectionOptions(
    node: HTMLElement,
    state: TranslationState,
): TranslationTextProtectionOptions {
    return state.allowTopLevelApplicationShell === true
        ? {allowTopLevelApplicationShell: true, protectedElement: node}
        : {protectedElement: node};
}

export function refreshBilingualTranslationSkeleton(
    node: HTMLElement,
    state: TranslationState,
): boolean {
    const replay = state.bilingualReplay;
    const content = state.bilingualContent;
    if (state.phase !== 'translated' || state.mode !== 'bilingual' || state.kind !== 'content' ||
        !replay || !content || !isTranslationArtifactCurrent(node, state)) return false;

    const core = getCurrentTranslationCore(state.scope);
    const boundary = state.syntheticSegment ? node : undefined;
    const options = protectionOptions(node, state);
    const snapshot = createTranslationSourceSnapshot(
        node,
        core.shouldStayOriginal,
        boundary,
        options,
        core.shouldOmitFromTranslation,
    );
    const sources = snapshot.slots.map((slot) => slot.source);
    if (sources.length !== replay.sources.length ||
        sources.some((source, index) => source !== replay.sources[index])) return false;

    const translatedHTML = applyTranslationsToSnapshot(snapshot, replay.translations);
    refreshBilingualTranslation(node, content, translatedHTML, {
        sourceSkeleton: snapshot.clone,
        targetLanguage: replay.targetLanguage,
        style: replay.style,
        sourceText: replay.sources.join('\n'),
    });
    state.sourceTextNodes = collectLiveTranslationTextSlots(
        node,
        core.shouldStayOriginal,
        boundary,
        options,
    ).flatMap(getTranslationSlotTextNodes);
    setBilingualContent(node, content, replay);
    setRenderedStyleAttribute(node);
    return true;
}
