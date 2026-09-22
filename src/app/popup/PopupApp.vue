<!--
 @file src/app/popup/PopupApp.vue
 文件职责：实现浏览器 Popup 的主交互界面，连接当前标签页状态、翻译配置、可插拔皮肤、功能抽屉和高频操作，让现场开关与显示操作保持简短，将长期偏好引导到对应设置页。
 主要内容：在配置 hydration 后合并内置与动态自定义服务及其模型，编排翻译、AI 语境偏好与可用状态、站点规则及两列快捷功能，语言选项与快捷抽屉按需挂载；图片、圈选和划词拥有独立状态、抽屉与设置入口，监听配置并持久化，按皮肤及栏目显隐自动计算高度。
 模块边界：组件编排用户交互与运行时消息，不实现翻译 provider、缓存存储或 content 挂载细节；公共配置由 services/store 管理，页面行为由 content feature 接收消息完成。
-->
<!-- Popup 页面归 app 层所有；WXT 入口只负责调用挂载函数。 -->
<template>
  <main
    class="popup-shell"
    :class="{ 'config-loading': !hydrated, 'language-onboarding-shell': showLanguageOnboarding }"
    :aria-busy="!hydrated"
    :data-config-ready="hydrated ? 'true' : 'false'"
    :data-interface-skin="config.interfaceSkin"
    :data-popup-module-order="config.popupModuleOrder.join(',')"
    :data-popup-quick-feature-order="config.popupQuickFeatureOrder.join(',')"
    :data-popup-quick-features="visiblePopupQuickFeatureIds.join(',')"
    :data-popup-quick-features-visible="String(config.interfaceVisibility.popupQuickFeatures)"
    :data-popup-site-rule-visible="String(config.interfaceVisibility.popupSiteRule)"
    :data-popup-footer-visible="String(config.interfaceVisibility.popupFooter)"
    :inert="!hydrated"
  >
    <InterfaceBackdrop :motif="getInterfaceSkinOption(config.interfaceSkin).motif" />
    <UiLanguageOnboarding
      v-if="showLanguageOnboarding"
      :initial-language="onboardingLanguage"
      @confirmed="handleLanguageOnboardingConfirmed"
    />

    <div class="popup-content" :inert="showLanguageOnboarding">
    <header class="popup-header">
      <div class="brand">
        <img src="/icon/128.png" alt="" />
        <div>
          <strong>流畅阅读</strong>
          <small data-i18n-ignore>v{{ version }}</small>
        </div>
      </div>
      <div class="header-actions">
        <button ref="donationTrigger" class="donation-button" type="button" :title="t('popup.donationTitle')" :aria-label="t('popup.donationTitle')" @click="openDonation()">
          <Coffee />
          <span>{{ t('popup.donationButton') }}</span>
        </button>
        <button class="settings-button" type="button" title="完整设置" aria-label="打开完整设置" @click="openOptions()">
          <Setting />
          <span>设置</span>
        </button>
      </div>
    </header>

    <Transition name="donation-fade">
      <div
        v-if="donationVisible"
        class="donation-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="donation-title"
        @click.self="closeDonation"
      >
        <section ref="donationCard" class="donation-card" tabindex="-1">
          <button class="donation-close" type="button" :aria-label="t('popup.donationClose')" @click="closeDonation">×</button>
          <h2 id="donation-title">{{ t('popup.donationTitle') }}</h2>
          <p class="donation-description">{{ t('popup.donationDescription') }}</p>
          <section class="donation-method donation-wechat">
            <div class="donation-method-heading"><h3>{{ t('popup.donationWechat') }}</h3><span>WeChat Support</span></div>
            <a class="donation-qr-frame" href="/misc/approve.jpg" target="_blank" rel="noopener noreferrer" :aria-label="t('popup.donationOpenCode')">
              <!-- 绑定表达式让模板编译器保留 public 路径，避免再打包一份带 hash 的同图。 -->
              <img :src="'/misc/approve.jpg'" :alt="t('popup.donationCodeAlt')" width="1152" height="1152" />
            </a>
            <p class="donation-method-note">{{ t('popup.donationScan') }}</p>
          </section>
          <a class="donation-method donation-kofi" href="https://ko-fi.com/thinkstu" target="_blank" rel="noopener noreferrer">
            <span class="donation-kofi-mark" aria-hidden="true"><Coffee /></span>
            <span class="donation-kofi-copy"><strong>Ko-fi <span aria-hidden="true">↗</span></strong><span>{{ t('popup.donationKofi') }}</span><small>ko-fi.com/thinkstu</small></span>
          </a>
        </section>
      </div>
    </Transition>

    <template v-for="moduleId in visiblePopupModuleOrder" :key="moduleId">
    <section v-if="moduleId === 'translation'" class="hero-card" data-popup-module="translation">
      <div class="hero-heading">
        <div>
          <h1>{{ config.on ? '网页翻译' : '翻译功能已暂停' }}</h1>
        </div>
        <div class="hero-switches">
          <button class="switch" type="button" role="switch" :aria-checked="config.on" :aria-label="config.on ? '暂停插件' : '启用插件'" @click="setPluginEnabled(!config.on)"><i /></button>
        </div>
      </div>

      <div class="language-pair">
        <label>
          <span>源语言</span>
          <PopupLanguageSelect aria-label="源语言" source v-model="config.from" :disabled="!config.on" />
        </label>
        <span class="arrow">→</span>
        <label>
          <span>目标语言</span>
          <PopupLanguageSelect aria-label="目标语言" v-model="config.to" :disabled="!config.on" />
        </label>
      </div>

      <div ref="servicePicker" class="service-picker">
        <div class="service-selection">
        <button
          class="service-field"
          type="button"
          :disabled="!config.on"
          aria-haspopup="listbox"
          :aria-expanded="servicePickerOpen"
          :aria-label="servicePickerAriaLabel"
          :data-selected-model="serviceModelLabel || undefined"
          @click="toggleServicePicker"
        >
          <ServiceIcon :service="config.service" :label="serviceLabel" size="small" />
          <span class="service-copy">
            <small>翻译服务</small>
            <span class="service-value">
              <strong>{{ serviceLabel }}</strong>
              <em v-if="serviceModelLabel" class="service-model" :title="serviceModelLabel">{{ serviceModelLabel }}</em>
            </span>
          </span>
          <span class="chevron" :class="{ open: servicePickerOpen }">⌄</span>
        </button>
        <button
          class="ai-context-control"
          data-testid="ai-context-help"
          type="button"
          :data-ai-context-state="aiContextPresentation.state"
          :aria-label="`${t('popup.aiContext.help')} · ${t(`popup.aiContext.status.${aiContextPresentation.state}`)}`"
          :title="t(aiContextPresentation.descriptionKey)"
          aria-haspopup="dialog"
          :aria-expanded="drawerVisible && activeDrawer === 'aiContext'"
          @click="openAIContextSettings"
        >
          <span class="ai-context-name">{{ t('popup.aiContext.title') }} <span aria-hidden="true">›</span></span>
          <span class="ai-context-status" role="status">{{ t(`popup.aiContext.status.${aiContextPresentation.state}`) }}</span>
        </button>
        </div>

        <div v-if="servicePickerOpen" class="service-picker-panel" role="dialog" aria-label="选择翻译服务">
          <label class="service-search">
            <Search aria-hidden="true" />
            <input
              ref="serviceSearchInput"
              v-model="serviceSearchQuery"
              type="search"
              autocomplete="off"
              spellcheck="false"
              aria-label="搜索翻译服务或模型"
              placeholder="搜索服务或模型，如 gpt、qwen"
            />
            <button v-if="serviceSearchQuery" type="button" aria-label="清空服务搜索" @click="clearServiceSearch">×</button>
          </label>

          <div class="service-picker-results">
            <div v-if="serviceSearchActive && serviceSearchResults.length" class="service-group" role="listbox" aria-label="匹配的翻译服务">
              <span class="service-group-label">匹配服务</span>
              <button
                v-for="item in serviceSearchResults"
                :key="item.value"
                class="service-option"
                type="button"
                role="option"
                :data-service-value="item.value"
                :data-matching-models="item.matchingModels.join(',') || undefined"
                :aria-selected="config.service === item.value"
                @click="selectService(item.value)"
              >
                <ServiceIcon :service="item.value" :label="item.label" size="small" />
                <span class="service-option-copy">
                  <strong>{{ item.label }}</strong>
                  <small v-if="item.matchingModels.length">{{ matchingModelSummary(item.matchingModels) }}</small>
                </span>
                <span v-if="config.service === item.value" class="service-option-check">✓</span>
              </button>
            </div>

            <p v-else-if="serviceSearchActive" class="service-search-empty" role="status">
              没有找到包含“{{ serviceSearchQuery.trim() }}”的服务或模型
            </p>

            <template v-else>
              <div class="service-group" role="listbox" aria-label="常用翻译服务">
                <span class="service-group-label">常用服务</span>
                <button
                  v-for="item in popularServiceOptions"
                  :key="item.value"
                  class="service-option"
                  type="button"
                  role="option"
                  :data-service-value="item.value"
                  :aria-selected="config.service === item.value"
                  @click="selectService(item.value)"
                >
                  <ServiceIcon :service="item.value" :label="item.label" size="small" />
                  <span class="service-option-copy"><strong>{{ item.label }}</strong></span>
                  <span v-if="config.service === item.value" class="service-option-check">✓</span>
                </button>
              </div>

              <button class="service-more-toggle" type="button" :aria-expanded="moreServicesOpen" @click="moreServicesOpen = !moreServicesOpen">
                <span>更多服务</span>
                <span class="service-more-meta">{{ moreServiceOptions.length }} 项 <b :class="{ open: moreServicesOpen }">⌄</b></span>
              </button>

              <div v-if="moreServicesOpen" class="service-group service-group-more" role="listbox" aria-label="更多翻译服务">
                <button
                  v-for="item in moreServiceOptions"
                  :key="item.value"
                  class="service-option"
                  type="button"
                  role="option"
                  :data-service-value="item.value"
                  :aria-selected="config.service === item.value"
                  @click="selectService(item.value)"
                >
                  <ServiceIcon :service="item.value" :label="item.label" size="small" />
                  <span class="service-option-copy"><strong>{{ item.label }}</strong></span>
                  <span v-if="config.service === item.value" class="service-option-check">✓</span>
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div v-if="credentialWarning" class="credential-warning" role="alert">
        <span><strong>配置提醒</strong>{{ credentialWarning }}</span>
        <button type="button" @click="openOptions('settings-services')">去设置</button>
      </div>

      <div class="translate-action">
        <button
          class="translate-button"
          :class="{ translated: pageTranslated }"
          type="button"
          :disabled="!config.on || translating || (!pageTranslated && Boolean(selectedServiceUnavailableMessage))"
          :aria-pressed="pageTranslated"
          @click="togglePageTranslation"
        >
          <span v-if="translating" class="spinner" />
          <span v-else class="translate-glyph">A↔译</span>
          <span class="translate-label">{{ pageTranslated ? '恢复当前网页' : '翻译当前网页' }}</span>
          <kbd
            class="translate-hotkey"
            :class="{ disabled: !defaultFullPageHotkeyEnabled }"
            :title="fullPageHotkeyTitle"
          ><span>{{ fullPageHotkey }}</span></kbd>
        </button>
      </div>

      <PopupSiteRule
        v-if="siteModuleNestedInTranslation && isSiteModuleVisible"
        v-bind="siteRuleModuleProps"
        @set-always-translated="setCurrentSiteAlwaysTranslated"
        @set-extension-disabled="setCurrentSiteExtensionDisabled"
      />

      <p v-if="notice" class="notice" :class="noticeType">{{ notice }}</p>
    </section>

    <PopupSiteRule
      v-else-if="moduleId === 'siteRule' && !siteModuleNestedInTranslation"
      v-bind="siteRuleModuleProps"
      @set-always-translated="setCurrentSiteAlwaysTranslated"
      @set-extension-disabled="setCurrentSiteExtensionDisabled"
    />

    <section
      v-else-if="moduleId === 'quickFeatures'"
      class="features"
      data-popup-module="quickFeatures"
    >
      <span class="eyebrow features-eyebrow">快捷功能</span>
      <div class="feature-grid">
        <button
          v-for="feature in visiblePopupQuickFeatures"
          :key="feature.id"
          class="feature-card"
          :class="feature.className"
          :data-feature="feature.dataFeature"
          :data-popup-quick-feature="feature.id"
          type="button"
          :disabled="!config.on"
          :aria-label="feature.ariaLabel || `${translateLegacy(feature.label)} · ${translateLegacy(feature.summary)}`"
          :title="`${translateLegacy(feature.label)} · ${translateLegacy(feature.summary)}`"
          @click="feature.open()"
        >
          <span class="feature-icon" :class="feature.iconTone" aria-hidden="true">
            <template v-if="config.interfaceSkin === 'emoji'">{{ emojiFeatureIcons[feature.id] }}</template>
            <svg v-else class="feature-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path :d="featureIconPaths[feature.id]" />
            </svg>
          </span>
          <span class="feature-copy">
            <strong>{{ feature.label }}</strong>
            <small>{{ feature.summary }}</small>
          </span>
          <i v-if="feature.showStatus" :class="{active: feature.active}" />
          <b v-else aria-hidden="true">↗</b>
        </button>
      </div>
    </section>

    <footer
      v-else-if="moduleId === 'footer'"
      data-popup-module="footer"
      :data-popup-module-last="lastVisiblePopupModule === 'footer'"
    >
      <span>已完成 {{ config.count }} 次翻译</span>
      <a
        class="opensource-link"
        href="https://github.com/Bistutu/FluentRead"
        target="_blank"
        rel="noreferrer"
        aria-label="在 GitHub 查看流畅阅读开源项目"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.26c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.62-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .3" />
        </svg>
        <span>开源项目</span>
        <span class="external-mark" aria-hidden="true">↗</span>
      </a>
      <button type="button" :disabled="clearingCache" @click="clearCache">{{ clearingCache ? '清理中…' : '清除缓存' }}</button>
    </footer>
    </template>

    <el-drawer
      v-if="drawerMounted"
      v-model="drawerVisible"
      :title="drawerTitle"
      direction="btt"
      size="auto"
      :with-header="false"
      :append-to-body="true"
      modal-class="popup-drawer-modal"
      class="popup-drawer"
    >
      <div class="drawer-surface">
        <div class="drawer-handle" />
        <header class="drawer-header">
        <div><span class="eyebrow">快捷设置</span><h2>{{ drawerTitle }}</h2><p>{{ drawerDescription }}</p></div>
        <button type="button" aria-label="关闭" @click="drawerVisible = false">×</button>
        </header>

      <div v-if="activeDrawer === 'aiContext'" class="drawer-content ai-context-details" data-i18n-ignore>
        <div class="ai-context-detail-state" :data-ai-context-state="aiContextPresentation.state">
          <span class="ai-context-status" role="status">{{ t(`popup.aiContext.status.${aiContextPresentation.state}`) }}</span>
          <p data-testid="ai-context-description">{{ t(aiContextPresentation.descriptionKey) }}</p>
        </div>
        <p v-if="credentialWarning" class="ai-context-setup-details" role="alert">{{ translateLegacy(credentialWarning) }}</p>
        <div class="setting-row">
          <span><strong>{{ t('popup.aiContext.preference') }}</strong><small>{{ t('popup.aiContext.preferenceHint') }}</small></span>
          <button
            class="switch compact ai-context-detail-switch"
            type="button"
            role="switch"
            :aria-label="t('popup.aiContext.preference')"
            :aria-checked="config.enableAIContext"
            :disabled="aiContextPresentation.toggleDisabled"
            @click="toggleAIContext"
          ><i /></button>
        </div>
        <dl class="ai-context-explanation">
          <div><dt>{{ t('popup.aiContext.howTitle') }}</dt><dd>{{ t('popup.aiContext.how') }}</dd></div>
          <div><dt>{{ t('popup.aiContext.costTitle') }}</dt><dd>{{ t('popup.aiContext.cost') }}</dd></div>
          <div><dt>{{ t('popup.aiContext.applyTitle') }}</dt><dd>{{ t('popup.aiContext.apply') }}</dd></div>
        </dl>
        <button class="secondary-action" type="button" data-testid="ai-context-settings" @click="openOptions('settings-services')">{{ t('popup.aiContext.configure') }} ↗</button>
      </div>

      <div v-else-if="activeDrawer === 'hover'" class="drawer-content">
        <div v-if="hoverProfileCount" class="interaction-preview"><span class="cursor">↖</span><span>＋</span><kbd>{{ hoverPreviewKey }}</kbd><span>＝</span><strong>即时翻译</strong></div>
        <div class="setting-row">
          <span>
            <strong>{{ t('popup.quickTranslation.defaultHoverShortcut') }}</strong>
            <small v-if="!defaultHoverEnabled" data-i18n-ignore>{{ t('popup.quickSettings.disabledHoverHint') }}</small>
            <small v-if="quickHoverProfiles.length" class="independent-profile-note">{{ t('popup.quickTranslation.defaultOnly', {count: quickHoverProfiles.length}) }}</small>
            <small v-else-if="defaultHoverEnabled">{{ t('popup.quickTranslation.defaultOff') }}</small>
          </span>
          <button v-if="defaultHoverEnabled" class="secondary-action hover-shortcut-action" type="button" :aria-label="t('popup.quickSettings.disableHoverShortcut')" data-i18n-ignore @click="config.hotkey = 'none'">{{ t('common.close') }}</button>
          <button v-else class="secondary-action hover-shortcut-action" type="button" data-i18n-ignore @click="openOptions('settings-translation')">{{ t('popup.quickSettings.chooseHoverShortcut') }}</button>
        </div>
        <div v-if="quickHoverProfiles.length" class="quick-profile-preview" data-testid="popup-quick-hover-profiles">
          <label>{{ t('popup.quickTranslation.extraProfiles') }}</label>
          <div v-for="profile in quickHoverProfiles.slice(0, 3)" :key="profile.id" class="quick-profile-preview-row">
            <kbd>{{ profile.hotkey }}</kbd>
            <span>{{ quickProfileSummary(profile) }}</span>
          </div>
          <small v-if="quickHoverProfiles.length > 3">{{ t('popup.quickTranslation.moreProfiles', {count: quickHoverProfiles.length - 3}) }}</small>
        </div>
      </div>

      <div v-else-if="activeDrawer === 'selection'" class="drawer-content">
        <div>
          <div v-if="config.selectionTranslatorMode !== 'disabled'" class="interaction-preview">
            <span class="selection-box">选择文字</span><span>＋</span>
            <i v-if="config.selectionTranslatorTrigger === 'dot'" class="pink-dot" />
            <span v-else-if="config.selectionTranslatorTrigger === 'icon'" class="selection-preview-icon">↗</span>
            <strong v-else-if="config.selectionTranslatorTrigger === 'direct'">直接弹出</strong>
            <kbd v-else>{{ selectionTriggerPreview }}</kbd>
            <span>＝</span><strong>翻译所选内容</strong>
          </div>
          <div class="choice-block">
            <label>划词翻译</label>
            <div class="chips three" role="group" aria-label="划词翻译模式">
              <button v-for="item in selectionModes" :key="item.value" type="button" :class="{ selected: config.selectionTranslatorMode === item.value }" :aria-pressed="config.selectionTranslatorMode === item.value" @click="setSelectionMode(item.value)">{{ item.label }}</button>
            </div>
          </div>
        </div>

      </div>

      <div v-else class="drawer-content">
        <div class="choice-block">
          <label>翻译模式</label>
          <div class="chips two" role="group" aria-label="翻译模式">
            <button v-for="item in options.display" :key="item.value" type="button" :class="{ selected: config.display === item.value }" :aria-pressed="config.display === item.value" @click="config.display = item.value">{{ item.label }}</button>
          </div>
        </div>
      </div>

        <p v-if="notice && noticeType === 'error'" class="notice error" role="alert">{{ notice }}</p>
        <button v-if="activeDrawer !== 'aiContext'" class="drawer-settings-link" type="button" data-i18n-ignore @click="openOptions(drawerSettingsSection[activeDrawer])">
          <span><strong>{{ t(`popup.quickSettings.${activeDrawer}Settings`) }}</strong><small>{{ t(`popup.quickSettings.${activeDrawer}SettingsHint`) }}</small></span>
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    </el-drawer>

    </div>
  </main>
