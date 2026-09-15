import {beforeEach, describe, expect, it, vi} from 'vitest';

const runtime = vi.hoisted(() => ({
    slots: [] as Array<{node: Text; prefix: string; source: string; suffix: string; continuationNodes?: readonly Text[]}>,
    translations: [] as string[],
    translateTextSlots: vi.fn(),
    getCurrentTranslationCore: vi.fn(() => ({shouldStayOriginal: () => false})),
}));

vi.mock('@/src/core/translation/public', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/src/core/translation/public')>();
    return {
        collectLiveTranslationTextSlots: () => runtime.slots,
        getCurrentTranslationCore: runtime.getCurrentTranslationCore,
        // 属性型按钮标签的安全边界由 core 唯一定义，测试不复制其判定规则。
        getTranslatableControlValueAttribute: actual.getTranslatableControlValueAttribute,
        // 槽位展平规则同样来自 core，测试只替换槽位收集本身。
        getTranslationSlotTextNodes: actual.getTranslationSlotTextNodes,
        normalizeTranslationText: actual.normalizeTranslationText,
    };
});

vi.mock('@/src/features/full-page-translation/content/translationRequest', () => ({
    translateTextSlots: runtime.translateTextSlots,
}));

import {parseHTML} from 'linkedom';
import {createTranslationRequest, translateControlValue, translateLiveText} from '@/src/features/full-page-translation/content/liveTextTranslation';

const snapshot = {service: 'microsoft', model: 'default', thinking: false, sourceLanguage: 'en', targetLanguage: 'zh',
    useCache: true, enableAIContext: false, enableAIMultiSegment: false, displayMode: 'single' as const, style: 0};

