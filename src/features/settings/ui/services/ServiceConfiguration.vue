<!--
 * @file src/features/settings/ui/services/ServiceConfiguration.vue
 * 文件职责：渲染当前翻译服务的详细连接配置，按连接配置、翻译偏好、请求设置和自定义请求分组显示端点、区域、计费方式、密钥（含云服务厂商的成对密钥与服务区域）、Ollama 本地地址、代理、提示词、自定义请求体和请求头等字段，以及服务和模型的独立请求限制。
 * 主要内容：组件派生字段可见性与 DeepL/MiniMax/MiMo endpoint，展示 DeepLX 完整地址与 Token 示例，将成对密钥的 ID 编辑同步到 apiKeys 和兼容 token，管理所有服务可空 Key 发起的连接检查、配置与消息等待超时、Chrome 当前语言对的点击准备及进度，并通过配置 store 提交修改。
 * 模块边界：本组件不执行网页正文翻译或保存公开配置中的明文凭据；Chrome 内置翻译仅在当前点击页完成模型自检，其他连接测试经后台消息，字段规则来自 core/config，服务切换由 ServiceCatalog 和 SettingsSections 负责。
 -->
<template>
  <section
    class="settings-section service-connection-section"
    :data-service-configuration-service="service"
    :data-custom-service-configuration="compute.showCustomOpenAI ? 'true' : 'false'"
    :data-ai-advanced-settings="compute.showAI ? 'true' : 'false'"
  >
    <FreeTranslationSettings v-if="service === services.freeTranslation" :config="config" :advanced="false" />

    <Teleport v-if="connectionActionTarget" :to="connectionActionTarget">
    <section class="service-connection-action">
    <div class="connection-test-inline">

        <button
          type="button"
          class="connection-test-button"
          data-connection-test-button
          :disabled="connectionTestBusy && !usesApiKeyList"
          @click="connectionTestBusy ? stopApiKeyChecks() : testConnection()"
        >
          <svg v-if="connectionTestBusy && usesApiKeyList" class="connection-action-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          <svg v-else class="connection-action-icon" :class="{ 'is-spinning': connectionTestBusy }" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
          {{ connectionTestBusy ? (usesApiKeyList ? translateLegacy('停止检查') : t('settings.services.keys.checking')) : t('settings.services.keys.checkConnection') }}
        </button>
    </div>

    <span
      v-if="service === services.freeTranslation"
      class="header-connection-status"
      :class="`is-${connectionTestState}`"
      :title="connectionTestMessage"
      data-connection-test-status
      role="status"
      aria-live="polite"
    >
      {{ connectionTestMessage ? connectionTestTitle : '' }}
    </span>

    </section>
    </Teleport>
    <section v-if="service !== services.freeTranslation" class="connection-card" data-configuration-group="connection">
      <header class="configuration-group-heading"><h5>连接配置</h5></header>
    <template v-if="service === services.myMemory">
      <div class="connection-field" data-mymemory-email>
        <div class="connection-field-label"><strong>联系邮箱（可选）</strong><small>不填写也可以使用</small></div>
        <div class="connection-field-control">
          <el-input v-model="myMemoryEmailDraft" type="email" aria-label="MyMemory 联系邮箱" placeholder="不填写也可以使用" :aria-invalid="myMemoryEmailInvalid" @change="commitMyMemoryEmail" />
          <small v-if="myMemoryEmailInvalid" class="field-warning" role="status">请输入有效邮箱，或留空。</small>
        </div>
      </div>
      <div class="official-translation-help" data-mymemory-help>
        <p>匿名每天 5,000 字符；提供有效邮箱后每天 50,000 字符。邮箱会随请求发送给 MyMemory。</p>
        <p>自动识别来源语言时使用本地检测；无法可靠识别时，请手动选择来源语言。</p>
        <a href="https://mymemory.translated.net/doc/usagelimits.php" target="_blank" rel="noreferrer">官方额度说明</a>
      </div>
    </template>

    <div v-if="isChromeConnectionTest" class="chrome-preparation-help" data-chrome-preparation-help>
      <p class="chrome-preparation-pair" data-chrome-preparation-language-pair>
        <strong>{{ t('settings.services.chromePreparation.sourceLabel') }}</strong>
        <span>{{ currentChromePreparationPairLabel || t('settings.services.chromePreparation.invalidPair') }}</span>
      </p>
      <p>{{ t('settings.services.chromePreparation.sourceDescription') }}</p>
      <details>
        <summary>{{ t('settings.services.chromePreparation.helpSummary') }}</summary>
        <p>{{ t('settings.services.chromePreparation.helpBody') }}</p>
        <p>{{ t('settings.services.chromePreparation.helpLimitations') }}</p>
        <p><code>chrome://on-device-internals</code></p>
        <p class="chrome-preparation-help-links">
          <a href="https://developer.chrome.com/docs/ai/translator-api" target="_blank" rel="noreferrer">{{ t('settings.services.chromePreparation.helpApi') }}</a>
          <a href="https://developer.chrome.com/docs/ai/language-detection" target="_blank" rel="noreferrer">{{ t('settings.services.chromePreparation.helpDetector') }}</a>
          <a href="https://developer.chrome.com/docs/ai/debug-built-in-model" target="_blank" rel="noreferrer">{{ t('settings.services.chromePreparation.helpDebug') }}</a>
          <a href="https://chrome.dev/web-ai-demos/translation-language-detection-api-playground/" target="_blank" rel="noreferrer">{{ t('settings.services.chromePreparation.helpDemo') }}</a>
        </p>
      </details>
    </div>

    <template v-if="compute.showCustomOpenAI && customProvider">
      <div class="connection-field" data-testid="custom-service-name-row">
        <div class="connection-field-label"><strong>服务名称</strong><small>仅用于识别此接口</small></div>
        <div class="connection-field-control">
          <el-input
            :model-value="customProvider.name"
            aria-label="自定义服务名称"
            data-testid="custom-service-edit-name"
            placeholder="请输入服务名称"
            :maxlength="MAX_CUSTOM_OPENAI_PROVIDER_NAME_LENGTH"
            @update:model-value="updateCustomProvider('name', String($event))"
          />
        </div>
      </div>
      <div class="connection-field" data-testid="custom-service-endpoint-row">
        <div class="connection-field-label"><strong>接口地址</strong><small>OpenAI Chat Completions 兼容地址</small></div>
        <div class="connection-field-control">
          <el-input
            :model-value="customProvider.endpoint"
            aria-label="自定义服务接口地址"
            data-testid="custom-service-edit-endpoint"
            placeholder="http://localhost:11434/v1/chat/completions"
            :maxlength="MAX_CUSTOM_OPENAI_PROVIDER_ENDPOINT_LENGTH"
            @update:model-value="updateCustomProvider('endpoint', String($event))"
          />
          <p class="provider-field-help">支持完整 Chat Completions 地址或以 /v1 结尾的 Base URL；模型须支持 Chat Completions。</p>
        </div>
      </div>
    </template>

    <div v-if="service === services.deepL" class="connection-field" data-deepl-api-plan>
      <div class="connection-field-label">
        <strong>{{ t('settings.services.deepl.plan') }}</strong>
      </div>
      <div class="connection-field-control">
        <el-select v-model="config.deeplApiPlan" :aria-label="t('settings.services.deepl.plan')">
          <el-option value="free" :label="t('settings.services.deepl.free')" />
          <el-option value="pro" :label="t('settings.services.deepl.pro')" />
        </el-select>
        <p class="provider-field-help">{{ t('settings.services.deepl.planHelp') }}</p>
        <p class="provider-field-help" data-deepl-endpoint>
          {{ t('settings.services.deepl.endpoint') }}<br /><code>{{ deeplEndpoint }}</code>
        </p>
        <p v-if="config.proxy[service]?.trim()" class="provider-field-help" data-deepl-proxy-override>
          {{ t('settings.services.deepl.proxyOverride') }}
        </p>
      </div>
    </div>

    <div v-if="compute.showOllamaEndpoint" class="connection-field" data-ollama-endpoint>
      <div class="connection-field-label">
        <strong>服务地址</strong>
        <small>本机默认无需修改</small>
      </div>
      <div class="connection-field-control">
        <el-input v-model="config.proxy[service]" aria-label="Ollama 服务地址" :placeholder="DEFAULT_OLLAMA_ENDPOINT" />
        <p class="provider-field-help">留空时使用本机默认地址；局域网主机请填写完整的 Chat Completions 地址。</p>
        <p class="provider-field-help"><code>{{ DEFAULT_OLLAMA_ENDPOINT }}</code></p>
        <p class="provider-field-help">浏览器扩展访问 Ollama 前，需要在启动 Ollama 时设置环境变量 OLLAMA_ORIGINS=*，否则会被跨域拒绝。</p>
      </div>
    </div>

    <div v-if="compute.showToken && compute.showServiceSecret" class="connection-field credential-field" :data-cloud-credential="compute.showCloudVendor ? 'token' : undefined">
      <div class="connection-field-label">
        <strong>{{ compute.showCloudVendor ? compute.cloudCredentialLabels.token : 'API Key' }}</strong>
        <small>{{ compute.showCloudVendor ? '来自厂商控制台' : (effectiveModelLabel || '当前模型') }}</small>
      </div>
      <div class="connection-field-control credential-control">
        <el-input
          :model-value="apiKeys[0] || ''"
          @update:model-value="updateApiKey(0, String($event))"
          type="password"
          show-password
          :aria-label="compute.showCloudVendor ? compute.cloudCredentialLabels.token : 'API Key'"
          :placeholder="compute.showCloudVendor ? `输入 ${compute.cloudCredentialLabels.token}；留空表示尚未配置` : '输入 API Key；留空表示尚未配置'"
        />
        <div v-if="compute.showAI" class="api-key-requirement">
          <span>{{ compute.requireApiKey ? '此模型需要 API Key' : '允许无 Key 请求' }}</span>
          <el-switch v-model="compute.requireApiKey" aria-label="当前模型是否需要 API Key" size="small" />
        </div>
      </div>
    </div>
    <div v-if="compute.showServiceSecret" class="connection-field credential-field" data-cloud-credential="secret">
      <div class="connection-field-label">
        <strong>{{ compute.cloudCredentialLabels.secret }}</strong>
        <small>与上方密钥成对使用</small>
      </div>
      <div class="connection-field-control credential-control">
        <el-input
          v-model="config.secret[service]"
          type="password"
          show-password
          :aria-label="compute.cloudCredentialLabels.secret"
          :placeholder="`输入 ${compute.cloudCredentialLabels.secret}；留空表示尚未配置`"
        />
      </div>
    </div>

    <div v-if="compute.showServiceRegion" class="connection-field" data-cloud-region>
      <div class="connection-field-label">
        <strong>服务区域</strong>
        <small>需与控制台资源所在区域一致</small>
      </div>
      <div class="connection-field-control">
        <el-select
          :model-value="config.serviceRegion[service] || compute.defaultCloudRegion"
          aria-label="云服务区域"
          placeholder="请选择服务区域"
          @update:model-value="config.serviceRegion[service] = String($event)"
        >
          <el-option
            v-for="item in compute.cloudRegionOptions"
            :key="item.value"
            class="select-left"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <p v-if="service === services.aliyunTranslation" class="provider-field-help" data-cloud-region-endpoint>
          <span>当前接口地址</span><br /><code>{{ getAliyunTranslationEndpoint(config.serviceRegion[service]) }}</code>
        </p>
        <p v-else-if="service === services.azureTranslator" class="provider-field-help">
          选择全球区域时不发送区域请求头；其余区域会通过 Ocp-Apim-Subscription-Region 请求头一并发送。
        </p>
      </div>
    </div>
    <p v-if="compute.showMiniMaxRegion && minimaxKeyMismatch" class="minimax-key-note is-warning">
      {{ minimaxKeyMismatch }}
    </p>

    <div v-if="compute.showMiniMaxRegion" class="provider-account-fields">
    <div v-if="compute.showMiniMaxRegion" class="connection-field"><div class="connection-field-label"><strong>MiniMax 计费方式</strong><el-tooltip content="按量付费和 Token Plan 使用不同的账户权益；请按控制台中 Key 的来源选择。" placement="top" :show-after="300"><button type="button" class="field-help-button" aria-label="按量付费和 Token Plan 使用不同的账户权益；请按控制台中 Key 的来源选择。"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg></button></el-tooltip></div><div class="connection-field-control"><el-select v-model="config.minimaxBillingPlan" aria-label="MiniMax 计费方式" placeholder="请选择 MiniMax 计费方式">
          <el-option class="select-left" v-for="item in options.minimaxBillingPlan" :key="item.value" :label="item.label" :value="item.value" />
        </el-select></div></div>

    <div v-if="compute.showMiniMaxRegion" class="connection-field"><div class="connection-field-label"><strong>MiniMax 区域</strong><el-tooltip content="选择与 MiniMax Key 来源一致的 API 区域。Token Plan Key（sk-cp-）和按量付费 Key 不能互换。" placement="top" :show-after="300"><button type="button" class="field-help-button" aria-label="选择与 MiniMax Key 来源一致的 API 区域。Token Plan Key（sk-cp-）和按量付费 Key 不能互换。"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg></button></el-tooltip></div><div class="connection-field-control"><el-select v-model="config.minimaxRegion" aria-label="MiniMax API 区域" placeholder="请选择 MiniMax API 区域">
          <el-option class="select-left" v-for="item in options.minimaxRegion" :key="item.value" :label="item.label" :value="item.value" />
        </el-select></div></div>
    </div>
    <p v-if="compute.showMiniMaxRegion" class="provider-field-help minimax-endpoint" data-minimax-endpoint><code>{{ minimaxEndpoint }}</code></p>


    <p v-if="compute.showMiMoRegion && mimoKeyMismatch" class="mimo-key-note is-warning">
      {{ mimoKeyMismatch }}
    </p>

    <div v-if="compute.showMiMoRegion" class="provider-account-fields">
    <div v-if="compute.showMiMoRegion" class="connection-field"><div class="connection-field-label"><strong>小米 MiMo 计费方式</strong><el-tooltip content="按量付费和 Token Plan 使用不同的账户权益；请按小米 MiMo 控制台中 Key 的来源选择。" placement="top" :show-after="300"><button type="button" class="field-help-button" aria-label="按量付费和 Token Plan 使用不同的账户权益；请按小米 MiMo 控制台中 Key 的来源选择。"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg></button></el-tooltip></div><div class="connection-field-control"><el-select v-model="config.mimoBillingPlan" aria-label="小米 MiMo 计费方式" placeholder="请选择小米 MiMo 计费方式">
          <el-option class="select-left" v-for="item in options.mimoBillingPlan" :key="item.value" :label="item.label" :value="item.value" />
        </el-select></div></div>

    <div v-if="compute.showMiMoRegion" class="connection-field"><div class="connection-field-label"><strong>MiMo API 集群</strong><el-tooltip content="Token Plan 必须使用购买页面提供的集群地址；中国、新加坡和欧洲集群的 tp- Key 不能混用。按量付费统一使用 api.xiaomimimo.com。" placement="top" :show-after="300"><button type="button" class="field-help-button" aria-label="Token Plan 必须使用购买页面提供的集群地址；中国、新加坡和欧洲集群的 tp- Key 不能混用。按量付费统一使用 api.xiaomimimo.com。"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg></button></el-tooltip></div><div class="connection-field-control"><el-select v-model="config.mimoRegion" aria-label="小米 MiMo API 集群" placeholder="请选择小米 MiMo API 集群">
          <el-option class="select-left" v-for="item in options.mimoRegion" :key="item.value" :label="item.label" :value="item.value" />
        </el-select></div></div>
    </div>
    <p v-if="compute.showMiMoRegion" class="provider-field-help mimo-endpoint" data-mimo-endpoint><code>{{ mimoEndpoint }}</code></p>


    <div v-if="compute.showAzureOpenaiEndpoint" class="connection-field" data-azure-endpoint>
      <div class="connection-field-label">
        <strong>{{ t('settings.services.azure.endpoint') }}</strong>
      </div>
      <div class="connection-field-control">
        <el-input v-model="config.azureOpenaiEndpoint" :aria-label="t('settings.services.azure.endpoint')" placeholder="https://your-resource.services.ai.azure.com/openai/v1/" :class="{ 'input-error': config.azureOpenaiEndpoint && !isValidAzureEndpoint(config.azureOpenaiEndpoint) }" />
        <div v-if="config.azureOpenaiEndpoint && !isValidAzureEndpoint(config.azureOpenaiEndpoint)" class="error-text" role="alert">{{ t('settings.services.azure.endpointError') }}</div>
        <p class="provider-field-help">{{ t('settings.services.azure.endpointHelp') }}</p>
        <p class="provider-field-help">{{ t('settings.services.azure.deploymentHelp') }}</p>
      </div>
    </div>

    <div v-if="compute.showDeepLX" class="connection-field" data-deeplx-endpoint>
      <div class="connection-field-label"><strong>{{ t('settings.services.deeplx.endpoint') }}</strong></div>
      <div class="connection-field-control">
        <el-input v-model="config.deeplx" :aria-label="t('settings.services.deeplx.endpoint')" :placeholder="DEFAULT_DEEPLX_ENDPOINT" aria-describedby="deeplx-endpoint-help" />
        <div id="deeplx-endpoint-help">
          <p class="provider-field-help">{{ t('settings.services.deeplx.endpointHelp') }}</p>
          <p class="provider-field-help">无需密钥的接口可留空；需要验证时填写 Token。</p>
          <details class="endpoint-token-help"><summary>Token 使用方式</summary>
          <p class="provider-field-help">{{ t('settings.services.deeplx.tokenHelp') }}</p>
          <p class="provider-field-help">{{ t('settings.services.deeplx.queryToken') }} <code v-pre>https://deeplx.example.com/translate?token={{apiKey}}</code></p>
          <p class="provider-field-help">{{ t('settings.services.deeplx.pathToken') }} <code v-pre>https://deeplx.example.com/{{apiKey}}/translate</code></p>
          <p class="provider-field-help">{{ t('settings.services.deeplx.placeholderHelp') }}</p>
          </details>
          <p v-if="config.proxy[service]?.trim()" class="provider-field-help">{{ t('settings.services.deeplx.proxyHelp') }}</p>
        </div>
      </div>
    </div>

    <div v-if="compute.showAkSk" class="connection-field"><div class="connection-field-label"><strong>API Key</strong></div><div class="connection-field-control"><el-input v-model="config.ak" aria-label="API Key" placeholder="请输入Access Key" /><p class="provider-field-help">服务商提供的访问密钥。</p></div></div>
    <div v-if="compute.showAkSk" class="connection-field"><div class="connection-field-label"><strong>Secret Key</strong></div><div class="connection-field-control"><el-input v-model="config.sk" aria-label="Secret Key" type="password" placeholder="请输入Secret Key" /><p class="provider-field-help">服务商提供的私密密钥，请妥善保管。</p></div></div>

    <div v-if="compute.showYoudao" class="connection-field"><div class="connection-field-label"><strong>App Key</strong></div><div class="connection-field-control"><el-input v-model="config.youdaoAppKey" aria-label="App Key" placeholder="有道 AppKey" /><p class="provider-field-help">有道翻译服务提供的 App Key。</p></div></div>
    <div v-if="compute.showYoudao" class="connection-field"><div class="connection-field-label"><strong>App Secret</strong></div><div class="connection-field-control"><el-input v-model="config.youdaoAppSecret" aria-label="App Secret" type="password" show-password placeholder="有道 AppSecret" /><p class="provider-field-help">有道翻译服务提供的 App Secret。</p></div></div>

    <div v-if="compute.showTencent" class="connection-field"><div class="connection-field-label"><strong>Secret ID</strong></div><div class="connection-field-control"><el-input v-model="config.tencentSecretId" aria-label="Secret ID" placeholder="腾讯云 SecretId" /><p class="provider-field-help">腾讯云翻译服务提供的 SecretId。</p></div></div>
    <div v-if="compute.showTencent" class="connection-field"><div class="connection-field-label"><strong>Secret Key</strong></div><div class="connection-field-control"><el-input v-model="config.tencentSecretKey" aria-label="Secret Key" type="password" show-password placeholder="腾讯云 SecretKey" /><p class="provider-field-help">腾讯云翻译服务提供的 SecretKey。</p></div></div>

    <div v-if="compute.showNewAPI" class="connection-field"><div class="connection-field-label"><strong>NewAPI接口</strong></div><div class="connection-field-control"><el-input v-model="config.newApiUrl" aria-label="接口地址" placeholder="请输入您的New API接口地址" /><p class="provider-field-help">填写 New API 服务的接口地址。</p></div></div>

    <ApiKeyList
      v-if="compute.showToken && !compute.showServiceSecret"
      :label="service === services.deeplx && !deepLXRequiresToken ? translateLegacy('API Key（可选）') : compute.showCloudVendor ? compute.cloudCredentialLabels.token : 'API Key'"
      :data-cloud-credential="compute.showCloudVendor ? 'token' : undefined"
      :keys="displayedApiKeys" :states="apiKeyChecks" :summary="apiKeySummary" :busy="connectionTestBusy"
      :allow-multiple="apiKeyRotationEnabled"
      :connection-state="standaloneApiKeyCheck" :check-mode="apiKeyCheckMode"
      @add="addApiKey" @update="updateApiKey" @remove="removeApiKey" @test="testSingleApiKey"
    />
    <p v-if="service === services.deeplx && deepLXRequiresToken && !apiKeyIndexes.length" class="field-warning" data-deeplx-key-required role="status">{{ deepLXTokenHelp }}</p>

    <div
      v-if="connectionTestMessage && (!compute.showToken || compute.showServiceSecret)"
      class="connection-test-result"
      :class="`is-${connectionTestState}`"
      data-connection-test-status
      role="status"
      aria-live="polite"
    >
      <strong>{{ connectionTestTitle }}</strong>
      <span>{{ connectionTestMessage }}</span>
      <details v-if="connectionTestDetails" class="connection-test-details">
        <summary>{{ t('settings.services.chromePreparation.errorDetailsSummary') }}</summary>
        <code>{{ connectionTestDetails }}</code>
      </details>
    </div>
    </section>

    <details :key="service + '-advanced-settings'" class="custom-advanced-settings" data-configuration-group="advanced" data-testid="custom-service-advanced">
      <summary><strong>高级设置</strong><svg class="advanced-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg></summary>
      <div class="advanced-groups">
    <section :key="service + '-keys'" v-if="compute.showToken && !compute.showServiceSecret" class="advanced-group" data-configuration-group="keys" >
      <header class="advanced-group-heading"><span class="advanced-summary-copy"><strong>密钥与认证</strong><small>管理多 Key 轮换与验证方式</small></span></header>
      <div class="custom-advanced-content">
        <div v-if="compute.showToken && !compute.showServiceSecret" class="connection-field api-key-rotation-setting" data-api-key-rotation-setting>
          <div class="connection-field-label">
            <strong>{{ t('settings.services.keys.multiKeyTitle') }}</strong>
            <small>{{ t('settings.services.keys.multiKeyHelp') }}</small>
          </div>
          <div class="connection-field-control">
            <el-switch
              :model-value="apiKeyRotationEnabled"
              :aria-label="t('settings.services.keys.multiKeyTitle')"
              @update:model-value="setApiKeyRotationEnabled"
            />
          </div>
        </div>
        <div v-if="compute.showAI && compute.showToken && !compute.showServiceSecret" class="connection-field" data-api-key-auth-policy>
          <div class="connection-field-label">
            <strong>{{ t('settings.services.keys.authRequired') }}</strong>
            <small>{{ t('settings.services.keys.authHelp') }}</small>
          </div>
          <div class="connection-field-control">
            <el-switch v-model="compute.requireApiKey" :aria-label="t('settings.services.keys.authRequired')" />
          </div>
        </div>
      </div>
    </section>
    <section :key="service + '-translation'" v-if="compute.showAI" class="advanced-group" data-configuration-group="translation" >
      <header class="advanced-group-heading"><span class="advanced-summary-copy"><strong>翻译偏好</strong><small>调整当前模型的思考、识图与提示词</small></span></header>
      <div class="custom-advanced-content">
          <div v-if="compute.showModel" class="connection-field" data-testid="model-thinking-control">
            <div class="connection-field-label">
              <strong>Thinking</strong>
              <small>{{ effectiveModelLabel || '当前模型' }}</small>
            </div>
            <div class="connection-field-control model-thinking-setting">
              <small>默认关闭；仅在已适配接口生效，无法关闭时使用最低档</small>
              <el-switch
                :model-value="selectedModelThinking"
                :disabled="!effectiveModelLabel"
                aria-label="当前模型是否启用 Thinking"
                @update:model-value="$emit('update:model-thinking', Boolean($event))"
              />
            </div>
          </div>

          <div v-if="compute.showModel" class="connection-field" data-testid="model-vision-control">
            <div class="connection-field-label">
              <strong>{{ t('settings.services.visionCapability') }}</strong>
              <small>{{ effectiveModelLabel || t('settings.services.currentModel') }}</small>
            </div>
            <div class="connection-field-control model-vision-setting">
              <el-select v-model="visionOverride" data-testid="model-vision-capability" :aria-label="t('settings.services.visionCapability')" :disabled="!supportsVisionTransport(service, effectiveModelLabel)">
                <el-option value="auto" :label="t('settings.services.visionAuto')" />
                <el-option value="supported" :label="t('settings.services.visionSupported')" />
                <el-option value="unsupported" :label="t('settings.services.visionTextOnly')" />
              </el-select>
              <small>{{ t(visionCapabilityMessage) }}</small>
            </div>
          </div>

          <div class="custom-template-heading">
            <div>
              <strong>请求模板</strong>
              <small>修改会自动保存到当前 AI 服务；可用变量可以一键插入。</small>
            </div>
            <el-button type="primary" link size="small" @click="resetCustomTemplate">恢复默认模板</el-button>
          </div>

          <div class="prompt-template-list" data-testid="prompt-template-list">
            <PromptTemplateEditor v-model="config.system_role[service]" role="system" />
            <PromptTemplateEditor v-model="config.user_role[service]" role="user" />
          </div>

      </div>
    </section>
    <section :key="service + '-requests'" class="advanced-group" data-configuration-group="requests" >
      <header class="advanced-group-heading"><span class="advanced-summary-copy"><strong>请求设置</strong><small>调整请求频率、等待时间与连接方式</small></span></header>
      <div class="custom-advanced-content">
        <FreeTranslationSettings v-if="service === services.freeTranslation" :config="config" :advanced="true" />
        <RequestLimitSettings :config="config" :service="service" :model="compute.showModel ? effectiveModelLabel : undefined" />
        <div v-if="compute.showDeepseekApiType" class="connection-field"><div class="connection-field-label"><strong>API 格式</strong></div><div class="connection-field-control"><el-select v-model="config.deepseekApiType" aria-label="API 格式" placeholder="请选择 API 格式"><el-option class="select-left" v-for="item in options.deepseekApiType" :key="item.value" :label="item.label" :value="item.value" /></el-select><p class="provider-field-help">选择 DeepSeek 接口使用的 API 格式。</p></div></div>

          <div v-if="compute.showAI && compute.showProxy" class="connection-field"><div class="connection-field-label"><strong>代理地址</strong></div><div class="connection-field-control"><el-input v-model="config.proxy[service]" aria-label="代理地址" placeholder="默认直连自定义接口" /><p class="provider-field-help">可选的代理地址；填写后，当前 AI 服务请求会优先发送到这里。</p></div></div>

      </div>
    </section>
    <section :key="service + '-advanced'" v-if="compute.showCustomBody || Boolean(customProvider)" class="advanced-group" data-configuration-group="custom-request">
      <header class="advanced-group-heading"><span class="advanced-summary-copy"><strong>自定义请求</strong><small>为兼容接口补充请求头或 JSON 参数</small></span></header>
      <div class="custom-advanced-content">
          <div v-if="customProvider" class="connection-field custom-headers-field" data-testid="custom-service-headers">
            <div class="connection-field-label"><strong>自定义请求头</strong></div>
            <div class="connection-field-control">
              <el-input v-model="config.customHeaders[service]" type="textarea" :rows="3"
                aria-label="自定义请求头" :spellcheck="false" :class="{ 'input-error': !isValidCustomHeaders(config.customHeaders[service]) }"
                placeholder='{"x-opencode-session": "your-stable-session-id"}' />
              <small class="custom-headers-help">填写字符串值组成的 JSON 对象，仅发送给当前自定义服务；同名请求头会覆盖默认值。留空不启用。</small>
              <div v-if="!isValidCustomHeaders(config.customHeaders[service])" class="error-text">请输入有效的请求头 JSON 对象，名称和值必须符合 HTTP 格式</div>
            </div>
          </div>

          <div v-if="compute.showCustomBody" class="connection-field"><div class="connection-field-label"><strong>自定义请求体</strong></div><div class="connection-field-control"><el-input v-model="config.customBody[service]" type="textarea" :rows="3" aria-label="自定义请求体" :class="{ 'input-error': !isValidCustomBody(config.customBody[service]) }" placeholder='例如：{"thinking": {"type": "disabled"}}' />
              <p class="provider-field-help">填写要合并到翻译请求中的 JSON 参数对象。</p><div v-if="!isValidCustomBody(config.customBody[service])" class="error-text">请输入合法的 JSON 对象，否则该配置将被忽略</div></div></div>


      </div>
    </section>
        <div v-if="compute.showCustomOpenAI" class="service-maintenance-actions">
          <button type="button" class="delete-service-button" data-testid="custom-service-delete" @click="confirmDeleteProvider">删除服务</button>
        </div>
      </div>
    </details>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import type { Config } from '@/src/core/config/model'