</template>

<script lang="ts" setup>
import PopupLanguageSelect from './PopupLanguageSelect.vue';

import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import browser from 'webextension-polyfill';
import {
  config as runtimeConfig,
  handoffPendingConfigPatches,
  requestConfigPatch,
  subscribeConfig,
} from '@/src/services/config/store';
import { Search, Setting } from '@element-plus/icons-vue';
import {normalizeConfig} from '@/src/core/config/model';
import {resolveUiLanguageFromLocale, type UiLanguage} from '@/src/core/i18n';
import {
  customModelString,
  models,
  options,
  resolveConfiguredModel,
  servicesType,
} from '@/src/core/config/catalog';
import {
  enabledQuickTranslationProfiles,
  type QuickTranslationProfile,
} from '@/src/core/config/quickTranslation';
import {resolveConfiguredHotkey} from '@/src/core/hotkey';
import {
  getCustomOpenAIProvider,
  withCustomOpenAIServiceOptions,
} from '@/src/core/config/customOpenAI';
import { getMissingCredentialMessage } from '@/src/core/config/validation';
import {
  getInterfaceSkinOption,
  interfaceSkinUsesContentHeight,
  type PopupQuickFeatureId,
} from '@/src/core/config/interfaceAppearance';
import { getSelectedModelLabel, searchServiceOptions } from '@/src/ui/view-model/serviceCatalog';
import { resolveAIContextPresentation } from '@/src/ui/view-model/aiContext';
import { getSiteBaseDomain } from '@/src/core/site-rules/domain';
import {applyInterfaceFont, applyInterfaceSkin} from '@/src/ui/interfaceAppearance';
import { requestTranslationCacheClear } from './cache';
import {isBrowserTabId} from '@/src/platform/browser/ids';
import InterfaceBackdrop from '@/src/ui/components/InterfaceBackdrop.vue';
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue';
import UiLanguageOnboarding from '@/src/ui/components/UiLanguageOnboarding.vue';
import {useUiI18n} from '@/src/ui/i18n';
import PopupSiteRule from './PopupSiteRule.vue';
import {
  filterAvailableTranslationServices,
  getTranslationServiceUnavailableMessage,
  isTranslationServiceAvailable,
} from '@/src/services/translation/capabilities';

