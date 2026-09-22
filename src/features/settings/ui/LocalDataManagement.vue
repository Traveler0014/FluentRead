<!--
@file src/features/settings/ui/LocalDataManagement.vue
文件职责：在备份与恢复页提供唯一的 FluentRead 数据迁移入口。
主要内容：将设置和模型用量导出为一份版本化备份，自动识别完整备份与旧版单项文件，并在导入前预览影响。
模块边界：组件只编排 runtime 协议和文件交互；各领域仓库继续拥有校验与合并规则。
Lite 说明：本分支移除了单词本，备份与恢复只处理设置和模型用量。
-->
<template>
  <div class="local-data-management">
    <SettingsGroup
      title="完整备份"
      description="一份备份包含设置和模型用量。"
    >
      <div class="transfer-row featured-transfer">
        <div class="transfer-identity">
          <span class="transfer-icon" aria-hidden="true"><UiIcon name="history" /></span>
          <div class="transfer-copy">
            <strong>设置与本机记录</strong>
            <small>更换浏览器或重装扩展前，导出一份文件即可恢复。</small>
          </div>
        </div>
        <div class="transfer-actions">
          <el-button :loading="busy" @click="exportCompleteBackup($event)"><Download />导出备份</el-button>
          <el-button type="primary" :disabled="busy" @click="openRestoreSource($event)"><Upload />从备份恢复</el-button>
        </div>
      </div>
      <p class="transfer-warning">备份包含 API Key 和其他私密设置，文件不加密，请只保存在可信位置。翻译缓存不会进入备份。</p>
    </SettingsGroup>

    <input
      ref="data-import-input"
      hidden
      type="file"
      accept="application/json,.json"
      @change="readImportFile"
    />

    <el-dialog
      v-model="restoreSourceVisible"
      title="从备份恢复"
      width="min(600px, calc(100vw - 32px))"
      data-testid="restore-source-dialog"
      :close-on-click-modal="!busy"
      :close-on-press-escape="!busy"
      :show-close="!busy"
      @closed="clearRestoreSource"
    >
      <div class="restore-file-choice">
        <div>
          <strong>选择备份文件</strong>
          <small>支持 FluentRead 完整备份，也会自动识别旧版 JSON 文件。</small>
        </div>
        <el-button type="primary" :disabled="busy" @click="chooseImport($event)">选择文件</el-button>
      </div>
      <details class="legacy-paste">
        <summary>粘贴旧版配置 JSON</summary>
        <p>如果你以前使用“导出配置”复制了 JSON，可以直接粘贴在这里。</p>
        <el-input
          v-model="pastedJson"
          type="textarea"
          :rows="8"
          placeholder="粘贴 FluentRead JSON"
          aria-label="粘贴 FluentRead JSON"
        />
        <div class="legacy-paste-actions">
          <el-button :disabled="busy || !pastedJson.trim()" @click="previewPastedImport($event)">预览恢复内容</el-button>
        </div>
      </details>
    </el-dialog>

    <el-dialog
      v-model="importPreviewVisible"
      title="导入前确认"
      width="min(720px, calc(100vw - 32px))"
      destroy-on-close
      :close-on-click-modal="!busy"
      :close-on-press-escape="!busy"
      :show-close="!busy"
      data-testid="local-data-import-dialog"
      @closed="clearImportPreview"
    >
      <template v-if="pendingImport && importSummary">
        <div class="import-file-summary">
          <div>
            <span>{{ importKindLabel }}</span>
            <strong>{{ pendingFileName }}</strong>
          </div>
          <small>{{ formatFileSize(pendingFileSize) }}</small>
        </div>

        <div class="import-section-grid">
          <article :class="{ muted: !importSummary.configIncluded }">
            <span>设置与凭据</span>
            <strong>{{ importSummary.configIncluded ? (configChangeCount ? `${configChangeCount} 项设置或凭据变化` : '设置与凭据相同') : '不包含' }}</strong>
            <small>{{ importSummary.configIncluded ? '备份中的凭据会一并应用，具体内容不会显示' : '当前设置保持不变' }}</small>
          </article>
          <article :class="{ muted: importSummary.modelUsageEvents === 0 && pendingImport.kind !== 'complete' }">
            <span>模型用量</span>
            <strong>{{ importSummary.modelUsageEvents }} 条记录</strong>
            <small>已有记录不会重复</small>
          </article>
        </div>

        <section v-if="importSummary.configIncluded" class="config-import-preview" aria-labelledby="migration-config-preview-title">
          <header>
            <div>
              <span>设置差异</span>
              <strong id="migration-config-preview-title">导入后会发生什么</strong>
            </div>
            <b>{{ configChangeCount }} 项需确认</b>
          </header>
          <div v-if="configPreviewDiff.groups.length || credentialPreviewChanges.length" class="config-change-list">
            <section v-for="group in configPreviewDiff.groups" :key="group.id" class="config-change-group">
              <h4>{{ group.label }}<span>{{ group.changes.length }}</span></h4>
              <article v-for="change in group.changes" :key="change.key">
                <strong>{{ change.label }}</strong>
                <div><span>当前</span><p>{{ change.before }}</p></div>
                <div><span>导入后</span><p>{{ change.after }}</p></div>
              </article>
            </section>
            <section v-if="credentialPreviewChanges.length" class="config-change-group">
              <h4>凭据安全<span>{{ credentialPreviewChanges.length }}</span></h4>
              <article v-for="change in credentialPreviewChanges" :key="change.key">
                <strong>{{ change.label }}</strong>
                <div><span>当前</span><p>{{ change.before }}</p></div>
                <div><span>导入后</span><p>{{ change.after }}</p></div>
              </article>
            </section>
          </div>
          <p v-else class="config-same">普通设置和凭据与当前状态相同。</p>
        </section>

        <p class="import-boundary">
          {{ importBoundary }}
        </p>
      </template>
      <template #footer>
        <el-button :disabled="busy" @click="importPreviewVisible = false">取消</el-button>
        <el-button type="primary" :loading="busy" :disabled="!pendingImport" @click="applyPendingImport">确认导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import UiIcon from '@/src/ui/components/UiIcon.vue'
