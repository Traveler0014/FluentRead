import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {
        disableSelectionTranslator: false,
        selectionTranslatorMode: 'bilingual',
    },
    createVueShadowUi: vi.fn(),
    createModalDialogHostController: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({config: mocks.config}));
vi.mock('@/src/platform/shadow-ui', () => ({createVueShadowUi: mocks.createVueShadowUi}));
vi.mock('@/src/features/selection-translation/content/modalDialogHost', () => ({
    createModalDialogHostController: mocks.createModalDialogHostController,
}));
vi.mock('@/src/features/selection-translation/ui/SelectionTranslator.vue', () => ({default: {name: 'SelectionTranslator'}}));

interface MockUi {
    mounted?: {app?: unknown; instance?: unknown};
    remove: ReturnType<typeof vi.fn>;
}

function ui(instance: unknown = {feature: 'mounted'}): MockUi {
    return {
        mounted: {app: {unmount: vi.fn()}, instance},
        remove: vi.fn(),
    };
}

function pendingUi(): {
    promise: Promise<MockUi>;
    resolve: (value: MockUi) => void;
} {
    let resolve!: (value: MockUi) => void;
    return {
        promise: new Promise<MockUi>((done) => {
            resolve = done;
        }),
        resolve,
    };
}

beforeEach(() => {
    vi.resetModules();
    mocks.createVueShadowUi.mockReset();
    mocks.createModalDialogHostController.mockReset();
    mocks.config.disableSelectionTranslator = false;
    mocks.config.selectionTranslatorMode = 'bilingual';
    vi.stubGlobal('document', {getElementById: vi.fn(() => null)});
});

describe('划词翻译挂载生命周期', () => {
    it('选区仅转发给当前 host，卸载先恢复 modal 所有权再移除界面', async () => {
        const pending = pendingUi();
        const shadowHost = {style: {setProperty: vi.fn()}};
        const controller = {placeForRange: vi.fn(), dispose: vi.fn()};
        const mountedUi = {...ui(), shadowHost};
        mocks.createModalDialogHostController.mockReturnValue(controller);
        mocks.createVueShadowUi.mockReturnValue(pending.promise);
        const runtime = await import('@/src/features/selection-translation/content/runtime');
        const request = runtime.mountSelectionTranslator({} as never);
        const reportRange = mocks.createVueShadowUi.mock.calls[0][1].props.onSelectionRangeChange;
        const range = {startContainer: {nodeType: 3}};

        reportRange(range);
        expect(controller.placeForRange).not.toHaveBeenCalled();
        pending.resolve(mountedUi);
        await request;
        expect(shadowHost.style.setProperty).toHaveBeenCalledWith('position', 'static', 'important');
        expect(mocks.createModalDialogHostController).toHaveBeenCalledWith(shadowHost);
        reportRange(range);
        reportRange(null);
        expect(controller.placeForRange.mock.calls).toEqual([[range], [null]]);

        runtime.unmountSelectionTranslator();
        expect(controller.dispose).toHaveBeenCalledOnce();
        expect(controller.dispose.mock.invocationCallOrder[0]).toBeLessThan(mountedUi.remove.mock.invocationCallOrder[0]);
        reportRange(range);
        expect(controller.placeForRange).toHaveBeenCalledTimes(2);
    });

    it('不完整挂载句柄缺少 host 样式时仍可安全卸载', async () => {
        const mountedUi = {...ui(), shadowHost: {}};
        mocks.createVueShadowUi.mockResolvedValue(mountedUi);
        const runtime = await import('@/src/features/selection-translation/content/runtime');
        await runtime.mountSelectionTranslator({} as never);
        expect(mocks.createModalDialogHostController).not.toHaveBeenCalled();
        runtime.unmountSelectionTranslator();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });

    it('没有内容脚本上下文或功能关闭时不挂载', async () => {
        const runtime = await import('@/src/features/selection-translation/content/runtime');

        expect(runtime.mountSelectionTranslator()).toBeUndefined();
        mocks.config.disableSelectionTranslator = true;
        expect(runtime.mountSelectionTranslator({} as never)).toBeNull();
        mocks.config.disableSelectionTranslator = false;
        mocks.config.selectionTranslatorMode = 'disabled';
        expect(runtime.mountSelectionTranslator({} as never)).toBeNull();
        expect(mocks.createVueShadowUi).not.toHaveBeenCalled();
    });

    it('只创建一个关闭 Shadow DOM，并在卸载时清理', async () => {
        const mountedUi = ui();
        mocks.createVueShadowUi.mockResolvedValue(mountedUi);
        const runtime = await import('@/src/features/selection-translation/content/runtime');
        const context = {name: 'content'} as never;

        await expect(runtime.mountSelectionTranslator(context)).resolves.toEqual({feature: 'mounted'});
        expect(mocks.createVueShadowUi).toHaveBeenCalledWith(context, expect.objectContaining({
            name: 'fluent-read-selection-translator-ui',
            hostId: 'fluent-read-selection-translator-container',
            zIndex: 2_147_483_646,
            mode: 'closed',
        }));
        expect(runtime.mountSelectionTranslator()).toBeNull();

        runtime.unmountSelectionTranslator();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
        runtime.unmountSelectionTranslator();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });

    it('复用正在挂载的请求，并丢弃卸载后的迟到结果', async () => {
        const pending = pendingUi();
        const mountedUi = ui();
        mocks.createVueShadowUi.mockReturnValue(pending.promise);
        const runtime = await import('@/src/features/selection-translation/content/runtime');

        const request = runtime.mountSelectionTranslator({} as never);
        expect(runtime.mountSelectionTranslator()).toBe(request);
        runtime.unmountSelectionTranslator();
        pending.resolve(mountedUi);

        await expect(request).resolves.toBeNull();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });

    it.each([
        ['disableSelectionTranslator', true],
        ['selectionTranslatorMode', 'disabled'],
    ] as const)('挂载期间配置字段 %s 关闭时移除迟到界面', async (key, value) => {
        const pending = pendingUi();
        const mountedUi = ui();
        mocks.createVueShadowUi.mockReturnValue(pending.promise);
        const runtime = await import('@/src/features/selection-translation/content/runtime');

        const request = runtime.mountSelectionTranslator({} as never);
        mocks.config[key] = value as never;
        pending.resolve(mountedUi);

        await expect(request).resolves.toBeNull();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });

    it('允许挂载器返回没有 Vue 实例的安全空结果', async () => {
        const mountedUi = {remove: vi.fn()};
        mocks.createVueShadowUi.mockResolvedValue(mountedUi);
        const runtime = await import('@/src/features/selection-translation/content/runtime');

        await expect(runtime.mountSelectionTranslator({} as never)).resolves.toBeNull();
        runtime.unmountSelectionTranslator();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });
});