type DrawerName = 'hover' | 'selection' | 'appearance' | 'aiContext';
type SettingsSection = 'settings-general' | 'settings-translation' | 'settings-services' | 'settings-sites';
interface PopupQuickFeatureViewModel {
  id: PopupQuickFeatureId;
  label: string;
  summary: string;
  icon: string;
  iconTone: 'rose' | 'violet' | 'amber' | 'teal' | 'blue';
  showStatus: boolean;
  active?: boolean;
  className?: string;
  dataFeature?: string;
  ariaLabel?: string;
  open: () => void | Promise<void>;
}
const ElDrawer = defineAsyncComponent(() => import('./PopupDrawer'));
const {t, translateLegacy} = useUiI18n();
const version = process.env.VUE_APP_VERSION;
// composition root 已等待配置服务；首次渲染直接使用完整快照，不能先暴露默认布局。
const config = ref(normalizeConfig(runtimeConfig));
const onboardingLanguage = ref<UiLanguage>('zh-CN');
const drawerVisible = ref(false);
const drawerMounted = ref(false);
const activeDrawer = ref<DrawerName>('hover');
const translating = ref(false);
const pageTranslated = ref(false);
const currentTabId = ref<number | null>(null);
const currentSiteDomain = ref('');
const clearingCache = ref(false);
const donationVisible = ref(false);
const donationCard = ref<HTMLElement | null>(null);
const donationTrigger = ref<HTMLButtonElement | null>(null);
const notice = ref('');
const noticeType = ref<'success' | 'error'>('success');
// This template ref lives inside the configurable module v-for, so Vue exposes
// it as an array even though the translation module itself is unique.
const servicePicker = ref<HTMLElement | HTMLElement[] | null>(null);
const serviceSearchInput = ref<HTMLInputElement | HTMLInputElement[] | null>(null);
const serviceSearchQuery = ref('');
const servicePickerOpen = ref(false);
const moreServicesOpen = ref(true);
const hydrated = ref(false);
const showLanguageOnboarding = ref(false);
let lastSerialized = '';
let applyingExternalConfig = false;
let pageExitSaveStarted = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const darkMode = window.matchMedia('(prefers-color-scheme: dark)');
const drawerSettingsSection: Record<DrawerName, SettingsSection> = {
  aiContext: 'settings-general',
  hover: 'settings-translation',
  selection: 'settings-translation',
  appearance: 'settings-general',
};
const sendConfigMessage = browser.runtime.sendMessage.bind(browser.runtime);
const persistConfigPatch = (value: unknown) => requestConfigPatch(value, sendConfigMessage);

