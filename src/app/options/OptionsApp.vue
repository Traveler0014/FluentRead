<!--
 @file src/app/options/OptionsApp.vue
 文件职责：实现扩展 Options 页的顶层布局，组织设置导航、全局搜索结果和学习中心入口，并把选中分区交给对应 feature UI。
 主要内容：渲染品牌侧栏、版本信息、搜索框与主内容区，复用 settingsNavigation 的项目解析/过滤逻辑，渲染 SettingsSections 并重置内容区滚动，同步 URL hash 的深链接与前进后退导航。
 模块边界：组件负责页面壳、导航状态和界面皮肤根属性同步，不定义具体配置字段、不直接写 browser.storage，也不实现词汇仓库；设置表单、收藏与阅读记录业务由各 feature 组件拥有。
-->
<template>
  <div class="settings-app">
    <aside class="sidebar">
      <div class="brand">
        <img src="/icon/128.png" alt="" />
        <div><strong>流畅阅读</strong></div>
      </div>

      <nav ref="navigationElement" :aria-label="t('options.navLabel')">
        <section v-for="group in localizedNavigationGroups" :key="group.label" class="nav-group">
          <span class="nav-group-label">{{ group.label }}</span>
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            :data-section="item.id"
            :class="{ active: activeSection === item.id }"
            :aria-current="activeSection === item.id ? 'page' : undefined"
            @click="selectSection(item.id)"
          >
            <span class="nav-icon"><SettingsNavigationIcon :section="item.id" /></span>
            <strong>{{ item.label }}</strong>
          </button>
        </section>
      </nav>
    </aside>

    <main class="workspace">
      <InterfaceBackdrop :motif="interfaceSkin.motif" />
      <header class="topbar">
        <div>
          <h1>{{ activeItem.title }}</h1>
        </div>
        <div class="topbar-tools">
          <label class="search-box">
            <UiIcon name="search" :size="16" />
            <input v-model.trim="query" type="search" :placeholder="t('options.searchPlaceholder')" />
          </label>
        </div>
      </header>

      <div v-if="query && filteredResults.length" class="search-results">
        <button v-for="result in filteredResults" :key="result.id" type="button" @click="selectResult(result.id)">
          <span><strong>{{ result.label }}</strong><small>{{ result.searchDescription }}</small></span><b>打开 →</b>
        </button>
      </div>
      <div v-else-if="query" class="search-empty">{{ t('options.searchEmpty', {query}) }}</div>

      <section ref="settingsContentElement" class="settings-card" :class="{ 'services-view': activeSection === 'settings-services', 'translation-center-view': activeSection === 'settings-translation-center' }" :aria-label="activeItem.heading">
        <KeepAlive>
        <section v-if="activeSection === 'settings-about'" id="settings-about" class="about-page" aria-labelledby="about-title">
          <div class="about-hero">
            <img class="about-logo" src="/icon/128.png" alt="流畅阅读图标" />
            <div>
              <h3 id="about-title">{{ t('options.aboutHeroTitle') }}</h3>
              <p>{{ t('options.aboutHeroDescription') }}</p>
              <span class="about-version">FluentRead · V{{ version }}</span>
            </div>
          </div>

          <div class="about-grid">
            <article class="about-panel about-support-panel">
              <span class="about-panel-kicker">{{ t('popup.donationEyebrow') }}</span>
              <h3>{{ t('popup.donationTitle') }}</h3>
              <p>{{ t('options.aboutThanks') }}</p>
              <div class="about-support-options">
                <section class="about-support-option about-support-wechat-option">
                  <h4>{{ t('popup.donationWechat') }}</h4>
                  <a
                    class="about-support-method about-support-wechat"
                    data-support-method="wechat"
                    href="/misc/approve.jpg"
                    target="_blank"
                    rel="noopener noreferrer"
                    :aria-label="t('popup.donationOpenCode')"
                  >
                    <!-- 绑定表达式让模板编译器保留 public 路径，避免再打包一份带 hash 的同图。 -->
                    <img class="about-support-qr" :src="'/misc/approve.jpg'" :alt="t('popup.donationCodeAlt')" width="1152" height="1152" />
                  </a>
                </section>
                <section class="about-support-option about-support-kofi-option">
                  <h4>Ko-fi</h4>
                  <a
                    class="about-support-method about-support-kofi-link"
                    data-support-method="kofi"
                    href="https://ko-fi.com/thinkstu"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <strong>{{ t('popup.donationKofi') }}</strong>
                    <UiIcon name="external" :size="16" />
                  </a>
                  <span class="about-support-account">ko-fi.com/thinkstu</span>
                </section>
              </div>
            </article>

            <article class="about-panel about-links-panel">
              <span class="about-panel-kicker">{{ t('options.aboutLearnMore') }}</span>
              <h3>{{ t('options.aboutMakeBetter') }}</h3>
              <p>{{ t('options.aboutLinksDescription') }}</p>
              <div class="about-links">
                <a href="https://github.com/Bistutu/FluentRead" target="_blank" rel="noreferrer">{{ t('options.aboutProject') }} <span>↗</span></a>
                <a href="https://fluent.thinkstu.com/" target="_blank" rel="noreferrer">{{ t('options.aboutDocs') }} <span>↗</span></a>
                <a href="https://github.com/Bistutu/FluentRead/issues" target="_blank" rel="noreferrer">{{ t('options.aboutFeedback') }} <span>↗</span></a>
              </div>
            </article>
          </div>

        </section>
          <component
            v-else
            :is="SettingsSections"
            :key="'settings'"
            v-bind="contentComponentProps"
          />
        </KeepAlive>
      </section>

    </main>
  </div>
