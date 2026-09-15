/**
 * @file src/core/translation/serialization.ts
 *
 * 文件职责：把候选 DOM 安全序列化为可翻译文本槽，并在异步请求后依据源快照恢复到仍然匹配的真实节点。
 * 主要内容：定义 TranslationTextSlot、TranslationSourceSnapshot 与样式覆盖规则，负责槽位编码解析、活节点收集（排除候选内的独立 tooltip）、词内碎片合并、译文写入克隆、隐藏/编辑/宿主 metadata 省略、可见公式骨架保全、译文产物过滤，以及识别 line-clamp 与溢出截断并提供临时解除截断的样式覆盖规则。 可核对的公开符号包括 TranslationTextSlot、TranslationSourceSnapshot、SerializedTranslationSlots、TranslationStyleOverride、translationTruncationStyleOverrides、serializeTranslationSlots、parseTranslationSlots、createTranslationSourceSnapshot、getTranslationSlotTextNodes。
 * 模块边界：本文件属于可独立测试的 core 候选领域；可以读取传入 DOM 以计算结果，但不访问配置存储、不调用 provider、不注册页面监听器，也不负责译文渲染或 feature 生命周期。
 */

import {isTranslationTextNodeProtected} from './text';
import {
    getElementTagName,
    hasContentEditableMarker,
    isForeignTranslationBoundary,
    isHardPruneTag,
    isHiddenTranslationElement,
    isIconFontElement,
    isTextInNestedTranslationTooltip,
    isTranslationTooltip,
} from './dom';
import type {TranslationTextProtectionOptions} from './dom';

const translationArtifactSelector = [
    '.fluent-read-bilingual-content',
    '.fluent-read-loading',
    '.fluent-read-retry-wrapper',
    '[data-fr-translation-owned="true"]',
].join(',');

// 与 renderer 的本地公式白名单保持一致；内部 aria-hidden 常指可视排版副本，
// 交给公式净化器去掉辅助 MathML/TeX，不能按普通隐藏正文逐节点丢弃。
const sourceFormulaSelector = 'math, mjx-container, .MathJax, .MathJax_Display, .MathJax_SVG, .MathJax_CHTML, .katex, .mwe-math-element, .ltx_Math';

export interface TranslationTextSlot {
    node: Text;
    prefix: string;
    suffix: string;
    source: string;
    /**
     * 与 node 在词内连续的后续 Text 节点：宿主用内联标记把同一个词切成
     * one / ’ / s 这类碎片时，它们必须作为同一个槽位送出，否则模型只能
     * 逐片翻译。译文写入 node，这些节点清空；恢复仍以原始值快照为准。
     */
    continuationNodes?: readonly Text[];
}

/** 展平一个槽位包含的全部 Text，供节点身份比较与恢复快照使用。 */
export function getTranslationSlotTextNodes(slot: TranslationTextSlot): readonly Text[] {
    return slot.continuationNodes?.length ? [slot.node, ...slot.continuationNodes] : [slot.node];
}

export interface TranslationSourceSnapshot {
    clone: HTMLElement;
    slots: TranslationTextSlot[];
}

export interface SerializedTranslationSlots {
    payload: string;
    starts: readonly string[];
    ends: readonly string[];
}

export interface TranslationStyleOverride {
    property: string;
    value: string;
    priority: string;
}

export const translationTruncationStyleOverrides: readonly TranslationStyleOverride[] = [
    {property: '-webkit-line-clamp', value: 'unset', priority: 'important'},
    {property: 'line-clamp', value: 'unset', priority: 'important'},
    {property: 'max-height', value: 'unset', priority: 'important'},
];

/** 固定高度且内容向外溢出的自然流容器需要暂时恢复为内容高度。 */
export const translationHeightStyleOverrides: readonly TranslationStyleOverride[] = [
    {property: 'height', value: 'auto', priority: 'important'},
];


const naturalFlowDisplays = new Set([
    'block', 'flow-root', 'flex', 'grid', 'inline-block', 'inline-flex', 'inline-grid',
]);

function getLayoutStyle(element: HTMLElement): CSSStyleDeclaration | undefined {
    try {
        return element.ownerDocument?.defaultView?.getComputedStyle(element);
    } catch {
        return undefined;
    }
}

function isPositionedStyle(style: CSSStyleDeclaration): boolean {
    const position = String(style.position || '').trim().toLowerCase();
    const transform = String(style.transform || '').trim().toLowerCase();
    return ['absolute', 'fixed', 'sticky'].includes(position) ||
        (transform !== '' && transform !== 'none');
}

