import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {describe, expect, it} from 'vitest';
import {remoteConfigStorageBuildPlugin, createExtensionManifest, extendRemoteConfigBuildConfig} from '@/wxt.config';

const PROJECT_ROOT = resolve(__dirname, '..');

function sourceBody(path: string): string {
    const source = readFileSync(resolve(PROJECT_ROOT, path), 'utf8');
    const header = source.match(/^\/\*\*[\s\S]*?\*\/\s*/u)?.[0];
    return header?.includes(`@file ${path}`) ? source.slice(header.length) : source;
}

function permissionsFor(browser: string, manifestVersion: 2 | 3): string[] {
    const manifest = createExtensionManifest({browser, manifestVersion} as Parameters<typeof createExtensionManifest>[0]);
    return manifest.permissions as string[];
}

describe('extension manifest capability contract', () => {
    it('仅旧 QQ 阅读入口启用子 frame 注入，通用网页仍保持顶层注入', () => {
        const entry = sourceBody('entrypoints/qqMailFrame.content.ts');
        expect(entry).toContain("matches: ['https://mail.qq.com/cgi-bin/readmail*']");
        expect(entry).toContain('allFrames: true');
        expect(entry).not.toContain('matchAboutBlank');
        expect(entry).not.toContain('matchOriginAsFallback');
        expect(sourceBody('entrypoints/content.ts')).not.toContain('allFrames');
    });

    it('通用网页内容脚本在基础 DOM 出现前注入，让 loading 页面也能建立翻译入口', () => {
        expect(sourceBody('entrypoints/content.ts')).toContain("runAt: 'document_start'");
    });

    it('declares the literal all-URLs host permission required by captureVisibleTab', () => {
        for (const [browser, manifestVersion] of [
            ['chrome', 3],
            ['edge', 3],
            ['firefox', 2],
        ] as const) {
            const manifest = createExtensionManifest({browser, manifestVersion} as Parameters<typeof createExtensionManifest>[0]);
            expect(manifest.host_permissions, `${browser}-mv${manifestVersion}`).toContain('<all_urls>');
        }
    });

    it('declares Offscreen exactly once only for supported Chrome and Edge MV3 builds', () => {
        for (const [browser, manifestVersion, expected] of [
            ['chrome', 3, 1],
            ['edge', 3, 1],
            ['chrome', 2, 0],
            ['firefox', 2, 0],
            ['firefox', 3, 0],
            ['opera', 3, 0],
        ] as const) {
            const permissions = permissionsFor(browser, manifestVersion);
            expect(permissions.filter((permission) => permission === 'offscreen'), `${browser}-mv${manifestVersion}`)
                .toHaveLength(expected);
            expect(permissions).toEqual(expect.arrayContaining([
                'storage',
                'unlimitedStorage',
                'alarms',
                'contextMenus',
            ]));
        }
    });

    it('keeps the Offscreen page entrypoint target-limited and delegates to the app composition root', () => {
        const html = readFileSync(resolve(PROJECT_ROOT, 'entrypoints/offscreen/index.html'), 'utf8');
        const main = sourceBody('entrypoints/offscreen/main.ts');
        expect(html).toContain('<meta name="wxt.include" content="[\'chrome\', \'edge\', \'firefox\']">');
        expect(html).toContain('<script type="module" src="./main.ts"></script>');
        expect(html).not.toContain('opera');
        expect(main).toBe(
            "import {startOffscreenApp} from '@/src/app/offscreen/runtime';\n\nstartOffscreenApp();\n",
        );
    });

    it('uses the capability-derived manifest factory instead of a static Offscreen permission', () => {
        const source = readFileSync(resolve(PROJECT_ROOT, 'wxt.config.ts'), 'utf8');
        expect(source).toContain('manifest: createExtensionManifest');
        expect(source).toContain("...(capabilities.offscreenDocument ? ['offscreen'] : [])");
        expect(source).not.toContain("permissions: ['storage', 'alarms', 'contextMenus', 'offscreen']");
    });

    it('只给 Firefox 声明稳定 AMO 身份、最低版本和准确的数据传输分类', () => {
        const firefox = createExtensionManifest({browser: 'firefox', manifestVersion: 2} as never) as any;
        const chrome = createExtensionManifest({browser: 'chrome', manifestVersion: 3} as never) as any;

        expect(firefox.browser_specific_settings?.gecko).toEqual({
            id: '{3096bd53-3bda-4556-b076-ebf47442a5c1}',
            strict_min_version: '140.0',
            data_collection_permissions: {
                required: ['websiteContent', 'authenticationInfo', 'personalCommunications'],
            },
        });
        expect(chrome.browser_specific_settings).toBeUndefined();
    });

    it('固定发布包英文名称，并为 Firefox 保留共享 OCR 资产', () => {
        const source = readFileSync(resolve(PROJECT_ROOT, 'wxt.config.ts'), 'utf8');

        expect(source).toContain("name: 'fluent-read'");
        expect(source).toContain("excludeSources: ['coverage/**']");
        expect(source).toContain("'build:publicAssets'");
        expect(source).not.toContain("files.splice(index, 1)");
    });

    it('拒绝当前版本的非期望 Firefox 归档名，但允许其他版本归档留存', async () => {
        const verifierUrl = pathToFileURL(
            resolve(PROJECT_ROOT, 'scripts/testing/verify-extension-manifests.mjs'),
        ).href;
        const verifier = await import(/* @vite-ignore */ verifierUrl) as {
            findUnexpectedCurrentVersionArchives(
                files: string[],
                version: string,
                expected: string[],
            ): string[];
        };
        const expected = [
            'fluent-read-0.0.35-firefox.zip',
            'fluent-read-0.0.35-sources.zip',
        ];

        expect(verifier.findUnexpectedCurrentVersionArchives([
            ...expected,
            '-0.0.30-firefox.zip',
            'legacy-10.0.35-sources.zip',
        ], '0.0.35', expected)).toEqual([]);
        expect(verifier.findUnexpectedCurrentVersionArchives([
            ...expected,
            '-0.0.35-firefox.zip',
            'legacy-v0.0.35-sources.zip',
            'fluent-read-0.0.30-firefox.zip',
        ], '0.0.35', expected)).toEqual([
            '-0.0.35-firefox.zip',
            'legacy-v0.0.35-sources.zip',
        ]);
    });

    it('网页及扩展 UI 构建组使用远程配置存储，后台和未知入口保留完整运行时', () => {
        const plugin = remoteConfigStorageBuildPlugin();
        expect(plugin.enforce).toBe('pre');
        expect(plugin.resolveId(resolve(PROJECT_ROOT, 'src/platform/storage/configStorageRuntime')))
            .toBe(resolve(PROJECT_ROOT, 'src/platform/storage/remoteConfigStorageRuntime.ts'));
        expect(plugin.resolveId(resolve(PROJECT_ROOT, 'src/platform/storage/configStorageRuntime.ts')))
            .toBe(resolve(PROJECT_ROOT, 'src/platform/storage/remoteConfigStorageRuntime.ts'));
        expect(plugin.resolveId(resolve(PROJECT_ROOT, 'src/platform/storage/configStorage.ts'))).toBeNull();

        const contentGroup: {plugins?: unknown[]} = {plugins: ['existing']};
        extendRemoteConfigBuildConfig([{type: 'content-script'}, {type: 'content-script'}], contentGroup);
        expect(contentGroup.plugins).toEqual(['existing', expect.objectContaining({name: 'fluentread-remote-config-storage'})]);
        const emptyPlugins: {plugins?: unknown[]} = {};
        extendRemoteConfigBuildConfig([{type: 'content-script'}], emptyPlugins);
        expect(emptyPlugins.plugins).toHaveLength(1);

        for (const group of [[{type: 'popup'}], [{type: 'options'}], [{type: 'popup'}, {type: 'options'}, {type: 'unlisted-page'}]]) {
            const config: {plugins?: unknown[]} = {plugins: []};
            extendRemoteConfigBuildConfig(group, config);
            expect(config.plugins).toHaveLength(1);
        }
        for (const group of [[], [{type: 'background'}], [{type: 'options'}, {type: 'background'}], [{type: 'content-script'}, {type: 'unlisted-script'}], [{type: 'unknown'}]]) {
            const config: {plugins?: unknown[]} = {plugins: []};
            extendRemoteConfigBuildConfig(group, config);
            expect(config.plugins).toEqual([]);
        }
    });
});