import type { TranslationParams } from '@/src/core/i18n'
import { defaultOption, options as optionConfig, resolveConfiguredModel, services } from '@/src/core/config/catalog'
import {
  MAX_CUSTOM_OPENAI_PROVIDER_ENDPOINT_LENGTH,
  MAX_CUSTOM_OPENAI_PROVIDER_NAME_LENGTH,
  type CustomOpenAIProvider,
} from '@/src/core/config/customOpenAI'
import { isValidCustomBody } from '@/src/core/config/customBody'
import { isValidCustomHeaders } from '@/src/core/config/customHeaders'
import { createApiKeyCheckRevision } from '@/src/core/config/apiKeyCheckIdentity'
import { normalizeMyMemoryEmail } from '@/src/core/config/freeTranslation'
import { DEFAULT_DEEPLX_ENDPOINT, requiresDeepLXToken } from '@/src/core/config/deeplx'
import { getDeepLEndpoint } from '@/src/core/config/deepl'
import browser from 'webextension-polyfill'
import { requestConfigSave, waitForConfigPersistenceQueue } from '@/src/services/config/store'
import { CONNECTION_TEST_MESSAGE, DEFAULT_OLLAMA_ENDPOINT, getAliyunTranslationEndpoint, getMimoEndpoint, MINIMAX_ENDPOINTS } from '@/src/core/config/constants'
import { chromeTranslationPreparationStore } from '@/src/platform/browser/chromeTranslationPreparationRequest'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
    ChromeTranslationPreparationError,
    getChromeTranslationPreparationLanguageLabel,
    prepareChromeTranslationInPage,
    resolveChromeTranslationPreparationPair,
    type ChromeTranslationPreparationErrorCode,
    type ChromeTranslationPreparationPair,
    type ChromeTranslationPreparationStatus,
} from '@/src/features/settings/model/chromeTranslationPreparation'
import { useUiI18n } from '@/src/ui/i18n'
import PromptTemplateEditor from './PromptTemplateEditor.vue'
import FreeTranslationSettings from './FreeTranslationSettings.vue'
import ApiKeyList from './ApiKeyList.vue'
import { normalizeApiKeyList, eligibleApiKeyIndexes, summarizeApiKeyChecks, type ApiKeyCheckState, type ApiKeySummary } from './apiKeyTypes'
import {resolveModelVisionCapability, supportsVisionTransport} from '@/src/core/config/vision'
import RequestLimitSettings from './RequestLimitSettings.vue'