function readBrowserUiLocale(): unknown {
  const browserI18n = (browser as unknown as {i18n?: {getUILanguage?: () => unknown}}).i18n;
  try {
    const extensionLocale = browserI18n?.getUILanguage?.();
    if (typeof extensionLocale === 'string' && extensionLocale.trim()) return extensionLocale;
  } catch {
    // navigator.language remains a reliable fallback in extension pages.
  }
  if (typeof navigator === 'undefined') return '';
  return navigator.languages?.find(locale => typeof locale === 'string' && locale.trim())
    || navigator.language
    || '';
}

// 圈选快捷键可自定义；抽屉提示、按键贴片和冲突检查都读取同一份解析结果。
const allServiceOptions = computed(() => withCustomOpenAIServiceOptions(
  options.services,
  config.value.customOpenAIProviders,
).filter((item: any) => !item.disabled).map((item: any) => ({
  ...item,
  label: translateLegacy(item.label),
  description: item.description ? translateLegacy(item.description) : item.description,
  searchTerms: [...(item.searchTerms || []), translateLegacy(item.label)],
})));
const serviceOptions = computed(() => filterAvailableTranslationServices(allServiceOptions.value));
const searchableModels = computed<ReadonlyMap<string, readonly string[]>>(() => {
  const merged = new Map<string, readonly string[]>(models);
  Object.entries(config.value.customModels).forEach(([service, savedModels]) => {
    merged.set(service, Array.from(new Set([
      ...(merged.get(service) || []).filter((model) => model !== customModelString),
      ...savedModels,
    ])));
  });
  config.value.customOpenAIProviders.forEach(provider => merged.set(provider.id, provider.models));
  return merged;
});
const serviceSearchActive = computed(() => Boolean(serviceSearchQuery.value.trim()));
const serviceSearchResults = computed(() => searchServiceOptions(
  serviceOptions.value,
  serviceSearchQuery.value,
  searchableModels.value,
  config.value.model,
  config.value.customModel,
));
const popularServiceValues = ['freeTranslation', 'microsoft', 'google', 'deepL', 'deeplx', 'deepseek', 'openai', 'gemini', 'claude'];
const popularServiceOptions = computed(() => popularServiceValues
  .map(value => serviceSearchResults.value.find((item: any) => item.value === value))
  .filter((item): item is any => Boolean(item)));
