<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import type { Settings } from '../lib/core'
import { DEFAULT_SETTINGS, ANALYZER_OPTIONS } from '../lib/core'

const emit = defineEmits<{ (e: 'snack', text: string, type?: string): void }>()

const form = reactive({ ...DEFAULT_SETTINGS })
const saved = ref(false)

onMounted(async () => {
  const s = await window.api.settings.get()
  Object.assign(form, s)
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
    emit('snack', '全局规则已保存', 'success')
    saved.value = true
    setTimeout(() => (saved.value = false), 2000)
  } catch (e) {
    emit('snack', String((e as Error).message), 'error')
  }
}

function reset(): void {
  Object.assign(form, DEFAULT_SETTINGS)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>设置</h1>
      <p>全局默认映射规则与同步参数，新建 Mapping / 任务时自动应用</p>
    </header>

    <section class="panel">
      <div class="panel-head"><h2>默认映射规则</h2></div>
      <div class="form-grid">
        <label>
          默认分片数（number_of_shards）
          <input v-model.number="form.defaultShards" type="number" min="1" max="32" />
        </label>
        <label>
          默认副本数（number_of_replicas）
          <input v-model.number="form.defaultReplicas" type="number" min="0" max="4" />
        </label>
        <label>
          字符串自动生成 keyword 子字段
          <div class="chk"><input v-model="form.autoKeywordSubField" type="checkbox" /></div>
        </label>
        <label>
          keyword 子字段 ignore_above
          <input v-model.number="form.ignoreAbove" type="number" min="64" max="1024" />
        </label>
        <label>
          默认分词器（analyzer）
          <select v-model="form.analyzer">
            <option v-for="a in ANALYZER_OPTIONS" :key="a" :value="a">{{ a }}</option>
          </select>
        </label>
        <label>
          字符串全部走分词（analyzeAllStrings）
          <div class="chk"><input v-model="form.analyzeAllStrings" type="checkbox" /></div>
        </label>
        <label>
          金额类型映射为 scaled_float
          <div class="chk"><input v-model="form.scaledFloatAsMoney" type="checkbox" /></div>
        </label>
        <label>
          失败重试次数（每次 bulk 重试）
          <input v-model.number="form.retryCount" type="number" min="0" max="10" />
        </label>
      </div>
      <div class="row-end">
        <button class="btn" @click="reset">恢复默认</button>
        <button class="btn primary" @click="save">{{ saved ? '已保存 ✓' : '保存规则' }}</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>说明</h2></div>
      <ul class="notes">
        <li>数据源账号密码使用 AES-256-GCM 本地加密存储，密钥保存在系统用户目录，不对外泄露。</li>
        <li>同步任务支持断点续传：全量阶段每批次写入后保存游标，停止后可从断点继续。</li>
        <li>增量同步基于 MySQL Binlog 本地监听，无需部署 Canal；需保证 binlog_row_image=FULL。</li>
        <li>所有连接、映射、同步计算均在本地完成，无任何后台服务与端口占用。</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 900px;
}

.page-head h1 {
  margin: 0 0 6px;
  font-size: 22px;
}

.page-head p {
  margin: 0 0 20px;
  color: var(--es-text-2);
}

.panel {
  background: var(--es-panel);
  border: 1px solid var(--es-border);
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 18px;
}

.panel-head h2 {
  margin: 0 0 14px;
  font-size: 15px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
  color: var(--es-text-2);
}

.chk {
  padding: 8px 0;
}

input[type='checkbox'] {
  width: 16px;
  height: 16px;
}

input[type='number'],
select {
  padding: 8px 10px;
  border: 1px solid var(--es-border);
  border-radius: 7px;
  font-size: 13px;
  background: #fff;
  color: var(--es-text);
}

.row-end {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn {
  padding: 6px 14px;
  border: 1px solid var(--es-border);
  background: #fff;
  border-radius: 7px;
  font-size: 12.5px;
  cursor: pointer;
  color: var(--es-text);
}

.btn.primary {
  background: var(--es-primary);
  border-color: var(--es-primary);
  color: #fff;
}

.notes {
  margin: 0;
  padding-left: 18px;
  color: var(--es-text-2);
  line-height: 1.9;
}
</style>