import {computed, nextTick, ref, shallowRef, useTemplateRef} from 'vue';
import {Download, Upload} from '@element-plus/icons-vue';
import {ElMessage, ElMessageBox} from 'element-plus';
import browser from 'webextension-polyfill';
import {buildConfigDiff} from '@/src/core/config/diff';
import type {Config} from '@/src/core/config/model';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {
  createFluentReadDataBackup,
  parseLocalDataImport,
  resolveBackupConfigCredentialMode,
  summarizeLocalDataImport,
  type LocalDataImport,
  usesExactCredentialReplacement,
} from '@/src/features/settings/model/dataBackup';
import {buildCredentialPreviewChanges} from '@/src/features/settings/model/credentialPreview';
import type {ModelUsageImportResult, ModelUsageTransferDocument} from '@/src/services/model-usage/types';
import {prepareHydratedConfigForExport, requestConfigSave} from '@/src/services/config';
import {toRestorableConfig} from '@/src/services/config/history';
import SettingsGroup from './components/SettingsGroup.vue';

const props = defineProps<{config: Config}>();
const importInput = useTemplateRef<HTMLInputElement>('data-import-input');
const busy = ref(false);
const restoreSourceVisible = ref(false);
const pastedJson = ref('');
const pendingImport = shallowRef<LocalDataImport | null>(null);
const pendingFileName = ref('');
const pendingFileSize = ref(0);
const importPreviewVisible = ref(false);
const sendRuntimeMessage = browser.runtime.sendMessage.bind(browser.runtime);
let importTrigger: HTMLElement | null = null;
let restoreActionTrigger: HTMLElement | null = null;

const importSummary = computed(() => pendingImport.value ? summarizeLocalDataImport(pendingImport.value) : null);
function prepareImportedConfig(target: LocalDataImport | null, current: Config): Config | null {
  if (target?.kind === 'complete') {
    return prepareConfigForImport(target.backup.config, current, {
      credentialMode: resolveBackupConfigCredentialMode(target.backup),
    });
  }
  if (target?.kind === 'config') return prepareConfigForImport(target.config, current);
  return null;
}
const importedConfig = computed(() => prepareImportedConfig(pendingImport.value, props.config));
const configPreviewDiff = computed(() => buildConfigDiff(
  toRestorableConfig(props.config),
  toRestorableConfig(importedConfig.value),
));
const credentialPreviewChanges = computed(() => importedConfig.value
  ? buildCredentialPreviewChanges(props.config, importedConfig.value)
  : []);