const moreServiceOptions = computed(() => serviceSearchResults.value.filter((item: any) => !popularServiceValues.includes(item.value)));
const selectedServiceUnavailableMessage = computed(() => getTranslationServiceUnavailableMessage(config.value.service));
const selectedCustomOpenAIProvider = computed(() => getCustomOpenAIProvider(
  config.value.customOpenAIProviders,
  config.value.service,
));
const serviceLabel = computed(() => {
  const label = allServiceOptions.value.find((item: any) => item.value === config.value.service)?.label || config.value.service;
  return selectedServiceUnavailableMessage.value ? `${label}（当前浏览器不可用）` : label;
});
const serviceModelLabel = computed(() => selectedCustomOpenAIProvider.value
  ? config.value.model[config.value.service] || selectedCustomOpenAIProvider.value.models[0] || '未选择模型'
  : getSelectedModelLabel(config.value.service, config.value.model, config.value.customModel));
const aiContextModel = computed(() => selectedCustomOpenAIProvider.value
  ? config.value.model[config.value.service] || selectedCustomOpenAIProvider.value.models[0] || ''
  : resolveConfiguredModel(
    config.value.model[config.value.service],
    config.value.customModel[config.value.service],
  ));
const canUseAIContext = computed(() => servicesType.isUseAIContext(
  selectedCustomOpenAIProvider.value ? 'custom' : config.value.service,
  aiContextModel.value,
));
const servicePickerAriaLabel = computed(() => serviceModelLabel.value
  ? `翻译服务：${serviceLabel.value}，当前模型：${serviceModelLabel.value}`
  : `翻译服务：${serviceLabel.value}`);
const credentialWarning = computed(() => selectedServiceUnavailableMessage.value || getMissingCredentialMessage(config.value.service, config.value));
const currentSiteSupported = computed(() => currentTabId.value !== null && Boolean(currentSiteDomain.value));
const currentSiteRuleEnabled = computed(() => currentSiteSupported.value
  && (config.value.alwaysTranslateDomains ?? []).includes(currentSiteDomain.value));
const currentSiteAlwaysTranslated = computed(() => currentSiteSupported.value
  && (config.value.autoTranslate || currentSiteRuleEnabled.value));
const currentSiteExtensionDisabled = computed(() => currentSiteSupported.value
  && (config.value.disabledExtensionDomains ?? []).includes(currentSiteDomain.value));
const aiContextPresentation = computed(() => resolveAIContextPresentation({
  enabled: config.value.enableAIContext,
  supported: canUseAIContext.value,
  pluginEnabled: config.value.on,
  siteDisabled: currentSiteExtensionDisabled.value,
  unavailable: Boolean(selectedServiceUnavailableMessage.value),
  missingCredentials: Boolean(getMissingCredentialMessage(config.value.service, config.value)),
  translating: translating.value,
}));
const isSiteModuleVisible = computed(() => config.value.interfaceVisibility.popupSiteRule
  && currentSiteSupported.value);
const visiblePopupQuickFeatureIds = computed(() => config.value.popupQuickFeatureOrder.filter(
  (featureId) => config.value.popupQuickFeatureVisibility[featureId],
));
const visiblePopupModuleOrder = computed(() => config.value.popupModuleOrder.filter((moduleId) => {
  if (moduleId === 'translation') return true;
  if (moduleId === 'siteRule') return isSiteModuleVisible.value;
  if (moduleId === 'quickFeatures') {
    return config.value.interfaceVisibility.popupQuickFeatures
      && visiblePopupQuickFeatureIds.value.length > 0;
  }
  return config.value.interfaceVisibility.popupFooter;
}));
const siteModuleNestedInTranslation = computed(() => {
  const translationIndex = visiblePopupModuleOrder.value.indexOf('translation');
  return translationIndex >= 0 && visiblePopupModuleOrder.value[translationIndex + 1] === 'siteRule';
});
const lastVisiblePopupModule = computed(() => visiblePopupModuleOrder.value.at(-1));
const emojiFeatureIcons: Record<PopupQuickFeatureId, string> = {hover: '🖱️', selection: '✍️', appearance: '🎨'};
// 快捷入口采用一致的线宽与画布；主题配色和 Emoji 风格仍由既有皮肤控制。
const featureIconPaths: Record<PopupQuickFeatureId, string> = {
  hover: 'M5 3l14 10-7 1-3 7-4-18z M12 14l5 6',
  selection: 'M8 4h8 M12 4v16 M8 20h8 M5 8H3v8h2 M19 8h2v8h-2',
  appearance: 'M3 19L9 5l6 14 M5 15h8 M16 12c5-3 6 1 5 7 M21 15c-7-2-6 6 0 3',
};
const popupUsesContentHeight = computed(() => interfaceSkinUsesContentHeight(config.value.interfaceSkin)
  || !config.value.interfaceVisibility.popupQuickFeatures
  || !config.value.interfaceVisibility.popupSiteRule
  || !config.value.interfaceVisibility.popupFooter
  || Object.values(config.value.popupQuickFeatureVisibility).some((visible) => !visible));