const props = defineProps<{
  config: Config
  service: string
  selectedModelThinking: boolean
  compute: Record<string, any>
  options: typeof optionConfig
  isValidAzureEndpoint: (endpoint: string) => boolean
  customProvider?: CustomOpenAIProvider
  connectionActionTarget?: HTMLElement | null
}>()

const emit = defineEmits<{
  'update:model-thinking': [value: boolean]
  'update:custom-provider': [patch: Partial<Pick<CustomOpenAIProvider, 'name' | 'endpoint'>>]
  'delete:custom-provider': []
}>()

const config = toRef(props, 'config')
const service = toRef(props, 'service')
const compute = toRef(props, 'compute')
const options = toRef(props, 'options')
const isValidAzureEndpoint = toRef(props, 'isValidAzureEndpoint')
const customProvider = toRef(props, 'customProvider')
const { language, t, translateLegacy } = useUiI18n()
const myMemoryEmailDraft = ref(config.value.myMemoryEmail)
const myMemoryEmailInvalid = computed(() => Boolean(myMemoryEmailDraft.value.trim() && !normalizeMyMemoryEmail(myMemoryEmailDraft.value)))
watch(() => config.value.myMemoryEmail, value => { myMemoryEmailDraft.value = value })

function commitMyMemoryEmail(): void {
  if (myMemoryEmailInvalid.value) return
  config.value.myMemoryEmail = normalizeMyMemoryEmail(myMemoryEmailDraft.value)
}