const configChangeCount = computed(() => configPreviewDiff.value.changeCount + credentialPreviewChanges.value.length);
const importKindLabel = computed(() => ({
  complete: 'FluentRead 备份',
  'model-usage': '旧版模型用量备份',
  config: '旧版配置文件',
})[pendingImport.value?.kind || 'complete']);
const importBoundary = computed(() => {
  if (pendingImport.value?.kind === 'model-usage') return '只恢复模型用量，当前设置保持不变。';
  if (pendingImport.value?.kind === 'config') return '只恢复设置，模型用量保持不变。';
  return '设置将更新；用量记录会合并，已有记录不会重复。若有内容未恢复，会明确提示。';
});

/** 大文件读取与校验耗时较长，超过阈值时先让用户确认。 */
const LARGE_IMPORT_FILE_BYTES = 8 * 1024 * 1024;

type ModelUsageResponse<T> = {success: true; data: T} | {success: false; error: string};

async function requestModelUsage<T>(action: 'export' | 'import', document?: unknown): Promise<T> {
  const response = await sendRuntimeMessage({
    type: 'modelUsage',
    action,
    ...(document === undefined ? {} : {document}),
  }) as ModelUsageResponse<T>;
  if (!response?.success) throw new Error(response?.error || '模型用量操作失败');
  return response.data;
}

async function modelUsageExport(): Promise<ModelUsageTransferDocument> {
  return requestModelUsage<ModelUsageTransferDocument>('export');
}