const currentSiteSwitchLabel = computed(() => currentSiteSupported.value
  ? currentSiteExtensionDisabled.value
    ? `${currentSiteDomain.value} 已禁用扩展，无法开启始终翻译`
    : config.value.autoTranslate
    ? `所有网站自动翻译已开启，${currentSiteDomain.value} 会自动翻译`
    : `始终翻译 ${currentSiteDomain.value}`
  : '始终翻译当前网站（当前页面不可用）');
const currentSiteExtensionSwitchLabel = computed(() => currentSiteSupported.value
  ? currentSiteExtensionDisabled.value
    ? `恢复 ${currentSiteDomain.value} 的扩展`
    : `在 ${currentSiteDomain.value} 禁用扩展`
  : '在此网站禁用扩展（当前页面不可用）');
const siteRuleModuleProps = computed(() => ({
  domain: currentSiteDomain.value,
  alwaysTranslated: currentSiteAlwaysTranslated.value,
  extensionDisabled: currentSiteExtensionDisabled.value,
  autoTranslate: config.value.autoTranslate,
  translating: translating.value,
  switchLabel: currentSiteSwitchLabel.value,
  extensionSwitchLabel: currentSiteExtensionSwitchLabel.value,
}));
const styleLabel = computed(() => options.styles.find((item: any) => item.value === config.value.style)?.label || '默认样式');
const defaultHoverHotkey = computed(() => resolveConfiguredHotkey(config.value.hotkey, config.value.customHotkey));
const defaultHoverEnabled = computed(() => Boolean(defaultHoverHotkey.value && defaultHoverHotkey.value !== 'none'));
const hoverKey = computed(() => defaultHoverEnabled.value ? defaultHoverHotkey.value : '未设置');
const quickHoverProfiles = computed(() => enabledQuickTranslationProfiles(config.value.quickTranslationProfiles, 'hover')
  .filter((profile) => isTranslationServiceAvailable(profile.service || config.value.service)));
const quickFullPageProfiles = computed(() => enabledQuickTranslationProfiles(config.value.quickTranslationProfiles, 'full-page')
  .filter((profile) => isTranslationServiceAvailable(profile.service || config.value.service)));
const hoverProfileCount = computed(() => quickHoverProfiles.value.length + (defaultHoverEnabled.value ? 1 : 0));
const hoverPreviewKey = computed(() => !defaultHoverEnabled.value
  ? quickHoverProfiles.value[0]?.hotkey || t('common.notSet')
  : hoverKey.value);
const hoverSummary = computed(() => quickHoverProfiles.value.length
  ? t('popup.quickTranslation.profileCount', {count: hoverProfileCount.value})
  : defaultHoverEnabled.value ? hoverKey.value.replace('Control', 'Ctrl') : '已关闭');
const defaultFullPageHotkey = computed(() => resolveConfiguredHotkey(
  config.value.floatingBallHotkey,
  config.value.customFloatingBallHotkey,
));
const defaultFullPageHotkeyEnabled = computed(() => Boolean(
  defaultFullPageHotkey.value && defaultFullPageHotkey.value !== 'none',
));
const fullPageHotkey = computed(() => defaultFullPageHotkeyEnabled.value
  ? defaultFullPageHotkey.value
  : quickFullPageProfiles.value.length ? t('popup.quickTranslation.defaultNotSet') : t('common.notSet'));
const fullPageHotkeyHint = computed(() => !defaultFullPageHotkeyEnabled.value && quickFullPageProfiles.value.length
  ? t('popup.quickTranslation.fullPageHint', {count: quickFullPageProfiles.value.length})
  : '');
const fullPageHotkeyTitle = computed(() => fullPageHotkeyHint.value
  ? `${fullPageHotkey.value} · ${fullPageHotkeyHint.value}`
  : fullPageHotkey.value);
function quickProfileSummary(profile: QuickTranslationProfile): string {
  const service = profile.service || config.value.service;
  const serviceName = allServiceOptions.value.find((item: any) => item.value === service)?.label || service;
  if (!servicesType.isUseModel(service)) return serviceName;
  const model = profile.model || resolveConfiguredModel(config.value.model[service], config.value.customModel[service]);
  return model ? `${serviceName} · ${model}` : serviceName;
}
const selectionSummary = computed(() => config.value.selectionTranslatorMode === 'disabled'
  ? '已关闭' : selectionTriggers.find(item => item.value === config.value.selectionTranslatorTrigger)?.label || '显示图标');
const displaySummary = computed(() => config.value.display === 1 ? `双语 · ${styleLabel.value}` : '仅显示译文');
const popupQuickFeatureViewModels = computed<Record<PopupQuickFeatureId, PopupQuickFeatureViewModel>>(() => ({
  hover: {
    id: 'hover',
    label: '鼠标悬停翻译',
    summary: hoverSummary.value,
    icon: '↖',
    iconTone: 'rose',
    showStatus: true,
    active: hoverProfileCount.value > 0,
    open: () => openDrawer('hover'),
  },
  selection: {
    id: 'selection',
    label: '划词翻译',
    summary: selectionSummary.value,
    icon: 'I',
    iconTone: 'violet',
    showStatus: true,
    active: config.value.selectionTranslatorMode !== 'disabled',
    open: () => openDrawer('selection'),
  },
  appearance: {
    id: 'appearance',
    label: '译文显示',
    summary: displaySummary.value,
    icon: 'Aa',
    iconTone: 'amber',
    showStatus: false,
    open: () => openDrawer('appearance'),
  },
}));
const visiblePopupQuickFeatures = computed(() => visiblePopupQuickFeatureIds.value
  .map((featureId) => popupQuickFeatureViewModels.value[featureId]));