const deepLXTokenHelp = computed(() => translateLegacy('DeepLX 地址包含 {{apiKey}} 或 {{token}} 占位符，请填写 API Key；无 Key 地址请移除占位符。'))
const deepLXRequiresToken = computed(() => requiresDeepLXToken(config.value.deeplx, config.value.proxy[services.deeplx]))
const deeplEndpoint = computed(() => config.value.proxy[service.value]?.trim() || getDeepLEndpoint(config.value.deeplApiPlan))
const pendingChromePreparation = ref<Awaited<ReturnType<typeof chromeTranslationPreparationStore.get>>>(null)
let pendingChromePreparationRevision = 0
let chromePreparationMounted = true
void chromeTranslationPreparationStore.get().then((request) => {
  if (chromePreparationMounted && pendingChromePreparationRevision === 0) pendingChromePreparation.value = request
})
const stopChromePreparationPendingWatch = chromeTranslationPreparationStore.subscribe((request) => {
  pendingChromePreparationRevision += 1
  pendingChromePreparation.value = request
})
const effectiveModelLabel = computed(() => resolveConfiguredModel(
  config.value.model[service.value],
  config.value.customModel[service.value],
))
const visionOverride = computed<string>({
  get: () => typeof config.value.modelVision[service.value]?.[effectiveModelLabel.value] === 'boolean'
    ? (config.value.modelVision[service.value][effectiveModelLabel.value] ? 'supported' : 'unsupported') : 'auto',
  set: (value) => {
    const model = effectiveModelLabel.value
    if (!model) return
    const current = {...(config.value.modelVision[service.value] || {})}
    if (value === 'auto') delete current[model]
    else current[model] = value === 'supported'
    if (Object.keys(current).length) config.value.modelVision[service.value] = current
    else delete config.value.modelVision[service.value]
  },
})
const visionCapabilityMessage = computed(() => {
  if (!supportsVisionTransport(service.value, effectiveModelLabel.value)) return 'settings.services.visionTransportUnsupported'
  const capability = resolveModelVisionCapability(service.value, effectiveModelLabel.value, config.value.modelVision)
  return capability === 'supported' ? 'settings.services.visionConfirmed' : capability === 'unsupported' ? 'settings.services.visionTextOnlyMessage' : 'settings.services.visionUnknown'
})