async function exportCompleteBackup(event?: MouseEvent): Promise<void> {
  if (busy.value) return;
  const trigger = eventTarget(event);
  busy.value = true;
  try {
    const [configSnapshot, modelUsage] = await Promise.all([
      prepareHydratedConfigForExport(),
      modelUsageExport(),
    ]);
    const backup = createFluentReadDataBackup({
      config: configSnapshot,
      modelUsage,
    });
    downloadFile(`fluentread-backup-${dateStamp()}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
    ElMessage.success(`备份已导出：${modelUsage.events.length} 条用量记录`);
  } catch (error) {
    ElMessage.error(`导出失败：${errorMessage(error)}`);
  } finally {
    busy.value = false;
    await focusTriggerAfterBusy(trigger);
  }
}

function openRestoreSource(event: MouseEvent): void {
  importTrigger = event.currentTarget as HTMLElement | null;
  restoreSourceVisible.value = true;
}

function chooseImport(event?: MouseEvent): void {
  restoreActionTrigger = eventTarget(event);
  importInput.value?.click();
}

function showImportPreview(target: LocalDataImport, name: string, size: number): void {
  pendingImport.value = target;
  pendingFileName.value = name;
  pendingFileSize.value = size;
  importPreviewVisible.value = true;
  restoreSourceVisible.value = false;
}

async function readImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || busy.value) return;
  const trigger = restoreActionTrigger;
  restoreActionTrigger = null;
  busy.value = true;
  try {
    if (file.size > LARGE_IMPORT_FILE_BYTES) {
      try {
        await ElMessageBox.confirm(
          `文件约 ${Math.ceil(file.size / (1024 * 1024))} MB，读取和校验可能需要较长时间。是否继续？`,
          '导入较大的备份',
          {confirmButtonText: '继续', cancelButtonText: '取消', type: 'warning'},
        );
      } catch {
        return;
      }
    }
    const parsed = parseLocalDataImport(JSON.parse(await file.text()));
    showImportPreview(parsed, file.name, file.size);
  } catch (error) {
    ElMessage.error(`无法读取备份：${errorMessage(error)}`);
  } finally {
    busy.value = false;
    await focusTriggerAfterBusy(trigger, () => restoreSourceVisible.value && !importPreviewVisible.value);
  }
}

async function previewPastedImport(event?: MouseEvent): Promise<void> {
  const text = pastedJson.value.trim();
  if (!text || busy.value) return;
  const trigger = eventTarget(event);
  busy.value = true;
  try {
    const parsed = parseLocalDataImport(JSON.parse(text));
    showImportPreview(parsed, '粘贴的旧版 JSON', new Blob([text]).size);
  } catch (error) {
    ElMessage.error(`无法读取 JSON：${errorMessage(error)}`);
  } finally {
    busy.value = false;
    await focusTriggerAfterBusy(trigger, () => restoreSourceVisible.value && !importPreviewVisible.value);
  }
}

async function applyPendingImport(): Promise<void> {
  const target = pendingImport.value;
  if (!target || busy.value) return;
  const configBaseFingerprint = target.kind === 'complete' || target.kind === 'config'
    ? JSON.stringify(prepareConfigForExport(props.config))
    : '';
  const confirmedConfigChangeCount = configChangeCount.value;
  busy.value = true;
  const successes: string[] = [];
  const failures: string[] = [];
  const run = async (label: string, operation: () => Promise<string>) => {
    try {
      successes.push(await operation());
    } catch (error) {
      failures.push(`${label}：${errorMessage(error)}`);
    }
  };

  if (target.kind === 'complete' || target.kind === 'model-usage') {
    const modelUsage = target.kind === 'complete' ? target.backup.modelUsage : target.modelUsage;
    await run('模型用量', async () => {
      const result = await requestModelUsage<ModelUsageImportResult>('import', modelUsage);
      return `模型用量新增 ${result.importedCount}、跳过 ${result.duplicateCount}`;
    });
  }
  if (target.kind === 'complete' || target.kind === 'config') {
    await run('设置', async () => {
      if (JSON.stringify(prepareConfigForExport(props.config)) !== configBaseFingerprint) {
        throw new Error('设置在导入期间已被其他页面修改，本次未覆盖；请重新预览后再导入设置');
      }
      const targetConfig = prepareImportedConfig(target, props.config);
      if (!targetConfig) throw new Error('备份中不包含可恢复的设置');
      await requestConfigSave(targetConfig, sendRuntimeMessage, {
        credentialIntent: target.kind === 'complete' && usesExactCredentialReplacement(target.backup)
          ? 'exact'
          : 'changed-fields',
      });
      return `设置已应用（${confirmedConfigChangeCount} 项需确认）`;
    });
  }

  busy.value = false;
  importPreviewVisible.value = false;
  if (failures.length) {
    ElMessage.error(`导入完成但有失败项：${failures.join('；')}。已成功：${successes.join('；') || '无'}`);
  } else {
    ElMessage.success(`导入完成：${successes.join('；')}`);
  }
}

function clearImportPreview(): void {
  pendingImport.value = null;
  pendingFileName.value = '';
  pendingFileSize.value = 0;
  const trigger = importTrigger;
  importTrigger = null;
  void nextTick(() => trigger?.focus());
}

function clearRestoreSource(): void {
  pastedJson.value = '';
  restoreActionTrigger = null;
  if (importPreviewVisible.value) return;
  const trigger = importTrigger;
  importTrigger = null;
  void nextTick(() => trigger?.focus());
}

function eventTarget(event?: MouseEvent): HTMLElement | null {
  return event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
}

async function focusTriggerAfterBusy(
  trigger: HTMLElement | null,
  shouldFocus: () => boolean = () => true,
): Promise<void> {
  await nextTick();
  const activeElement = document.activeElement;
  const focusWasLost = !activeElement || activeElement === document.body || activeElement === document.documentElement;
  if (focusWasLost && trigger?.isConnected && shouldFocus()) trigger.focus();
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadFile(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], {type}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '请稍后重试';
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<style scoped>
.local-data-management { width: 100%; }
.transfer-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 15px 16px; }
.featured-transfer { background: var(--surface); }
.transfer-identity { display: flex; min-width: 0; align-items: center; gap: 12px; }
.transfer-icon { display: grid; flex: none; width: 36px; height: 36px; place-items: center; border-radius: 11px; color: var(--brand-strong); background: var(--brand-soft); font-size: 16px; font-weight: 800; }
.transfer-copy { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.transfer-copy strong { color: var(--ink); font-size: 12.5px; }
.transfer-copy small, .transfer-warning, .import-boundary { color: var(--muted); font-size: 10.5px; line-height: 1.55; }
.transfer-actions { display: flex; flex: none; align-items: center; flex-wrap: wrap; gap: 7px; }
.transfer-actions :deep(.el-button) { margin-left: 0; }
.transfer-actions :deep(svg) { width: 14px; margin-right: 5px; }
.transfer-warning { margin: 0; padding: 0 16px 14px; }
.restore-file-choice { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface-soft); }
.restore-file-choice > div { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.restore-file-choice strong { color: var(--ink); font-size: 12px; }
.restore-file-choice small, .legacy-paste p { color: var(--muted); font-size: 10px; line-height: 1.55; }
.legacy-paste { margin-top: 12px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface); }
.legacy-paste summary { padding: 12px 14px; color: var(--ink); cursor: pointer; font-size: 10.5px; font-weight: 700; }
.legacy-paste p { margin: 0; padding: 0 14px 10px; }
.legacy-paste :deep(.el-textarea) { display: block; padding: 0 14px; box-sizing: border-box; }
.legacy-paste-actions { display: flex; justify-content: flex-end; padding: 10px 14px 14px; }
.import-file-summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 14px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface-soft); }
.import-file-summary > div { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.import-file-summary span, .import-file-summary small { color: var(--muted); font-size: 10px; }
.import-file-summary strong { overflow: hidden; color: var(--ink); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.import-section-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
.import-section-grid article { display: flex; min-height: 108px; padding: 13px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface); flex-direction: column; }
.import-section-grid article.muted { opacity: .55; }
.import-section-grid span { color: var(--muted); font-size: 9.5px; font-weight: 700; }
.import-section-grid strong { margin: 8px 0 5px; color: var(--ink); font-size: 14px; }
.import-section-grid small { color: var(--muted); font-size: 9px; line-height: 1.45; }
.import-boundary { margin: 12px 2px 0; }
.config-import-preview { margin-top: 14px; padding: 13px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface-soft); }
.config-import-preview > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.config-import-preview > header > div { display: flex; flex-direction: column; gap: 3px; }
.config-import-preview > header span { color: var(--muted); font-size: 9.5px; }
.config-import-preview > header strong { color: var(--ink); font-size: 12px; }
.config-import-preview > header b { padding: 5px 9px; border-radius: 999px; color: var(--brand-strong); background: var(--brand-soft); font-size: 9.5px; }
.config-change-list { display: grid; gap: 11px; max-height: 34vh; margin-top: 12px; padding-right: 3px; overflow-y: auto; }
.config-change-group { overflow: hidden; border: 1px solid var(--line); border-radius: 11px; background: var(--surface); }
.config-change-group h4 { display: flex; align-items: center; gap: 6px; margin: 0; padding: 9px 10px; border-bottom: 1px solid var(--line); color: var(--ink); font-size: 10.5px; }
.config-change-group h4 span { display: grid; min-width: 18px; height: 18px; place-items: center; border-radius: 999px; color: var(--brand-strong); background: var(--brand-soft); font-size: 8.5px; }
.config-change-group article { display: grid; grid-template-columns: minmax(110px, .65fr) repeat(2, minmax(0, 1fr)); gap: 10px; padding: 9px 10px; border-bottom: 1px solid var(--line); }
.config-change-group article:last-child { border-bottom: 0; }
.config-change-group article > strong { align-self: center; color: var(--ink); font-size: 9.5px; }
.config-change-group article div { min-width: 0; }
.config-change-group article span { color: var(--muted); font-size: 8.5px; }
.config-change-group article p { margin: 2px 0 0; overflow-wrap: anywhere; color: var(--muted); font-size: 9px; line-height: 1.4; }
.config-same { margin: 12px 0 0; color: var(--muted); font-size: 10px; }

@media (max-width: 820px) {
  .transfer-row { align-items: flex-start; flex-direction: column; }
  .transfer-actions { width: 100%; }
  .restore-file-choice { align-items: flex-start; flex-direction: column; }
  .import-section-grid { grid-template-columns: 1fr; }
  .config-change-group article { grid-template-columns: 1fr; gap: 5px; }
}

</style>