const drawerTitle = computed(() => ({ aiContext: t('popup.aiContext.title'), hover: '鼠标悬停翻译设置', selection: '划词翻译设置', appearance: '译文显示设置' }[activeDrawer.value]));
const drawerDescription = computed(() => ({
  aiContext: t('popup.aiContext.intro'),
  hover: '把鼠标停在文本上，用轻量快捷键获取即时译文。',
  selection: '选中网页文字，按你的偏好获取译文。',
  appearance: t('popup.quickSettings.appearanceDescription'),
}[activeDrawer.value]));
const selectionModes = [
  { value: 'disabled', label: '关闭' },
  { value: 'bilingual', label: '双语显示' },
  { value: 'translation-only', label: '仅译文' },
];
const selectionTriggers = options.selectionTranslatorTriggers;
const selectionTriggerPreview = computed(() => config.value.selectionTranslatorTrigger === 'custom'
  ? config.value.customSelectionTranslatorHotkey || t('common.notSet')
  : selectionTriggers.find(item => item.value === config.value.selectionTranslatorTrigger)?.label || '快捷键');

function applyTheme(theme: string) {
  document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'auto' && darkMode.matches));
}

function applyPopupHeightMode(usesContentHeight: boolean) {
  document.documentElement.dataset.popupHeight = usesContentHeight ? 'content' : 'fixed';
}

async function hydrate() {
  if (!config.value.uiLanguageSetupCompleted) {
    onboardingLanguage.value = resolveUiLanguageFromLocale(readBrowserUiLocale());
  }
  showLanguageOnboarding.value = !config.value.uiLanguageSetupCompleted;
  lastSerialized = JSON.stringify(config.value);
  applyTheme(config.value.theme || 'auto');
  applyInterfaceSkin(config.value.interfaceSkin);
  applyInterfaceFont(config.value.interfaceFont);
  applyPopupHeightMode(popupUsesContentHeight.value);
  hydrated.value = true;
  if (!showLanguageOnboarding.value) await hydrateCurrentSite();
}
void hydrate();

function handleLanguageOnboardingConfirmed(language: UiLanguage): void {
  onboardingLanguage.value = language;
  showLanguageOnboarding.value = false;
  void hydrateCurrentSite();
}

const unsubscribeConfig = subscribeConfig((value) => {
  const serialized = JSON.stringify(value);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  applyingExternalConfig = true;
  try {
    Object.assign(config.value, value);
  } finally {
    applyingExternalConfig = false;
  }
});

watch(() => JSON.stringify(config.value), async serialized => {
  if (!hydrated.value || applyingExternalConfig) return;
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  const snapshot = normalizeConfig(config.value);
  try {
    await persistConfigPatch(snapshot);
  } catch (error) {
    // 保存失败后允许下一次交互重试，不能让去重标记永久吞掉同一快照。
    if (lastSerialized === serialized) lastSerialized = '';
    console.warn('[FluentRead] 保存 popup 设置失败', error);
  }
}, { flush: 'post' });
watch(() => config.value.theme, theme => applyTheme(theme || 'auto'));
watch(() => config.value.interfaceSkin, skin => applyInterfaceSkin(skin));
watch(() => config.value.interfaceFont, font => applyInterfaceFont(font));
watch(popupUsesContentHeight, applyPopupHeightMode, {immediate: true});
darkMode.onchange = () => { if (config.value.theme === 'auto') applyTheme('auto'); };

function closeServicePicker(event?: Event) {
  const target = event?.target;
  const pickers = Array.isArray(servicePicker.value)
    ? servicePicker.value
    : [servicePicker.value];
  if (target instanceof Node && pickers.some(picker => picker?.contains(target))) return;
  servicePickerOpen.value = false;
  serviceSearchQuery.value = '';
}
async function openDonation() {
  donationVisible.value = true;
  await nextTick();
  donationCard.value?.querySelector<HTMLButtonElement>('.donation-close')?.focus();
}
function closeDonation() {
  donationVisible.value = false;
  donationTrigger.value?.focus();
}
function handleDonationKeydown(event: KeyboardEvent) {
  if (!donationVisible.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDonation();
  } else if (event.key === 'Tab') {
    const controls = donationCard.value?.querySelectorAll<HTMLElement>('button, a[href]');
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    const outside = !donationCard.value?.contains(document.activeElement);
    if (outside || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
}
function handleServicePickerKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeServicePicker();
}
function focusServiceSearchInput() {
  const inputs = Array.isArray(serviceSearchInput.value)
    ? serviceSearchInput.value
    : [serviceSearchInput.value];
  inputs[0]?.focus();
}
function toggleServicePicker() {
  if (!config.value.on) return;
  servicePickerOpen.value = !servicePickerOpen.value;
  if (servicePickerOpen.value) {
    moreServicesOpen.value = true;
    void nextTick(focusServiceSearchInput);
  } else {
    serviceSearchQuery.value = '';
  }
}
function selectService(value: string) {
  config.value.service = value;
  servicePickerOpen.value = false;
  serviceSearchQuery.value = '';
}
function clearServiceSearch() {
  serviceSearchQuery.value = '';
  void nextTick(focusServiceSearchInput);
}
function matchingModelSummary(matchingModels: string[]) {
  const visibleModels = matchingModels.slice(0, 2);
  const remainingCount = matchingModels.length - visibleModels.length;
  return remainingCount > 0
    ? `${visibleModels.join(' · ')} +${remainingCount}`
    : visibleModels.join(' · ');
}
function toggleAIContext() {
  if (aiContextPresentation.value.toggleDisabled) return;
  config.value.enableAIContext = !config.value.enableAIContext;
}
function openAIContextSettings() {
  servicePickerOpen.value = false;
  serviceSearchQuery.value = '';
  openDrawer('aiContext');
}
onMounted(() => {
  document.addEventListener('pointerdown', closeServicePicker);
  document.addEventListener('keydown', handleServicePickerKeydown);
  document.addEventListener('keydown', handleDonationKeydown);
});
onUnmounted(() => {
  persistOnPageExit();
  window.removeEventListener('pagehide', saveOnPageHide);
  unsubscribeConfig();
  document.removeEventListener('pointerdown', closeServicePicker);
  document.removeEventListener('keydown', handleServicePickerKeydown);
  document.removeEventListener('keydown', handleDonationKeydown);
  darkMode.onchange = null;
  delete document.documentElement.dataset.popupHeight;
  if (noticeTimer) clearTimeout(noticeTimer);
});

function saveOnPageHide() {
  persistOnPageExit();
}
window.addEventListener('pagehide', saveOnPageHide);

// Firefox 可能同时触发 pagehide 和 unmounted；只执行一次关闭交接。
// 乐观配置相等不代表补丁已交给后台：先捕获尚未触发 watcher 的修改，
// 再把未确认补丁链同步交给后台接续，避免页面销毁后本地排队的下一次修改丢失。
// 空补丁链不发送消息，普通查看后关闭仍不重复保存。
function persistOnPageExit() {
  if (!hydrated.value || !config.value.uiLanguageSetupCompleted || pageExitSaveStarted) return;
  pageExitSaveStarted = true;
  void persistConfigPatch(config.value).catch((error) => console.warn('[FluentRead] popup 关闭前后台保存设置失败', error));
  void handoffPendingConfigPatches(sendConfigMessage, sendConfigMessage)
    .catch((error) => console.warn('[FluentRead] popup 关闭前交接设置失败', error));
}

function showNotice(message: string, type: 'success' | 'error' = 'success') {
  notice.value = message;
  noticeType.value = type;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 2200);
}