const apiKeys = computed(() => {
  const configured = config.value.apiKeys?.[service.value]
  return normalizeApiKeyList(configured, config.value.token[service.value] || '')
})
const apiKeyRotationEnabled = computed<boolean>({
  get: () => {
    const explicit = config.value.apiKeyRotationEnabled?.[service.value]
    return explicit === true || (explicit === undefined && apiKeys.value.filter(Boolean).length > 1)
  },
  set: (value) => {
    config.value.apiKeyRotationEnabled = {
      ...(config.value.apiKeyRotationEnabled || {}),
      [service.value]: value,
    }
    invalidateConnectionTest()
  },
})
function setApiKeyRotationEnabled(value: boolean): void {
  apiKeyRotationEnabled.value = value
}
const displayedApiKeys = computed(() => apiKeyRotationEnabled.value ? apiKeys.value : apiKeys.value.slice(0, 1))
const apiKeyIndexes = computed(() => eligibleApiKeyIndexes(displayedApiKeys.value))
const usesApiKeyList = computed(() => compute.value.showToken && !compute.value.showServiceSecret)
const apiKeyChecks = ref<Record<number, ApiKeyCheckState>>({})
const apiKeySummary = ref<ApiKeySummary | null>(null)
const apiKeyCheckMode = ref<'single' | 'all'>('all')

function syncApiKeys(next: string[]): void {
  const value = next.length > 0 ? next : ['']
  // 单 Key 模式只改变当前使用范围，编辑首个 Key 时保留高级配置里已有的其他 Key。
  const storedValue = value
  if (!config.value.apiKeys) config.value.apiKeys = {}
  config.value.apiKeys[service.value] = storedValue
  config.value.token[service.value] = storedValue.find(key => key.trim()) || ''
  invalidateConnectionTest()
}

function addApiKey(): void {
  if (!apiKeyRotationEnabled.value || apiKeys.value.some(key => !key.trim())) return
  syncApiKeys([...apiKeys.value, ''])
}
function updateApiKey(index: number, value: string): void {
  const next = [...apiKeys.value]
  next[index] = value
  syncApiKeys(next)
}
function removeApiKey(index: number): void {
  syncApiKeys(apiKeys.value.filter((_, itemIndex) => itemIndex !== index))
}

function resetApiKeyChecks(): void {
  apiKeyChecks.value = {}
  apiKeySummary.value = null
}

function setApiKeyState(index: number, state: ApiKeyCheckState): void {
  apiKeyChecks.value = {...apiKeyChecks.value, [index]: state}
}

function updateApiKeySummary(): void {
  apiKeySummary.value = summarizeApiKeyChecks(apiKeyChecks.value)
}

function updateCustomProvider(field: 'name' | 'endpoint', value: string): void {
  emit('update:custom-provider', {[field]: value})
}

const minimaxKeyKind = computed(() => {
  const token = config.value.token[service.value]?.trim() || ''
  return token.startsWith('sk-cp-') ? 'token-plan' : token ? 'other' : 'empty'
})

const minimaxKeyMismatch = computed(() => {
  if (minimaxKeyKind.value === 'empty') return ''
  if (config.value.minimaxBillingPlan === 'token-plan' && minimaxKeyKind.value !== 'token-plan') {
    return '当前选择的是 Token Plan，但 Key 不是 sk-cp- 开头；请确认 Key 来源，Token Plan 订阅必须有效。'
  }
  if (config.value.minimaxBillingPlan === 'payg' && minimaxKeyKind.value === 'token-plan') {
    return '当前选择的是按量付费，但检测到 sk-cp- Token Plan Key；两类 Key 不能互换，请切换计费方式或更换 Key。'
  }
  return config.value.minimaxBillingPlan === 'token-plan'
    ? '当前使用 Token Plan Key；请确认 Token Plan 订阅有效。'
    : ''
})

const minimaxEndpoint = computed(() => {
  const plan = config.value.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg'
  const region = config.value.minimaxRegion === 'cn' ? 'cn' : 'global'
  return MINIMAX_ENDPOINTS[plan][region]
})

const mimoKeyKind = computed(() => {
  const token = config.value.token[service.value]?.trim() || ''
  if (token.startsWith('tp-')) return 'token-plan'
  if (token.startsWith('sk-')) return 'payg'
  return token ? 'other' : 'empty'
})

const mimoKeyMismatch = computed(() => {
  if (mimoKeyKind.value === 'empty') return ''
  if (config.value.mimoBillingPlan === 'token-plan' && mimoKeyKind.value !== 'token-plan') {
    return '当前选择的是 MiMo Token Plan，但 Key 不是 tp- 开头；请确认 Key 来源和订阅状态。'
  }
  if (config.value.mimoBillingPlan === 'payg' && mimoKeyKind.value === 'token-plan') {
    return '当前选择的是 MiMo 按量付费，但检测到 tp- Token Plan Key；两类 Key 不能互换，请切换计费方式或更换 Key。'
  }
  if (config.value.mimoBillingPlan === 'payg' && mimoKeyKind.value === 'other') {
    return 'MiMo 按量付费 Key 通常以 sk- 开头；请确认 Key 来自 API Keys 页面。'
  }
  return config.value.mimoBillingPlan === 'token-plan'
    ? '当前使用 MiMo Token Plan Key；请确认订阅仍在有效期内。'
    : ''
})

const mimoEndpoint = computed(() => {
  return getMimoEndpoint(config.value.mimoBillingPlan, config.value.mimoRegion)
})

type ConnectionTestState = 'idle' | 'testing' | 'success' | 'error'
type LocalizedConnectionTestMessage = {
  readonly key: string
  readonly params?: TranslationParams
}

