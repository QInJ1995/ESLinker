<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NButton, NCard, NGrid, NGi, NStatistic, NAlert, NList, NListItem } from 'naive-ui'
import { serialize } from '../lib/core'

const emit = defineEmits<{ (e: 'go', view: string): void }>()

const stats = ref({ dbs: 0, es: 0, tasks: 0, running: 0 })
const esVersion = ref('')
const loadFail = ref('')

onMounted(async () => {
  try {
    const srcs = await window.api.datasource.list()
    stats.value.dbs = srcs.filter((s) => s.kind === 'db').length
    stats.value.es = srcs.filter((s) => s.kind === 'es').length
    const tasks = await window.api.sync.list()
    stats.value.tasks = tasks.length
    stats.value.running = tasks.filter(
      (t) => t.status === 'running' || t.status === 'paused'
    ).length
    const esSrc = srcs.find((s) => s.kind === 'es')
    if (esSrc?.es) {
      try {
        const info = await window.api.es.test(serialize(esSrc.es))
        esVersion.value = `ES ${info.version} · ${info.cluster}`
      } catch {
        esVersion.value = 'ES 未连接'
      }
    }
  } catch (e) {
    loadFail.value = String((e as Error).message)
  }
})

const quickSteps = [
  {
    n: 1,
    title: '配置数据源',
    desc: '添加数据库与 ES 连接并测试连通',
    view: 'datasources'
  },
  { n: 2, title: '生成 Mapping', desc: '自动类型映射、可视化编辑、一键建索引', view: 'mapping' },
  { n: 3, title: '开始同步', desc: '全量批量迁移 + Binlog 实时增量', view: 'sync' }
]
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">概览</h1>
        <p class="page-sub">纯客户端、零服务：数据库表结构可视化映射 + 全量/增量数据同步</p>
      </div>
    </header>

    <n-alert v-if="loadFail" type="error" :bordered="false" class="mb"> {{ loadFail }} </n-alert>

    <n-grid :cols="3" :x-gap="14" :y-gap="14" responsive="screen" item-responsive>
      <n-gi>
        <n-card hoverable class="stat-card" @click="emit('go', 'datasources')">
          <n-statistic label="数据库数据源" :value="stats.dbs">
            <template #suffix>
              <span class="suffix-sub">MySQL / PG / SQL Server</span>
            </template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card hoverable class="stat-card" @click="emit('go', 'datasources')">
          <n-statistic label="Elasticsearch 数据源" :value="stats.es">
            <template #suffix>
              <span class="suffix-sub">{{ esVersion || '点击配置 ES 连接' }}</span>
            </template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card hoverable class="stat-card" @click="emit('go', 'sync')">
          <n-statistic label="同步任务" :value="stats.tasks">
            <template #suffix>
              <span class="suffix-sub">{{ stats.running }} 个运行中 / 已暂停</span>
            </template>
          </n-statistic>
        </n-card>
      </n-gi>
    </n-grid>

    <div class="section-gap">
      <h2 class="section-title">快速开始</h2>
      <n-grid :cols="3" :x-gap="14" responsive="screen" item-responsive>
        <n-gi v-for="s in quickSteps" :key="s.n">
          <n-card hoverable class="quick-card" @click="emit('go', s.view)">
            <div class="quick-num">{{ s.n }}</div>
            <div class="quick-title">{{ s.title }}</div>
            <div class="quick-desc">{{ s.desc }}</div>
            <template #footer>
              <n-button quaternary size="small" type="primary">前往 →</n-button>
            </template>
          </n-card>
        </n-gi>
      </n-grid>
    </div>

    <div class="section-gap">
      <h2 class="section-title">核心能力</h2>
      <n-card :bordered="false" class="feat-card">
        <n-list>
          <n-list-item>多数据源本地管理，AES 加密存储账号密码</n-list-item>
          <n-list-item
            >智能 DB→ES 类型映射（text+keyword 双字段、数值/时间/主键自动适配）</n-list-item
          >
          <n-list-item>Mapping 可视化编辑、JSON 实时预览、模板复用</n-list-item>
          <n-list-item>一键创建 / 更新 ES 索引，防覆盖校验，导出 Mapping JSON</n-list-item>
          <n-list-item>全量分页批量同步（断点续传）+ MySQL Binlog 实时增量同步</n-list-item>
          <n-list-item v-if="false">DDL 粘贴离线生成 Mapping（无需连接数据库）</n-list-item>
          <n-list-item>粘贴 DDL 离线生成 Mapping；库表数据与 ES 一致性对比校验</n-list-item>
        </n-list>
      </n-card>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1000px;
}

.mb {
  margin-bottom: 14px;
}

.stat-card {
  cursor: pointer;
}

.suffix-sub {
  font-size: 11px;
  opacity: 0.6;
  margin-left: 6px;
}

.section-gap {
  margin-top: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 12px;
}

.quick-card {
  cursor: pointer;
}

.quick-num {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background: #2080f0;
}

.quick-title {
  margin-top: 10px;
  font-weight: 600;
}

.quick-desc {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 4px;
}

.feat-card :deep(.n-list) {
  font-size: 13px;
}
</style>