</template>

<script setup lang="ts">
import UiIcon from '@/src/ui/components/UiIcon.vue'
import {filterNavigationItems, isUiLanguageSearch} from '@/src/features/settings/model/navigation';
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import InterfaceBackdrop from '@/src/ui/components/InterfaceBackdrop.vue'
import {getInterfaceSkinOption} from '@/src/core/config/interfaceAppearance'
import SettingsNavigationIcon from '@/src/features/settings/ui/SettingsNavigationIcon.vue'
const SettingsSections = defineAsyncComponent(() => import('@/src/features/settings/ui/SettingsSections.vue'))
import {useUiI18n} from '@/src/ui/i18n'
import {
  navigationGroups,
  navigationItems,
  resolveNavigationItem,
  resolveRequestedSection,
} from '@/src/features/settings/model/navigation'
import {
  config as runtimeConfig,
  configReady,
  subscribeConfig,
} from '@/src/services/config/store'
import {applyInterfaceFont, applyInterfaceSkin} from '@/src/ui/interfaceAppearance'

const version = process.env.VUE_APP_VERSION
const {t, translateLegacy} = useUiI18n()
const query = ref('')
const interfaceSkin = ref(getInterfaceSkinOption(runtimeConfig.interfaceSkin))
const activeSection = ref(resolveRequestedSection(window.location.hash))
const navigationElement = ref<HTMLElement | null>(null)
const settingsContentElement = ref<HTMLElement | null>(null)
const mobileNavigationMedia = window.matchMedia('(max-width: 700px)')

const navigation = navigationItems
const contentComponentProps = computed(() => ({activeSection: activeSection.value}))
const localizedNavigationGroups = computed(() => navigationGroups.map((group) => ({
  ...group,
  label: translateLegacy(group.label),
  items: group.items.map((item) => ({
    ...item,
    label: translateLegacy(item.label),
    description: translateLegacy(item.description),
    heading: translateLegacy(item.heading),
    summary: translateLegacy(item.summary),
    kicker: translateLegacy(item.kicker),
    title: translateLegacy(item.title),
    detail: translateLegacy(item.detail),
    searchDescription: item.id === 'settings-interface'
      ? `${translateLegacy(item.searchDescription)} ${t('settings.interface.font.label')} Inter Noto Sans SC Roboto Source Sans 3 IBM Plex Sans Manrope Nunito Sans LXGW WenKai Noto Serif SC`
      : translateLegacy(item.searchDescription),
  })),
})))
const localizedNavigationItems = computed(() => localizedNavigationGroups.value.flatMap((group) => group.items))
const activeItem = computed(() => localizedNavigationItems.value.find((item) => item.id === resolveNavigationItem(activeSection.value).id)
  || localizedNavigationItems.value[0])
const unsubscribeInterfaceConfig = subscribeConfig((nextConfig) => {
  interfaceSkin.value = getInterfaceSkinOption(nextConfig.interfaceSkin)
  applyInterfaceSkin(nextConfig.interfaceSkin)
  applyInterfaceFont(nextConfig.interfaceFont)
})

void configReady
  .then(() => {
    interfaceSkin.value = getInterfaceSkinOption(runtimeConfig.interfaceSkin)
    applyInterfaceSkin(runtimeConfig.interfaceSkin)
    applyInterfaceFont(runtimeConfig.interfaceFont)
  })
  .catch(() => {
    applyInterfaceSkin('default')
    applyInterfaceFont('system')
  })

const filteredResults = computed(() => filterNavigationItems(query.value, localizedNavigationItems.value).map(item =>
  item.id === 'settings-general' && isUiLanguageSearch(query.value)
    ? {...item, label: `${t('language.selectorLabel')} / Language`, searchDescription: t('language.settingsDescription')}
    : item))

function selectSection(id: string) {
  if (!navigation.some((item) => item.id === id)) return
  activeSection.value = id
  query.value = ''
  if (window.location.hash !== `#${id}`) {
    history.replaceState(null, '', `#${id}`)
  }
  // 分区 DOM 更新后归零真正的内容滚动区，避免切换菜单仍停留在上个长表单的底部。
  void nextTick(() => settingsContentElement.value?.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
}

async function selectResult(id: string) {
  const revealLanguage = id === 'settings-general' && isUiLanguageSearch(query.value)
  selectSection(id)
  if (revealLanguage) {
    await nextTick()
    const control = document.querySelector<HTMLElement>('[data-testid="ui-language-select"] input')
    control?.scrollIntoView({block: 'center'})
    control?.focus()
  }
}

async function revealActiveNavigation() {
  await nextTick()
  navigationElement.value
    ?.querySelector<HTMLElement>(`button[data-section="${activeSection.value}"]`)
    ?.scrollIntoView({
      block: 'nearest',
      inline: mobileNavigationMedia.matches ? 'center' : 'nearest',
    })
}

watch(activeSection, () => {
  void revealActiveNavigation()
})

function handleMobileNavigationChange() {
  void revealActiveNavigation()
}

function syncSectionFromHash() {
  selectSection(resolveRequestedSection(window.location.hash))
}

onMounted(() => {
  syncSectionFromHash()
  window.addEventListener('hashchange', syncSectionFromHash)
  mobileNavigationMedia.addEventListener('change', handleMobileNavigationChange)
  void revealActiveNavigation()
})

onBeforeUnmount(() => {
  unsubscribeInterfaceConfig()
  window.removeEventListener('hashchange', syncSectionFromHash)
  mobileNavigationMedia.removeEventListener('change', handleMobileNavigationChange)
})
</script>