const CHROME_PREPARATION_TIMEOUT_MS = 300_000
const CONNECTION_CONFIG_WAIT_TIMEOUT_MS = 10_000
// 后台翻译检查有 30 秒预算；页面多留出消息传递和结果保存时间。
const CONNECTION_RESPONSE_WAIT_TIMEOUT_MS = 45_000
const CHROME_PREPARATION_ERROR_KEYS: Readonly<Record<ChromeTranslationPreparationErrorCode, string>> = {
  'invalid-language-code': 'settings.services.chromePreparation.error.invalidLanguageCode',
  'sample-unavailable': 'settings.services.chromePreparation.error.sampleUnavailable',
  aborted: 'settings.services.chromePreparation.error.aborted',
  'invalid-detection': 'settings.services.chromePreparation.error.invalidDetection',
  'api-unavailable': 'settings.services.chromePreparation.error.apiUnavailable',
  'user-activation-required': 'settings.services.chromePreparation.error.userActivationRequired',
  'unsupported-pair': 'settings.services.chromePreparation.error.unsupportedPair',
  'detection-mismatch': 'settings.services.chromePreparation.error.detectionMismatch',
  'invalid-translation': 'settings.services.chromePreparation.error.invalidTranslation',
  'preparation-failed': 'settings.services.chromePreparation.error.failed',
  'model-unavailable': 'settings.services.chromePreparation.error.modelUnavailable',
}
const connectionTestBusy = ref(false)
const connectionTestState = ref<ConnectionTestState>('idle')
const connectionTestMessageState = ref<LocalizedConnectionTestMessage | string | null>(null)
const connectionTestMessage = computed(() => {
  const message = connectionTestMessageState.value
  if (!message) return ''
  return typeof message === 'string' ? message : t(message.key, message.params)
})
// 没有逐 Key 结果时，保存失败或免 Key 检查仍复用固定的行内状态区。
const standaloneApiKeyCheck = computed<ApiKeyCheckState | undefined>(() => {
  if (connectionTestState.value === 'idle') return undefined
  if (connectionTestState.value === 'testing') return {status: 'checking'}
  if (connectionTestState.value === 'success') return {status: 'success'}
  return {status: 'error', error: connectionTestMessage.value}
})
const connectionTestDetails = computed(() => {
  const message = connectionTestMessageState.value
  if (!message || typeof message === 'string' || !message.params?.detail) return ''
  return String(message.params.detail)
})
const isChromeConnectionTest = computed(() => service.value === services.chromeTranslator)
const displayedChromePreparationPair = ref<ChromeTranslationPreparationPair | null>(null)
const currentChromePreparationPair = computed(() => {
  try {
    const fallbackPair = resolveChromeTranslationPreparationPair('auto', config.value.to)
    const configuredFrom = config.value.from.trim().toLowerCase()
    const pendingSource = configuredFrom === 'auto'
      && pendingChromePreparation.value?.targetLanguage === fallbackPair.targetLanguage
      ? pendingChromePreparation.value.sourceLanguage
      : undefined
    return resolveChromeTranslationPreparationPair(pendingSource || config.value.from, config.value.to)
  } catch {
    return null
  }
})
const currentChromePreparationPairLabel = computed(() => {
  const pair = displayedChromePreparationPair.value || currentChromePreparationPair.value
  if (!pair) return ''
  return `${getChromeTranslationPreparationLanguageLabel(pair.sourceLanguage, language.value)}（${pair.sourceLanguage}） → ${getChromeTranslationPreparationLanguageLabel(pair.targetLanguage, language.value)}（${pair.targetLanguage}）`
})
let connectionTestGeneration = 0
let activeChromePreparation: AbortController | undefined
const activeConnectionWaits = new Set<() => void>()

async function waitForConnectionStep<T>(operation: Promise<T>, timeoutMs: number, timeoutKey: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel: () => void = () => undefined
  const interruption = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(t(timeoutKey))), timeoutMs)
    cancel = () => reject(new Error('Connection check cancelled'))
    activeConnectionWaits.add(cancel)
  })
  try {
    return await Promise.race([operation, interruption])
  } finally {
    clearTimeout(timer)
    activeConnectionWaits.delete(cancel)
  }
}

function cancelConnectionWaits(): void {
  for (const cancel of activeConnectionWaits) cancel()
  activeConnectionWaits.clear()
}
const connectionTestTitle = computed(() => {
  if (isChromeConnectionTest.value) {
    return connectionTestState.value === 'testing'
      ? t('settings.services.chromePreparation.titlePreparing')
      : connectionTestState.value === 'success'
        ? t('settings.services.chromePreparation.titleReady')
        : t('settings.services.chromePreparation.titleIncomplete')
  }
  return connectionTestState.value === 'testing'
    ? '检查中'
    : connectionTestState.value === 'success' ? '连接正常' : '连接失败'
})

function resetConnectionTest(): void {
  displayedChromePreparationPair.value = null
  connectionTestState.value = 'idle'
  connectionTestMessageState.value = null
  resetApiKeyChecks()
}

function invalidateConnectionTest(): void {
  connectionTestGeneration += 1
  cancelConnectionWaits()
  activeChromePreparation?.abort()
  activeChromePreparation = undefined
  connectionTestBusy.value = false
  resetConnectionTest()
}

function localizedConnectionTestMessage(
  key: string,
  params?: TranslationParams,
): LocalizedConnectionTestMessage {
  return {key, ...(params ? {params} : {})}
}

function formatChromePreparationStatus(status: ChromeTranslationPreparationStatus): LocalizedConnectionTestMessage {
  const params = {
    sourceLanguage: status.sourceLanguage,
    targetLanguage: status.targetLanguage,
  }
  if (status.phase === 'downloading') {
    const model = status.model === 'language-detector'
      ? t('settings.services.chromePreparation.modelDetector')
      : t('settings.services.chromePreparation.modelTranslator')
    return localizedConnectionTestMessage(
      typeof status.loaded === 'number'
        ? 'settings.services.chromePreparation.statusDownloadingProgress'
        : 'settings.services.chromePreparation.statusDownloading',
      {
        ...params,
        model,
        ...(typeof status.loaded === 'number' ? {percentage: Math.round(status.loaded * 100)} : {}),
      },
    )
  }
  if (status.phase === 'verifying') {
    return localizedConnectionTestMessage('settings.services.chromePreparation.statusVerifying', params)
  }
  return localizedConnectionTestMessage('settings.services.chromePreparation.statusInitializing', params)
}

function formatChromePreparationError(error: unknown): LocalizedConnectionTestMessage | string {
  if (error instanceof ChromeTranslationPreparationError) {
    return localizedConnectionTestMessage(CHROME_PREPARATION_ERROR_KEYS[error.code], error.params)
  }
  return error instanceof Error ? error.message : String(error)
}

async function runApiKeyCheck(index: number, generation: number): Promise<boolean> {
  const key = apiKeys.value[index]?.trim() || ''
  if (!key) {
    return false
  }
  setApiKeyState(index, {status: 'checking'})
  try {
    const response = await waitForConnectionStep(browser.runtime.sendMessage({
      type: CONNECTION_TEST_MESSAGE,
      service: service.value,
      keyIndex: index,
      keyRevision: createApiKeyCheckRevision(config.value, service.value),
    }), CONNECTION_RESPONSE_WAIT_TIMEOUT_MS, 'settings.services.keys.responseTimeout') as {success?: boolean; durationMs?: number; error?: string} | undefined
    if (generation !== connectionTestGeneration) return false
    if (!response?.success) throw new Error(response?.error || '连接测试失败')
    setApiKeyState(index, {status: 'success', durationMs: response.durationMs})
    updateApiKeySummary()
    return true
  } catch (error) {
    if (generation !== connectionTestGeneration) return false
    setApiKeyState(index, {status: 'error', error: error instanceof Error ? error.message : String(error)})
    updateApiKeySummary()
    return false
  }
}

function stopApiKeyChecks(): void {
  connectionTestGeneration += 1
  cancelConnectionWaits()
  connectionTestBusy.value = false
  connectionTestState.value = 'idle'
  connectionTestMessageState.value = null
  apiKeyChecks.value = Object.fromEntries(Object.entries(apiKeyChecks.value).map(([index, state]) => [index,
    state.status === 'checking' || state.status === 'queued' ? {status: 'idle' as const} : state]))
  updateApiKeySummary()
}