function isHeightBoundaryStyle(element: HTMLElement, style: CSSStyleDeclaration): boolean {
    if (element === element.ownerDocument?.documentElement || element === element.ownerDocument?.body) return true;
    const overflowY = String(style.overflowY || style.overflow || '').trim().toLowerCase();
    return ['auto', 'scroll'].includes(overflowY) || isPositionedStyle(style);
}

/** 不向文档表面、滚动容器或脱离自然流的定位边界扩展固定高度。 */
export function isTranslationHeightBoundary(element: HTMLElement): boolean {
    const style = getLayoutStyle(element);
    return !style || isHeightBoundaryStyle(element, style);
}

function hasGeometryOverflow(element: HTMLElement, branch: HTMLElement): boolean {
    try {
        const elementRect = element.getBoundingClientRect();
        const branchRect = branch.getBoundingClientRect();
        return branchRect.top < elementRect.top - 1 || branchRect.bottom > elementRect.bottom + 1;
    } catch {
        return false;
    }
}

/**
 * 判定固定高度自然流容器是否因翻译分支实际变高而需要扩高。
 * branch 必须是通向翻译 owner 的直接 composed 子元素；定位/变换分支不作为依据。
 */
export function hasTranslationHeightOverflow(element: HTMLElement, branch: HTMLElement): boolean {
    // 每个候选的布局复核都会走到这里；同一元素只取一次计算样式，
    // 避免为 boundary、branch 和高度判定重复触发三次样式重算。
    const style = getLayoutStyle(element);
    if (!style || isHeightBoundaryStyle(element, style)) return false;
    const branchStyle = element === branch ? style : getLayoutStyle(branch);
    if (!branchStyle || isPositionedStyle(branchStyle)) return false;
    const overflowY = String(style.overflowY || style.overflow || '').trim().toLowerCase();
    if (['hidden', 'clip'].includes(overflowY)) return false;
    const height = Number.parseFloat(String(style.height || ''));
    const display = String(style.display || '').trim().toLowerCase();
    if (!Number.isFinite(height) || height <= 0 || !naturalFlowDisplays.has(display)) return false;
    try {
        if (element === branch && element.scrollHeight > element.clientHeight + 1) return true;
    } catch {
        // 某些测试/宿主 DOM 没有完整 layout API，继续使用几何检查。
    }
    return hasGeometryOverflow(element, branch);
}

