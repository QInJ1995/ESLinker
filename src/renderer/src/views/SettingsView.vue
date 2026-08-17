<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import {
  NButton,
  NSpace,
  NInputNumber,
  NSelect,
  NSwitch,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NCard,
  NRadioGroup,
  NRadioButton,
  NTag,
  NEmpty
} from 'naive-ui'
import type { Settings, MappingTemplate } from '../lib/core'
import { DEFAULT_SETTINGS, ANALYZER_OPTIONS } from '../lib/core'
import { message, confirmDanger } from '../lib/naive'
import { themePref, setTheme } from '../lib/theme'

const form = reactive({ ...DEFAULT_SETTINGS })
const saved = ref(false)
const templates = ref<MappingTemplate[]>([])

onMounted(async () => {
  const s = await window.api.settings.get()
  Object.assign(form, s)
  templates.value = await window.api.templates.list()
})

async function save(): Promise<void> {
  const payload: Settings = {
    defaultShards: form.defaultShards,
    defaultReplicas: form.defaultReplicas,
    autoKeywordSubField: form.autoKeywordSubField,
    ignoreAbove: form.ignoreAbove,
    analyzer: form.analyzer,
    analyzeAllStrings: form.analyzeAllStrings,
    scaledFloatAsMoney: form.scaledFloatAsMoney,
    retryCount: form.retryCount
  }
  try {
    await window.api.settings.set(payload)
    message.success('全局规则已保存')
    saved.value = true
    setTimeout(() => (saved.value = false), 2000)
  } catch (e) {
    message.error(String((e as Error).message))
  }
}

function reset(): void {
  Object.assign(form, DEFAULT_SETTINGS)
}

async function removeTemplate(tpl: MappingTemplate): Promise<void> {
  confirmDanger(`删除模板「${tpl.name}」？`, async () => {
    await window.api.templates.remove(tpl.id)
    templates.value = await window.api.templates.list()
    message.success('已删除')
  })
}

const analyzerOptions = ANALYZER_OPTIONS.map((a) => ({ label: a, value: a }))
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">设置</h1>
        <p class="page-sub">全局默认映射规则与同步参数，新建 Mapping / 任务时自动应用</p>
      </div>
    </header>

    <n-card class="panel-card" title="界面主题">
      <n-space align="center">
        <span class="field-label">外观</span>
        <n-radio-group :value="themePref" @update:value="setTheme">
          <n-radio-button value="light">浅色</n-radio-button>
          <n-radio-button value="dark">深色</n-radio-button>
        </n-radio-group>
        <span class="muted-txt">选择后立即生效并记忆偏好</span>
      </n-space>
    </n-card>

    <n-card class="panel-card" title="默认映射规则">
      <n-form label-placement="top" :show-feedback="false">
        <n-grid :cols="3" :x-gap="16" :y-gap="0" responsive="screen" item-responsive>
          <n-grid-item>
            <n-form-item label="默认分片数（number_of_shards）">
              <n-input-number
                v-model:value="form.defaultShards"
                :min="1"
                :max="32"
                style="width: 100%"
              />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="默认副本数（number_of_replicas）">
              <n-input-number
                v-model:value="form.defaultReplicas"
                :min="0"
                :max="4"
                style="width: 100%"
              />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="字符串自动生成 keyword 子字段">
              <n-switch v-model:value="form.autoKeywordSubField" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="keyword 子字段 ignore_above">
              <n-input-number
                v-model:value="form.ignoreAbove"
                :min="64"
                :max="1024"
                :step="8"
                style="width: 100%"
              />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="默认分词器（analyzer）">
              <n-select v-model:value="form.analyzer" :options="analyzerOptions" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="字符串全部走分词（analyzeAllStrings）">
              <n-switch v-model:value="form.analyzeAllStrings" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="金额类型映射为 scaled_float">
              <n-switch v-model:value="form.scaledFloatAsMoney" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="失败重试次数（每次 bulk 重试）">
              <n-input-number
                v-model:value="form.retryCount"
                :min="0"
                :max="10"
                style="width: 100%"
              />
            </n-form-item>
          </n-grid-item>
        </n-grid>
      </n-form>
      <div class="row-end">
        <n-button @click="reset">恢复默认</n-button>
        <n-button type="primary" @click="save">{{ saved ? '已保存 ✓' : '保存规则' }}</n-button>
      </div>
    </n-card>

    <n-card class="panel-card" title="高级映射模板">
      <template #header-extra>
        <span class="muted-txt"
          >适配业务特殊字段的模板，在 Mapping 编辑器中「保存当前为模板」创建</span
        >
      </template>
      <n-empty v-if="templates.length === 0" description="暂无模板" style="padding: 18px 0" />
      <n-space v-else vertical :size="8">
        <n-space v-for="t in templates" :key="t.id" align="center" class="tpl-item">
          <b class="tpl-name">{{ t.name }}</b>
          <n-tag v-if="t.description" size="small" type="info" bordered>{{ t.description }}</n-tag>
          <span class="muted-txt">{{ t.fields.length }} 字段</span>
          <span v-if="t.indexSettings" class="muted-txt">
            分片 {{ t.indexSettings.number_of_shards ?? '默认' }} / 副本
            {{ t.indexSettings.number_of_replicas ?? '默认' }}
          </span>
          <span class="muted-txt">{{ new Date(t.createdAt).toLocaleDateString() }}</span>
          <n-button size="tiny" type="error" quaternary @click="removeTemplate(t)">删除</n-button>
        </n-space>
      </n-space>
    </n-card>

    <n-card class="panel-card" title="说明">
      <ul class="notes">
        <li>数据源账号密码使用 AES-256-GCM 本地加密存储，密钥保存在系统用户目录，不对外泄露。</li>
        <li>同步任务支持断点续传：全量阶段每批次写入后保存游标，停止后可从断点继续。</li>
        <li>增量同步基于 MySQL Binlog 本地监听，无需部署 Canal；需保证 binlog_row_image=FULL。</li>
        <li>支持 ES 6 / 7 / 8 集群：6.x 自动使用 `_doc` 映射类型并兼容 REST 接口。</li>
        <li>所有连接、映射、同步、对比计算均在本地完成，无任何后台服务与端口占用。</li>
      </ul>
    </n-card>
  </div>
</template>

<style scoped>
.page {
  max-width: 940px;
}

.panel-card {
  margin-bottom: 16px;
}

.field-label {
  font-size: 13px;
  opacity: 0.7;
}

.muted-txt {
  font-size: 12px;
  opacity: 0.55;
}

.row-end {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.tpl-item {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 8px;
  flex-wrap: wrap;
}

.tpl-name {
  flex: 1;
}

.notes {
  margin: 0;
  padding-left: 18px;
  line-height: 1.9;
  font-size: 13px;
  opacity: 0.85;
}
</style>