async function testSingleApiKey(index: number): Promise<void> {
  if (connectionTestBusy.value || !apiKeyIndexes.value.includes(index)) return
  apiKeyCheckMode.value = 'single'
  const generation = ++connectionTestGeneration
  connectionTestBusy.value = true
  connectionTestState.value = 'testing'
  connectionTestMessageState.value = t('settings.services.keys.checking')
  setApiKeyState(index, {status: 'checking'})
  updateApiKeySummary()
  try {
    await waitForConnectionStep(waitForConfigPersistenceQueue(), CONNECTION_CONFIG_WAIT_TIMEOUT_MS, 'settings.services.keys.configTimeout')
    if (generation !== connectionTestGeneration) return
    await waitForConnectionStep(requestConfigSave(config.value, browser.runtime.sendMessage.bind(browser.runtime)), CONNECTION_CONFIG_WAIT_TIMEOUT_MS, 'settings.services.keys.configTimeout')
    if (generation !== connectionTestGeneration) return
    const success = await runApiKeyCheck(index, generation)
    if (generation !== connectionTestGeneration) return
    connectionTestState.value = success ? 'success' : 'error'
    connectionTestMessageState.value = success ? t('settings.services.keys.passed') : t('settings.services.keys.failed')
  } catch (error) {
    if (generation === connectionTestGeneration) {
      connectionTestState.value = 'error'
      connectionTestMessageState.value = error instanceof Error ? error.message : String(error)
      setApiKeyState(index, {status: 'error', error: connectionTestMessageState.value})
      updateApiKeySummary()
    }
  } finally {
    if (generation === connectionTestGeneration) connectionTestBusy.value = false
  }
}

async function testConnection(): Promise<void> {
  if (connectionTestBusy.value) return
  apiKeyCheckMode.value = 'all'

  const testedService = service.value
  const generation = ++connectionTestGeneration
  const chromeController = testedService === services.chromeTranslator ? new AbortController() : undefined
  if (chromeController) activeChromePreparation = chromeController
  let chromePreparationTimedOut = false
  const chromePreparationTimer = chromeController ? window.setTimeout(() => {
    chromePreparationTimedOut = true
    chromeController.abort()
  }, CHROME_PREPARATION_TIMEOUT_MS) : undefined
  const isCurrent = () => generation === connectionTestGeneration
  let acceptChromePreparationStatus = true
  connectionTestBusy.value = true
  connectionTestState.value = 'testing'
  if (compute.value.showToken) resetApiKeyChecks()
  connectionTestMessageState.value = testedService === services.chromeTranslator
    ? localizedConnectionTestMessage('settings.services.chromePreparation.statusStarting')
    : '正在保存当前配置并请求服务…'

  let chromePreparation: Promise<{ok: true; result: Awaited<ReturnType<typeof prepareChromeTranslationInPage>>} | {ok: false; error: unknown}> | undefined
  try {
    // Chrome 的模型下载要求用户激活；必须在 click handler 的首个 await 前直接调用。
    if (testedService === services.chromeTranslator) {
      const pair = currentChromePreparationPair.value
      if (!pair) throw new ChromeTranslationPreparationError('invalid-language-code', 'Chrome 本地翻译语言代码无效', {field: 'from/to'})
      displayedChromePreparationPair.value = pair
      chromePreparation = prepareChromeTranslationInPage({
        from: pair.sourceLanguage,
        to: pair.targetLanguage,
        signal: chromeController?.signal,
        onStatus(status) {
          if (acceptChromePreparationStatus && isCurrent()) {
            connectionTestMessageState.value = formatChromePreparationStatus(status)
          }
        },
      }).then(
        (result) => ({ok: true as const, result}),
        (error) => ({ok: false as const, error}),
      )
    }
    await waitForConnectionStep(waitForConfigPersistenceQueue(), CONNECTION_CONFIG_WAIT_TIMEOUT_MS, 'settings.services.keys.configTimeout')
    if (!isCurrent()) return
    await waitForConnectionStep(requestConfigSave(config.value, browser.runtime.sendMessage.bind(browser.runtime)), CONNECTION_CONFIG_WAIT_TIMEOUT_MS, 'settings.services.keys.configTimeout')
    if (!isCurrent()) return
    if (chromePreparation) {
      const outcome = await chromePreparation
      if (!isCurrent()) return
      if (!outcome.ok) throw outcome.error
      await chromeTranslationPreparationStore.clear({
        sourceLanguage: outcome.result.sourceLanguage,
        targetLanguage: outcome.result.targetLanguage,
      })
      if (!isCurrent()) return
      connectionTestState.value = 'success'
      connectionTestMessageState.value = localizedConnectionTestMessage(
        'settings.services.chromePreparation.success',
        {
          sourceLanguage: outcome.result.sourceLanguage,
          targetLanguage: outcome.result.targetLanguage,
        },
      )
    } else if (compute.value.showToken && !compute.value.showServiceSecret && apiKeyIndexes.value.length > 0) {
      const checks = [...apiKeyIndexes.value]
      apiKeyChecks.value = Object.fromEntries(checks.map(index => [index, {status: 'queued' as const}]))
      let successes = 0
      for (const index of checks) {
        if (!isCurrent()) return
        if (await runApiKeyCheck(index, generation)) successes += 1
      }
      if (!isCurrent()) return
      const failures = checks.length - successes
      connectionTestState.value = failures === 0 ? 'success' : 'error'
      connectionTestMessageState.value = null
    } else {
      const response = await waitForConnectionStep(browser.runtime.sendMessage({
        type: CONNECTION_TEST_MESSAGE,
        service: testedService,
      }), CONNECTION_RESPONSE_WAIT_TIMEOUT_MS, 'settings.services.keys.responseTimeout') as {success?: boolean; durationMs?: number; error?: string} | undefined
      if (!isCurrent()) return
      if (!response?.success) throw new Error(response?.error || '连接测试失败')
      connectionTestState.value = 'success'
      connectionTestMessageState.value = `已完成真实翻译请求${typeof response.durationMs === 'number' ? `（${response.durationMs} ms）` : ''}。`
    }
  } catch (error) {
    if (!isCurrent()) return
    connectionTestState.value = 'error'
    connectionTestMessageState.value = chromePreparationTimedOut
      ? localizedConnectionTestMessage('settings.services.chromePreparation.error.timeout')
      : formatChromePreparationError(error)
  } finally {
    acceptChromePreparationStatus = false
    if (chromePreparationTimer !== undefined) window.clearTimeout(chromePreparationTimer)
    chromeController?.abort()
    if (isCurrent()) {
      if (activeChromePreparation === chromeController) activeChromePreparation = undefined
      connectionTestBusy.value = false
    }
  }
}

function resetCustomTemplate(): void {
  void ElMessageBox.confirm(
    '确定要恢复当前 AI 服务的默认 system 和 user 模板吗？此操作会覆盖当前模板。',
    '恢复默认模板',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    },
  ).then(() => {
    config.value.system_role[service.value] = defaultOption.system_role
    config.value.user_role[service.value] = defaultOption.user_role
    ElMessage.success('已恢复当前 AI 服务默认模板')
  }).catch(() => {
    // 用户取消操作，不做任何处理。
  })
}

function confirmDeleteProvider(): void {
  const providerName = customProvider.value?.name || '此自定义服务'
  void ElMessageBox.confirm(
    `确定要删除“${providerName}”吗？相关模型和连接配置也会一并清理。`,
    '删除自定义服务',
    {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
      type: 'warning',
    },
  ).then(() => emit('delete:custom-provider')).catch(() => {
    // 用户取消删除，不修改配置。
  })
}

watch(service, invalidateConnectionTest)
watch(() => [config.value.from, config.value.to], invalidateConnectionTest)
watch(() => createApiKeyCheckRevision(config.value, service.value), invalidateConnectionTest)
watch(() => JSON.stringify({
  ak: config.value.ak,
  sk: config.value.sk,
  appid: config.value.appid,
  key: config.value.key,
  secret: config.value.secret?.[service.value],
}), invalidateConnectionTest)
onBeforeUnmount(() => {
  chromePreparationMounted = false
  connectionTestGeneration += 1
  cancelConnectionWaits()
  activeChromePreparation?.abort()
  activeChromePreparation = undefined
  stopChromePreparationPendingWatch()
})
</script>

