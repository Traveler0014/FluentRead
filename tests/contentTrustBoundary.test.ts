import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('host-page trust boundary', () => {
  it('does not expose page-dispatchable configuration or full-page controls', () => {
    const content = [
      source('entrypoints/content.ts'),
      source('src/app/content/runtime.ts'),
      source('src/app/content/hotkeyRuntime.ts'),
      source('src/app/content/messageRuntime.ts'),
      source('src/features/hover-translation/content/index.ts'),
      source('src/features/input-translation/content/index.ts'),
    ].join('\n');
    const floatingBall = source('src/features/floating-ball/ui/FloatingBall.vue');
    const hotkeyRuntime = source('src/app/content/hotkeyRuntime.ts');

    expect(existsSync(resolve(process.cwd(), 'entrypoints/utils/newApi.ts'))).toBe(false);
    expect(content).not.toContain('fluent:prefill');
    expect(content).not.toContain('fluentread-toggle-translation');
    expect(floatingBall).not.toContain('fluentread-toggle-translation');
    expect(hotkeyRuntime).not.toContain('toggleFloatingBallTranslation()');
    expect(hotkeyRuntime).toContain('if (isFullPageTranslationActive()) restoreOriginalContent();');
  });

  it('rejects synthetic input before network and screenshot side effects', () => {
    const content = [
      source('entrypoints/content.ts'),
      source('src/app/content/runtime.ts'),
      source('src/app/content/hotkeyRuntime.ts'),
      source('src/app/content/messageRuntime.ts'),
      source('src/features/hover-translation/content/index.ts'),
      source('src/features/input-translation/content/index.ts'),
    ].join('\n');
    const selection = source('src/features/selection-translation/ui/SelectionTranslator.vue');

    expect(content.match(/if \(!event\.isTrusted\) return;/g)?.length).toBeGreaterThanOrEqual(10);
    expect(selection).toContain('TRUSTED_SELECTION_INTERACTION_GRACE_MS');
  });

  it('keeps privileged controls and translated bitmaps out of page-visible shadow roots', () => {
    expect(source('src/features/floating-ball/content/runtime.ts')).toContain("mode: 'closed'");
    expect(source('src/features/selection-translation/content/runtime.ts')).toContain("mode: 'closed'");
    expect(source('src/features/input-translation/content/index.ts')).toContain("mode: 'closed'");
  });

  it('keeps selection UI wheel handling out of the host document', () => {
    const selection = source('src/features/selection-translation/ui/SelectionTranslator.vue');

    expect(selection).toContain('@wheel.stop.passive="handleUiWheel"');
    expect(selection).not.toContain("document.addEventListener('wheel'");
    expect(selection).not.toContain("document.removeEventListener('wheel'");
  });
});