function hashSlotSources(sources: readonly string[]): string {
    let hash = 2166136261;
    for (const source of sources) {
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        hash ^= 0xff;
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export interface TranslationSlotSerializationOptions {
    /**
     * 槽位之间写入的原始分隔。同一段落的连续片段应使用单个空格，让模型看到
     * 完整句子；跨段落合批（AI 多段）仍保留换行，避免把不同段落粘成一句。
     */
    separator?: string;
}

/**
 * 将多个纯文本槽编码为一次服务请求。确定性 nonce 使整段缓存 key 保持稳定；
 * 若源文本已包含完全相同的哨兵标记，则追加冲突后缀。
 */
export function serializeTranslationSlots(
    sources: readonly string[],
    requestedNonce = hashSlotSources(sources),
    options: TranslationSlotSerializationOptions = {},
): SerializedTranslationSlots {
    let nonce = requestedNonce.replace(/[^a-z0-9_-]/giu, '') || 'slots';
    let collision = 0;
    const hasCollision = (candidate: string) => sources.some((source, index) =>
        source.includes(`___FLUENTREAD_${candidate}_${index}_BEGIN___`) ||
        source.includes(`___FLUENTREAD_${candidate}_${index}_END___`));
    while (hasCollision(nonce)) {
        collision += 1;
        nonce = `${requestedNonce}_${collision}`.replace(/[^a-z0-9_-]/giu, '');
    }

    const separator = options.separator ?? '\n';
    const starts = sources.map((_, index) => `___FLUENTREAD_${nonce}_${index}_BEGIN___`);
    const ends = sources.map((_, index) => `___FLUENTREAD_${nonce}_${index}_END___`);
    // 分隔符写在标记之外：解析仍只接受标记之间（或之外仅空白）的文本，
    // 但模型能看出相邻槽位属于同一句话，而不是彼此独立的短句。
    const payload = sources
        .map((source, index) => `${index === 0 ? '' : separator}${starts[index]}${source}${ends[index]}`)
        .join('');
    return {payload, starts, ends};
}

/** 严格按顺序为每个槽接受一个结果；标记外出现正文或代码围栏时整包拒绝。 */
export function parseTranslationSlots(
    packet: SerializedTranslationSlots,
    translated: string,
): string[] | null {
    if (packet.starts.length !== packet.ends.length) return null;
    const countMarker = (marker: string): number => {
        let count = 0;
        let offset = 0;
        while (marker && offset <= translated.length - marker.length) {
            const next = translated.indexOf(marker, offset);
            if (next < 0) break;
            count += 1;
            offset = next + marker.length;
        }
        return count;
    };
    if ([...packet.starts, ...packet.ends].some((marker) => !marker || countMarker(marker) !== 1)) {
        return null;
    }
    const results: string[] = [];
    let cursor = 0;
    for (let index = 0; index < packet.starts.length; index += 1) {
        const start = packet.starts[index];
        const end = packet.ends[index];
        if (!start || !end) return null;
        const startIndex = translated.indexOf(start, cursor);
        if (startIndex < 0 || translated.slice(cursor, startIndex).trim()) return null;
        const valueStart = startIndex + start.length;
        const endIndex = translated.indexOf(end, valueStart);
        if (endIndex < 0) return null;
        if (translated.indexOf(start, valueStart) >= 0 && translated.indexOf(start, valueStart) < endIndex) return null;
        results.push(translated.slice(valueStart, endIndex));
        cursor = endIndex + end.length;
    }
    return translated.slice(cursor).trim() ? null : results;
}

/**
 * 两条祖先链只允许穿过纯排版内联层。链接、上下标和控件保留独立槽位，
 * 因为把整段译文塞进这些元素会改变链接或脚注的可见结构。
 */
const wordContinuationTags = new Set([
    'span', 'em', 'i', 'b', 'strong', 'font', 'u', 's', 'small', 'mark', 'abbr', 'cite', 'q',
]);

/**
 * 求两个槽位的最内层共同祖先及两侧祖先链；任一侧穿过非排版内联元素时返回 null。
 * 两个槽位来自同一次遍历，因此 previous 的祖先链上必然存在同时包含 next 的节点，
 * 自 next 上溯也必然回到该节点；这里用非空断言表达该不变量，不设置防御分支。
 */
function wordContinuationChains(
    previous: Text,
    next: Text,
): {previousChain: Element[]; nextChain: Element[]} | null {
    const previousChain: Element[] = [];
    let boundary = previous.parentElement!;
    while (!boundary.contains(next)) {
        if (!wordContinuationTags.has(getElementTagName(boundary))) return null;
        previousChain.push(boundary);
        boundary = boundary.parentElement!;
    }
    const nextChain: Element[] = [];
    let current = next.parentElement!;
    while (current !== boundary) {
        if (!wordContinuationTags.has(getElementTagName(current))) return null;
        nextChain.push(current);
        current = current.parentElement!;
    }
    return {previousChain, nextChain};
}

/**
 * 判定两个相邻槽位的交界是否落在同一个词的中间：两条祖先链只经过排版内联层，
 * 且在共同祖先下两条链的顶层节点互为紧邻兄弟；受保护或语义节点会自然打断该条件。
 */
function isWordContinuationBoundary(previous: Text, next: Text): boolean {
    const chains = wordContinuationChains(previous, next);
    if (!chains) return false;
    const previousTop: Node = chains.previousChain.at(-1) ?? previous;
    const nextTop: Node = chains.nextChain.at(-1) ?? next;
    return previousTop.nextSibling === nextTop;
}

/** 合并词内碎片；交界处任一侧存在空白即视为词边界，保持独立槽位。 */
function mergeWordContinuationSlots(slots: readonly TranslationTextSlot[]): TranslationTextSlot[] {
    const merged: TranslationTextSlot[] = [];
    for (const slot of slots) {
        const previous = merged.at(-1);
        if (previous) {
            const previousTail = previous.continuationNodes?.at(-1) ?? previous.node;
            if (previous.suffix === '' && slot.prefix === '' && isWordContinuationBoundary(previousTail, slot.node)) {
                merged[merged.length - 1] = {
                    node: previous.node,
                    prefix: previous.prefix,
                    source: previous.source + slot.source,
                    suffix: slot.suffix,
                    continuationNodes: [...(previous.continuationNodes ?? []), slot.node],
                };
                continue;
            }
        }
        merged.push(slot);
    }
    return merged;
}

type TranslationTextSlotParts = Omit<TranslationTextSlot, 'node'>;

function translationTextSlotParts(
    node: Text,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
    protectionOptions?: TranslationTextProtectionOptions,
): TranslationTextSlotParts | null {
    const value = node.nodeValue ?? '';
    const match = value.match(/^(\s*)([\s\S]*?\S)(\s*)$/u);
    if (!match || isTranslationTextNodeProtected(
        node,
        shouldStayOriginal,
        ignoredExtensionElement,
        protectionOptions,
    )) return null;
    return {prefix: match[1], source: match[2], suffix: match[3]};
}

function collectSlots(
    root: HTMLElement,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
    protectionOptions?: TranslationTextProtectionOptions,
): TranslationTextSlot[] {
    const slots: TranslationTextSlot[] = [];
    const document = root.ownerDocument;
    if (!document?.createTreeWalker) return slots;
    const walker = document.createTreeWalker(root, 4);
    let current = walker.nextNode();
    while (current) {
        const node = current as Text;
        const parts = translationTextSlotParts(
            node,
            shouldStayOriginal,
            ignoredExtensionElement,
            protectionOptions,
        );
        if (parts && !isTextInNestedTranslationTooltip(node, root)) slots.push({node, ...parts});
        current = walker.nextNode();
    }
    return mergeWordContinuationSlots(slots);
}

function collectSnapshotSlots(
    liveRoot: HTMLElement,
    cloneRoot: HTMLElement,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
    protectionOptions?: TranslationTextProtectionOptions,
): TranslationTextSlot[] {
    const document = liveRoot.ownerDocument;
    if (!document?.createTreeWalker) return [];

    // cloneNode(true) 会保留文本节点的文档顺序；同步遍历两棵树可在线性复杂度内
    // 将每个实时槽映射到克隆节点，无需为每个槽重建兄弟索引路径。
    const liveWalker = document.createTreeWalker(liveRoot, 4);
    const cloneWalker = document.createTreeWalker(cloneRoot, 4);
    const slots: TranslationTextSlot[] = [];
    let liveNode = liveWalker.nextNode();
    let cloneNode = cloneWalker.nextNode();
    while (liveNode && cloneNode) {
        const parts = translationTextSlotParts(
            liveNode as Text,
            shouldStayOriginal,
            ignoredExtensionElement,
            protectionOptions,
        );
        if (parts && !isTextInNestedTranslationTooltip(liveNode, liveRoot)) slots.push({node: cloneNode as Text, ...parts});
        liveNode = liveWalker.nextNode();
        cloneNode = cloneWalker.nextNode();
    }
    // 克隆结构与实时结构一致，因此同一合并规则在两侧得出相同的槽位划分。
    return mergeWordContinuationSlots(slots);
}

/**
 * 构建本地 DOM 骨架，只暴露可翻译文本槽。因此服务响应永远不能改写链接地址、
 * 行内代码、明确退出翻译的内容、属性或带宿主页事件的节点。
 */
export function createTranslationSourceSnapshot(
    node: HTMLElement,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
    protectionOptions?: TranslationTextProtectionOptions,
    shouldOmitFromTranslation?: (element: Element) => boolean,
): TranslationSourceSnapshot {
    const clone = node.cloneNode(true) as HTMLElement;
    // 外部译文属于展示产物，不是需要保留的 code/notranslate 原文。连同其已接管
    // 的最小来源单元一起省略，防止 sanitizer 去掉标记后再次展示一份旧译文。
    if (isForeignTranslationBoundary(node)) {
        clone.replaceChildren();
        return {clone, slots: []};
    }
    // 每个槽都依据实时 composed tree 判断。脱离文档的克隆已失去站点选择器、继承
    // contenteditable 和 CSS 可见性规则所需的外部祖先，只能作为映射后的输出骨架。
    const slots = collectSnapshotSlots(
        node,
        clone,
        shouldStayOriginal,
        ignoredExtensionElement,
        protectionOptions,
    );
    // 先完成文本槽映射，再依据实时状态裁剪展示副本。仅从 provider 槽排除还不够：
    // sanitizer 会去掉宿主 class/hidden/style，并展开 textarea 等非内联标签，
    // 原本隐藏的辅助文字和编辑内容因此会意外出现在双语译文中。
    const liveElements = node.querySelectorAll('*');
    const clonedElements = clone.querySelectorAll('*');
    const omittedElements = new WeakSet<Element>();
    const formulaElements = new WeakSet<Element>();
    liveElements.forEach((element, index) => {
        const parent = element.parentElement;
        if (parent && omittedElements.has(parent)) {
            omittedElements.add(element);
            return;
        }
        if (parent && formulaElements.has(parent)) {
            formulaElements.add(element);
            return;
        }
        const formula = element.matches(sourceFormulaSelector);
        if (isTranslationTooltip(element) || isForeignTranslationBoundary(element) ||
            isHiddenTranslationElement(element) || hasContentEditableMarker(element) ||
            isIconFontElement(element) || shouldOmitFromTranslation?.(element) ||
            (!formula && isHardPruneTag(element))) {
            clonedElements[index]!.remove();
            omittedElements.add(element);
        } else if (formula) {
            formulaElements.add(element);
        }
    });
    clone.querySelectorAll(translationArtifactSelector).forEach((child) => child.remove());
    return {clone, slots};
}

export function collectLiveTranslationTextSlots(
    node: HTMLElement,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
    protectionOptions?: TranslationTextProtectionOptions,
): TranslationTextSlot[] {
    return collectSlots(
        node,
        shouldStayOriginal,
        ignoredExtensionElement,
        protectionOptions,
    );
}

/**
 * 整块降级译文：多槽候选在槽数过多时会改为一次整块请求，把整段译文放在首个槽位、
 * 其余槽位为空。此时逐槽骨架已没有对应内容，直接输出纯译文，避免整段译文被塞进
 * 首个内联元素（加粗、链接）的样式里。
 */
function isWholeBlockTranslation(snapshot: TranslationSourceSnapshot, translations: readonly string[]): boolean {
    // 长度相等且大于 1，因此索引 0 必然存在；不使用可选链，避免出现永远不可达的分支。
    return snapshot.slots.length > 1
        && translations.length === snapshot.slots.length
        && Boolean(translations[0]!.trim())
        && translations.slice(1).every((translation) => !translation);
}

/** 只修改脱离文档的快照文本节点；没有对应译文的槽位保持原文。 */
export function applyTranslationsToSnapshot(
    snapshot: TranslationSourceSnapshot,
    translations: readonly string[],
): string {
    if (isWholeBlockTranslation(snapshot, translations)) {
        const document = snapshot.clone.ownerDocument;
        snapshot.clone.replaceChildren(document.createTextNode(translations[0]!));
        return snapshot.clone.innerHTML;
    }
    snapshot.slots.forEach((slot, index) => {
        const translation = translations[index];
        if (translation === undefined) return;
        slot.node.nodeValue = `${slot.prefix}${translation}${slot.suffix}`;
        // 词内合并槽的后续节点必须清空，否则原文碎片会残留在译文行里。
        slot.continuationNodes?.forEach((node) => { node.nodeValue = ''; });
    });
    return snapshot.clone.innerHTML;
}

function isActiveLineClampValue(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (!normalized || ['none', 'normal', 'auto', 'unset', 'initial'].includes(normalized)) return false;
    const lineCount = Number.parseFloat(normalized);
    return Number.isFinite(lineCount) && lineCount > 0;
}

export function hasActiveTranslationLineClamp(element: HTMLElement): boolean {
    try {
        const style = element.ownerDocument?.defaultView?.getComputedStyle(element);
        if (!style) return false;
        return [
            style.webkitLineClamp,
            style.getPropertyValue('-webkit-line-clamp'),
            style.getPropertyValue('line-clamp'),
        ].some(isActiveLineClampValue);
    } catch {
        return false;
    }
}

export function hasActiveTranslationTruncation(element: HTMLElement): boolean {
    if (hasActiveTranslationLineClamp(element)) return true;
    try {
        const style = element.ownerDocument?.defaultView?.getComputedStyle(element);
        if (!style) return false;
        const maxHeight = style.maxHeight.trim().toLowerCase();
        if (!maxHeight || ['none', 'auto', 'unset', 'initial', 'max-content'].includes(maxHeight)) return false;
        const overflow = (style.overflowY || style.overflow).trim().toLowerCase();
        return ['hidden', 'clip'].includes(overflow) &&
            element.scrollHeight > element.clientHeight + 1;
    } catch {
        return false;
    }
}