<style scoped>
.service-connection-section { container-type: inline-size; display: grid; gap: 16px; color: var(--ink, #172033); }
.connection-card, .custom-advanced-settings { min-width: 0; border: 1px solid var(--line, #e4e7ef); border-radius: 14px; background: var(--surface, #fff); }
.connection-card { padding: 20px; }
.configuration-group-heading { margin-bottom: 8px; }
.configuration-group-heading h5 { margin: 0; color: var(--ink); font-size: 14px; font-weight: 650; line-height: 1.5; }
.configuration-group-heading p { margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.connection-field { display: grid; grid-template-columns: 160px minmax(0, 1fr); align-items: start; gap: 16px; padding: 14px 0; }
.connection-field + .connection-field { border-top: 1px solid var(--line, #e4e7ef); }
.connection-field-label { display: grid; gap: 5px; min-width: 0; padding-top: 8px; }
.connection-field-label strong { color: var(--ink); font-size: 13px; font-weight: 550; line-height: 1.5; }
.connection-field-label small, .provider-field-help, .custom-headers-help, .model-thinking-setting > small, .model-vision-setting > small { color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.connection-field-control { display: flex; flex-direction: column; align-items: flex-end; justify-self: end; width: 100%; max-width: 640px; min-width: 0; }
.connection-field-control :deep(.el-input), .connection-field-control :deep(.el-select), .connection-field-control :deep(.el-textarea) { width: 100% !important; max-width: 640px !important; }
.connection-field-control :deep(.el-select) { max-width: 360px !important; }
.service-connection-section :deep(.el-input__wrapper), .service-connection-section :deep(.el-select:not(.fluentread-select) .el-select__wrapper) { min-height: 38px; padding: 0 11px; border-radius: 10px; background: var(--surface, #fff); border-color: var(--line); }
.service-connection-section :deep(.el-input__inner), .service-connection-section :deep(.el-select__selected-item) { font-size: 13px; }
.service-connection-section :deep(.el-textarea__inner) { border-radius: 10px; background: var(--surface); font-size: 13px; padding: 10px 12px; }
.service-connection-section :deep(.el-switch) { --el-switch-on-color: var(--brand, #ef4776); }
.provider-field-help, .custom-headers-help { display: block; align-self: stretch; margin: 7px 0 0; }
.provider-field-help code { font-size: 11px; }
.credential-control { display: grid; justify-items: end; gap: 8px; }
.api-key-requirement { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
.model-vision-setting { display: grid; justify-items: end; gap: 7px; }
.model-thinking-setting { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; }
.model-thinking-setting :deep(.el-switch) { flex: none; }
.custom-advanced-settings > summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; min-height: 68px; color: var(--ink); cursor: pointer; list-style: none; border-radius: 14px; }
.custom-advanced-settings > summary::-webkit-details-marker { display: none; }
.custom-advanced-settings > summary:hover { background: var(--surface-soft, #f7f8fb); }
.advanced-summary-copy { display: grid; gap: 5px; min-width: 0; }
.advanced-summary-copy strong { font-size: 13px; font-weight: 600; line-height: 1.5; }
.advanced-summary-copy small { color: var(--muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.advanced-chevron { width: 16px; height: 16px; flex: none; color: var(--muted); transition: transform 150ms ease; }
.custom-advanced-settings[open] > summary .advanced-chevron { transform: rotate(180deg); }
.custom-advanced-content { margin: 0 20px; padding: 4px 0 16px; border-top: 1px solid var(--line); }
.custom-template-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin: 8px 0 14px; padding-top: 18px; border-top: 1px solid var(--line); }
.custom-template-heading > div { display: grid; gap: 6px; }
.custom-template-heading strong { color: var(--ink); font-size: 13px; font-weight: 600; }
.custom-template-heading small { color: var(--muted); font-size: 12px; line-height: 1.6; }
.custom-template-heading :deep(.el-button) { margin-top: 2px; flex: none; }
.prompt-template-list { display: grid; gap: 14px; }
.service-connection-section :deep(.request-limit-settings) { border-bottom: 0; width: 100%; }
.connection-test-inline { display: flex; align-items: center; justify-content: flex-start; gap: 12px; flex-wrap: wrap; margin: 14px 0; }
.connection-test-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 7px 12px; border: 1px solid var(--brand-border, #f3c0ce); border-radius: 9px; color: var(--brand-strong, #bd2853); background: var(--brand-soft, #fff0f4); font-size: 12px; font-weight: 600; cursor: pointer; }
.connection-test-button:hover:not(:disabled) { border-color: var(--brand); }
.connection-test-button:disabled { cursor: wait; opacity: .65; }
.connection-action-icon { flex: none; }
.is-spinning { animation: connection-spin 1s linear infinite; }
@keyframes connection-spin { to { transform: rotate(360deg); } }
.service-connection-action { position: relative; }
.service-connection-action .connection-test-button { width: 116px; white-space: nowrap; }
.header-connection-status { position: absolute; top: calc(100% + 3px); right: 0; color: var(--muted); font-size: 11px; line-height: 17px; white-space: nowrap; }
.header-connection-status.is-success { color: var(--el-color-success); }
.header-connection-status.is-error { color: var(--el-color-danger); }
.service-connection-action .connection-test-inline { margin: 0; justify-content: space-between; }
.connection-test-result { display: grid; gap: 4px; margin-top: 12px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; color: var(--ink); background: var(--surface-soft); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.connection-test-result.is-success { border-color: var(--el-color-success-light-5); color: var(--el-color-success); background: var(--el-color-success-light-9); }
.connection-test-result.is-error { border-color: var(--el-color-danger-light-5); color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.connection-test-details { margin-top: 5px; }
.connection-test-details code { display: block; margin-top: 7px; white-space: pre-wrap; overflow-wrap: anywhere; }
.connection-test-details summary { cursor: pointer; }
.field-warning, .error-text, .minimax-key-note.is-warning, .mimo-key-note.is-warning { color: var(--el-color-danger); font-size: 12px; line-height: 1.6; margin-top: 7px; }
.minimax-key-note, .mimo-key-note { margin: 8px 0; }
.minimax-endpoint code, .mimo-endpoint code { display: block; color: var(--muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.official-translation-help, .chrome-preparation-help { margin: 12px 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.official-translation-help p, .chrome-preparation-help p { margin: 0 0 8px; }
.official-translation-help a, .chrome-preparation-help a { color: var(--brand-strong); }
.chrome-preparation-help summary { cursor: pointer; color: var(--ink); }
.chrome-preparation-help-links, .chrome-preparation-pair { display: flex; flex-wrap: wrap; gap: 8px 12px; }
.service-maintenance-actions { display: flex; justify-content: flex-start; padding: 0 2px; }
.delete-service-button { padding: 7px 10px; border: 1px solid var(--line); border-radius: 9px; color: var(--muted); background: var(--surface); font-size: 12px; cursor: pointer; }
.delete-service-button:hover { color: var(--el-color-danger); border-color: var(--el-color-danger); }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
@container (max-width: 600px) {
  .connection-card { padding: 16px; }
  .connection-field { grid-template-columns: 1fr; gap: 8px; }
  .connection-field-label { padding-top: 0; }
  .connection-field-control { max-width: none; }
  .custom-advanced-settings > summary { padding: 14px 16px; }
  .custom-advanced-content { margin: 0 16px; }
  .custom-template-heading { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) { .advanced-chevron { transition: none; } .is-spinning { animation: none; } }
.endpoint-token-help { margin-top: 10px; font-size: 12px; color: var(--muted); }
.endpoint-token-help summary { cursor: pointer; color: var(--brand-strong); }
/* 详情本身就是主卡片，内部按用途分组，不再嵌套大容器。 */
.connection-card { padding: 0; border: 0; border-radius: 0; }
.configuration-group-heading { margin: 0 0 10px; }
.configuration-group-heading h5 { font-size: 13px; font-weight: 650; }
.provider-account-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 780px; margin-left: auto; gap: 16px; }
.provider-account-fields .connection-field { display: flex; flex-direction: column; align-items: stretch; gap: 8px; border: 0; padding: 8px 0 4px; }
.provider-account-fields .connection-field-label { display: flex; align-items: center; gap: 6px; padding: 0; }
.provider-account-fields .connection-field-control :deep(.el-select) { max-width: none !important; }
.field-help-button { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 7px; color: var(--muted); background: transparent; cursor: help; }
.field-help-button:hover { color: var(--brand-strong); background: var(--brand-soft); }
.minimax-endpoint, .mimo-endpoint { margin: 5px 0 14px; }
.service-connection-section > .custom-advanced-settings > summary { min-height: 54px; padding: 12px 14px; }
.service-connection-section > .custom-advanced-settings .advanced-summary-copy { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
@container (max-width: 520px) { .provider-account-fields { grid-template-columns: 1fr; gap: 8px; } .service-connection-section > .custom-advanced-settings .advanced-summary-copy { display: grid; gap: 5px; } }

.advanced-groups { display: grid; gap: 14px; padding: 0 16px 16px; }
.advanced-group { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.advanced-group-heading { padding: 14px 16px; background: var(--surface-soft); border-bottom: 1px solid var(--line); }
.advanced-group .custom-advanced-content { margin: 0 16px; border-top: 0; }
.advanced-group[data-configuration-group="keys"] .connection-field { grid-template-columns: minmax(0, 1fr) auto; }
.advanced-group .advanced-summary-copy { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 14px; }
.custom-advanced-settings > summary > strong { font-size: 13px; font-weight: 600; }
</style>