async function hydrateCurrentSite() {
  currentTabId.value = null;
  currentSiteDomain.value = '';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== 'number') return;
    currentTabId.value = tab.id;
    currentSiteDomain.value = getSiteBaseDomain(tab.pendingUrl || tab.url || '') || '';
    if (!currentSiteDomain.value) return;

    try {
      const response = await browser.tabs.sendMessage(tab.id, {
        type: 'getFullPageTranslationState',
      }) as { status?: string; isTranslated?: boolean } | undefined;
      if (response?.status === 'success') pageTranslated.value = response.isTranslated === true;
    } catch {
      // 当前页面可能尚未注入内容脚本；站点规则仍然可以读取和编辑。
    }
  } catch (error) {
    console.warn('[FluentRead] 无法读取当前网站', error);
  }
}

async function setCurrentSiteAlwaysTranslated(enabled: boolean) {
  const domain = currentSiteDomain.value;
  const tabId = currentTabId.value;
  if (!domain || tabId === null) return;
  if (config.value.autoTranslate) {
    showNotice('所有网站自动翻译已开启，请在完整设置中关闭全局开关');
    return;
  }
  if (currentSiteExtensionDisabled.value) {
    showNotice(`当前已在 ${domain} 禁用扩展，请先恢复扩展`);
    return;
  }

  const currentDomains = config.value.alwaysTranslateDomains ?? [];
  config.value.alwaysTranslateDomains = enabled
    ? currentDomains.includes(domain) ? currentDomains : [...currentDomains, domain]
    : currentDomains.filter(item => item !== domain);

  if (!enabled) {
    showNotice(`已关闭 ${domain} 的始终翻译，当前网页保持不变`);
    return;
  }

  if (!config.value.on) {
    showNotice(`已保存 ${domain}，启用插件后生效`);
    return;
  }
  if (credentialWarning.value) {
    showNotice(`已保存 ${domain}；${credentialWarning.value}`, 'error');
    return;
  }

  translating.value = true;
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      type: 'contextMenuTranslate',
      action: 'fullPage',
    }) as { status?: string; isTranslated?: boolean } | undefined;
    if (response?.status !== 'success') throw new Error('Translation failed');
    pageTranslated.value = typeof response.isTranslated === 'boolean' ? response.isTranslated : true;
    showNotice(`已开启 ${domain} 的始终翻译`);
  } catch (error) {
    console.error(error);
    showNotice(`已保存 ${domain}，当前网页请刷新后重试`, 'error');
  } finally {
    translating.value = false;
  }
}

function setCurrentSiteExtensionDisabled(enabled: boolean) {
  const domain = currentSiteDomain.value;
  const tabId = currentTabId.value;
  if (!domain || tabId === null) return;

  const currentDomains = config.value.disabledExtensionDomains ?? [];
  config.value.disabledExtensionDomains = enabled
    ? currentDomains.includes(domain) ? currentDomains : [...currentDomains, domain]
    : currentDomains.filter(item => item !== domain);
  pageTranslated.value = false;
  translating.value = false;

  showNotice(enabled ? `已在 ${domain} 禁用扩展` : `已恢复 ${domain} 的扩展`);
}

// 配置订阅是内容功能的唯一状态来源；避免无 revision 的广播晚到后覆盖新快照。
function setPluginEnabled(enabled: boolean) {
  config.value.on = enabled;
}

function openDrawer(name: DrawerName) { activeDrawer.value = name; drawerMounted.value = true; drawerVisible.value = true; }
async function openOptions(section?: SettingsSection) {
  if (section) {
    await browser.tabs.create({ url: `${browser.runtime.getURL('options.html')}#${section}` });
  } else {
    await browser.runtime.openOptionsPage();
  }
  window.close();
}

async function togglePageTranslation() {
  if (!pageTranslated.value && credentialWarning.value) {
    showNotice(credentialWarning.value, 'error');
    return;
  }

  translating.value = true;
  const action = pageTranslated.value ? 'restore' : 'fullPage';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!isBrowserTabId(tab?.id)) throw new Error('No active tab');
    const response = await browser.tabs.sendMessage(tab.id, { type: 'contextMenuTranslate', action }) as { status?: string; isTranslated?: boolean } | undefined;
    if (response?.status !== 'success') throw new Error(response?.status === 'disabled' ? 'Plugin disabled' : 'Translation failed');
    pageTranslated.value = typeof response.isTranslated === 'boolean'
      ? response.isTranslated
      : action === 'fullPage';
    showNotice(pageTranslated.value ? '正在翻译当前网页' : '已恢复网页原文');
  } catch (error) {
    console.error(error);
    showNotice('当前页面暂不支持翻译，请刷新后重试', 'error');
  } finally { translating.value = false; }
}

async function clearCache() {
  clearingCache.value = true;
  try {
    await requestTranslationCacheClear((message) => browser.runtime.sendMessage(message));
    showNotice('全部翻译缓存已清除');
  } catch (error) {
    console.error(error);
    showNotice('缓存清除失败', 'error');
  } finally { clearingCache.value = false; }
}

function setSelectionMode(mode: string) {
  config.value.selectionTranslatorMode = mode;
  config.value.disableSelectionTranslator = mode === 'disabled';
}
</script>