describe('实时文本翻译快照', () => {
    beforeEach(() => {
        runtime.slots = [];
        runtime.translations = [];
        runtime.translateTextSlots.mockReset();
        runtime.translateTextSlots.mockImplementation(async () => runtime.translations);
    });

    it('正文双语请求只提交可译文本槽，空内容不调用服务', async () => {
        const {document} = parseHTML('<html><body><p>Source text</p></body></html>');
        const owner = document.querySelector('p')!;
        expect(await createTranslationRequest(owner, 'content', 'bilingual', snapshot)).toEqual({kind: 'snapshot', sources: [], translations: []});
        expect(runtime.translateTextSlots).not.toHaveBeenCalled();
        runtime.slots = [{node: owner.firstChild as Text, prefix: '', source: 'Source text', suffix: ''}];
        runtime.translations = ['来源文字'];
        const result = await createTranslationRequest(owner, 'content', 'bilingual', snapshot, undefined, undefined, undefined, undefined, true, 'all');
        expect(result).toEqual({kind: 'snapshot', sources: ['Source text'], translations: ['来源文字']});
        expect(runtime.getCurrentTranslationCore).toHaveBeenLastCalledWith('all');
        expect(runtime.translateTextSlots).toHaveBeenLastCalledWith(['Source text'], snapshot, undefined, undefined, undefined, true);
        expect(owner.textContent).toBe('Source text');
    });

    it.each([{kind: 'content', mode: 'single'}, {kind: 'control', mode: 'bilingual'}] as const)(
        '$kind / $mode 请求返回原位 Text 槽并保留 all 范围', async ({kind, mode}) => {
            const {document} = parseHTML('<html><body><button>Execute</button></body></html>');
            const owner = document.querySelector('button')!;
            runtime.slots = [{node: owner.firstChild as Text, prefix: '', source: 'Execute', suffix: ''}];
            runtime.translations = ['执行'];
            const result = await createTranslationRequest(owner, kind, mode, snapshot, undefined, undefined, undefined, undefined, false, 'all');
            expect(result).toMatchObject({kind: 'live-text', changed: true, sources: ['Execute'], translations: ['执行']});
            expect(runtime.getCurrentTranslationCore).toHaveBeenLastCalledWith('all');
            expect(owner.textContent).toBe('Execute');
        },
    );

    it('按钮型 input 走属性替换请求，不再尝试寻找不存在的文本槽', async () => {
        const {document} = parseHTML('<html><body><input type="button" value="Preview changes"></body></html>');
        const owner = document.querySelector<HTMLElement>('input')!;
        runtime.translations = ['预览更改'];

        const result = await createTranslationRequest(owner, 'control', 'bilingual', snapshot);
        expect(result).toEqual({
            kind: 'control-value', attribute: 'value', complete: true, changed: true,
            sources: ['Preview changes'], translations: ['预览更改'], text: '预览更改',
        });
        expect(runtime.translateTextSlots).toHaveBeenLastCalledWith(
            ['Preview changes'], snapshot, undefined, undefined, undefined, false);
        // 请求阶段绝不改写宿主属性，写入由渲染层在提交时完成。
        expect(owner.getAttribute('value')).toBe('Preview changes');
    });

    it('按钮标签缺失或译文与原文相同时结果标记为未完成或无变化', async () => {
        const {document} = parseHTML('<html><body><input id="a" type="button" value="Preview changes">' +
            '<input id="b" type="button"></body></html>');
        const labelled = document.querySelector<HTMLElement>('#a')!;
        const missing = document.querySelector<HTMLElement>('#b')!;

        runtime.translations = ['Preview changes'];
        expect(await translateControlValue(labelled, 'value', snapshot))
            .toMatchObject({complete: true, changed: false, text: 'Preview changes'});

        runtime.translations = [];
        expect(await translateControlValue(missing, 'value', snapshot))
            .toMatchObject({complete: false, changed: false, sources: [''], text: ''});
    });

    it('空槽位返回未完成的空结果', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        const result = await translateLiveText(document.body, snapshot);
        expect(result).toMatchObject({kind: 'live-text', complete: false, changed: false, sources: [], translations: []});
        expect(result.nodes).toEqual([]);
        expect(result.slots).toEqual([]);
        expect(runtime.translateTextSlots).not.toHaveBeenCalled();
    });

    it('保留槽位前后缀，并区分 unchanged、changed 与不完整响应', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        const node = document.createTextNode('source');
        runtime.slots = [{node, prefix: '[', source: 'source', suffix: ']'}];

        runtime.translations = ['source'];
        const unchanged = await translateLiveText(document.body, snapshot);
        expect(unchanged).toMatchObject({complete: true, changed: false, sources: ['source'], translations: ['source']});
        expect(unchanged.slots[0]?.text).toBe('[source]');

        runtime.translations = ['译文'];
        const changed = await translateLiveText(document.body, snapshot);
        expect(changed).toMatchObject({complete: true, changed: true, sources: ['source'], translations: ['译文']});
        expect(changed.slots[0]?.text).toBe('[译文]');

        runtime.translations = [];
        const incomplete = await translateLiveText(document.body, snapshot);
        expect(incomplete.complete).toBe(false);
        expect(incomplete.slots[0]?.text).toBe('[source]');

        runtime.slots = [{node, prefix: '', source: '', suffix: ''}];
        runtime.translations = ['译文'];
        expect((await translateLiveText(document.body, snapshot)).changed).toBe(true);
    });

    it('词内合并槽只把译文写回首节点，后续节点清空', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        const first = document.createTextNode('one');
        const continuation = document.createTextNode('’');
        const tail = document.createTextNode('s');
        runtime.slots = [{
            node: first,
            prefix: '',
            source: 'one’s',
            suffix: '',
            continuationNodes: [continuation, tail],
        }];
        runtime.translations = ['一个的'];

        const result = await translateLiveText(document.body, snapshot);
        // 单槽候选不会走整块请求，逐槽回填仍按合并槽展平到每个节点。
        expect(runtime.translateTextSlots).toHaveBeenCalledWith(['one’s'], snapshot, undefined, undefined, undefined, false);
        expect(result).toMatchObject({complete: true, changed: true, sources: ['one’s'], translations: ['一个的'],
            nodes: [first, continuation, tail]});
        expect(result.slots).toEqual([
            {node: first, text: '一个的'},
            {node: continuation, text: ''},
            {node: tail, text: ''},
        ]);
    });

    it('机器翻译服务把多片段候选整块送出，译文只回填首个槽位', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        const first = document.createTextNode('Read ');
        const second = document.createTextNode('the guide');
        const third = document.createTextNode('.');
        runtime.slots = [
            {node: first, prefix: '', source: 'Read', suffix: ' '},
            {node: second, prefix: '', source: 'the guide', suffix: ''},
            {node: third, prefix: '', source: '.', suffix: ''},
        ];
        runtime.translations = ['读完这份指南。'];

        const result = await createTranslationRequest(document.body, 'content', 'bilingual', snapshot);
        expect(runtime.translateTextSlots).toHaveBeenCalledWith(
            ['Read the guide.'], snapshot, undefined, undefined, undefined, false);
        expect(result).toEqual({
            kind: 'snapshot',
            sources: ['Read', 'the guide', '.'],
            translations: ['读完这份指南。', '', ''],
        });
    });

    it('整块译文缺失时回退逐槽请求，与原文相同时按未变化处理', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        const first = document.createTextNode('Read ');
        const second = document.createTextNode('the guide');
        runtime.slots = [
            {node: first, prefix: '', source: 'Read', suffix: ' '},
            {node: second, prefix: '', source: 'the guide', suffix: ''},
        ];

        runtime.translateTextSlots.mockResolvedValueOnce(['']).mockResolvedValueOnce(['译:Read', '译:the guide']);
        expect(await createTranslationRequest(document.body, 'content', 'bilingual', snapshot))
            .toEqual({kind: 'snapshot', sources: ['Read', 'the guide'], translations: ['译:Read', '译:the guide']});

        // 整块结果与原文一致时不重发逐槽请求，直接按未变化上报。
        runtime.translateTextSlots.mockReset();
        runtime.translateTextSlots.mockResolvedValueOnce(['Read']);
        expect(await createTranslationRequest(document.body, 'content', 'bilingual', snapshot))
            .toEqual({kind: 'snapshot', sources: ['Read', 'the guide'], translations: ['Read', 'the guide']});
        expect(runtime.translateTextSlots).toHaveBeenCalledTimes(1);

        // 单槽候选不会走整块请求，AI 服务保留逐槽回填以维持内联结构。
        runtime.translateTextSlots.mockReset();
        runtime.translateTextSlots.mockResolvedValue(['译:Read']);
        runtime.slots = [{node: first, prefix: '', source: 'Read', suffix: ' '}];
        expect(await createTranslationRequest(document.body, 'content', 'bilingual', snapshot))
            .toEqual({kind: 'snapshot', sources: ['Read'], translations: ['译:Read']});
        runtime.slots = [{node: first, prefix: '', source: 'Read', suffix: ' '}, {node: second, prefix: '', source: 'the guide', suffix: ''}];
        expect(await createTranslationRequest(document.body, 'content', 'bilingual',
            {...snapshot, service: 'openai', model: 'gpt-4o'}))
            .toEqual({kind: 'snapshot', sources: ['Read', 'the guide'], translations: ['译:Read']});
    });

    it('仅译文模式同样按整块降级回填槽位与节点集合', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        const first = document.createTextNode('Read ');
        const second = document.createTextNode('the guide');
        runtime.slots = [
            {node: first, prefix: '', source: 'Read', suffix: ' '},
            {node: second, prefix: '', source: 'the guide', suffix: ''},
        ];
        runtime.translations = ['读完这份指南。', ''];

        const result = await translateLiveText(document.body, snapshot);
        expect(runtime.translateTextSlots).toHaveBeenCalledWith(
            ['Read the guide'], snapshot, undefined, undefined, undefined, false);
        expect(result).toMatchObject({
            complete: true,
            changed: true,
            sources: ['Read', 'the guide'],
            translations: ['读完这份指南。', ''],
            nodes: [first, second],
        });
        expect(result.slots).toEqual([
            {node: first, text: '读完这份指南。 '},
            {node: second, text: ''},
        ]);
    });
});
