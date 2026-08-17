<script setup lang="ts">
import { ref, onMounted, toRaw } from 'vue'

const emit = defineEmits<{ (e: 'go', view: string): void }>()

function serialize<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(toRaw(value))) as T
}

const stats = ref({ dbs: 0, es: 0, tasks: 0, running: 0 })
const version = ref('')
const esVersion = ref('')

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
    version.value = 'Electron ' + (window.process?.versions?.electron || '-')
    const esSrc = srcs.find((s) => s.kind === 'es')
    if (esSrc?.es) {
      try {
        const info = await window.api.es.test(serialize(esSrc.es))
        esVersion.value = `ES ${info.version} · ${info.cluster}`
      } catch {
        esVersion.value = 'ES 未连接'
      }
    }
  } catch {
    // ignore
  }
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>概览</h1>
      <p>纯客户端、零服务：数据库表结构可视化映射 + 全量/增量数据同步</p>
    </header>

    <div class="cards">
      <div class="card" @click="emit('go', 'datasources')">
        <div class="card-num">{{ stats.dbs }}</div>
        <div class="card-label">数据库数据源</div>
        <div class="card-sub">MySQL / PostgreSQL / SQL Server</div>
      </div>
      <div class="card" @click="emit('go', 'datasources')">
        <div class="card-num">{{ stats.es }}</div>
        <div class="card-label">Elasticsearch 数据源</div>
        <div class="card-sub">{{ esVersion || '点击配置 ES 连接' }}</div>
      </div>
      <div class="card" @click="emit('go', 'sync')">
        <div class="card-num">{{ stats.tasks }}</div>
        <div class="card-label">同步任务</div>
        <div class="card-sub">{{ stats.running }} 个运行中 / 已暂停</div>
      </div>
    </div>

    <div class="quick">
      <h2>快速开始</h2>
      <div class="quick-grid">
        <button class="quick-btn" @click="emit('go', 'datasources')">
          <span class="qb-icon">◈</span>
          <span>1. 配置数据源</span>
          <small>添加数据库与 ES 连接并测试连通</small>
        </button>
        <button class="quick-btn" @click="emit('go', 'mapping')">
          <span class="qb-icon">▣</span>
          <span>2. 生成 Mapping</span>
          <small>自动类型映射、可视化编辑、一键建索引</small>
        </button>
        <button class="quick-btn" @click="emit('go', 'sync')">
          <span class="qb-icon">⇄</span>
          <span>3. 开始同步</span>
          <small>全量批量迁移 + Binlog 实时增量</small>
        </button>
      </div>
    </div>

    <div class="feature-list">
      <h2>核心能力</h2>
      <ul>
        <li>多数据源本地管理，AES 加密存储账号密码</li>
        <li>智能 DB→ES 类型映射（text+keyword 双字段、数值/时间/主键自动适配）</li>
        <li>Mapping 可视化编辑、JSON 实时预览、模板复用</li>
        <li>一键创建 / 更新 ES 索引，防覆盖校验，导出 Mapping JSON</li>
        <li>全量分页批量同步（断点续传）+ MySQL Binlog 实时增量同步</li>
        <li>DDL 粘贴离线生成 Mapping（无需连接数据库）</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 980px;
}

.page-head h1 {
  margin: 0 0 6px;
  font-size: 22px;
}

.page-head p {
  margin: 0 0 20px;
  color: var(--es-text-2);
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.card {
  background: var(--es-panel);
  border: 1px solid var(--es-border);
  border-radius: 12px;
  padding: 18px 20px;
  cursor: pointer;
  transition: box-shadow 0.15s;
}

.card:hover {
  box-shadow: 0 8px 22px rgba(16, 24, 40, 0.08);
}

.card-num {
  font-size: 30px;
  font-weight: 700;
  color: var(--es-primary);
}

.card-label {
  margin-top: 6px;
  font-weight: 600;
}

.card-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--es-text-3);
}

.quick,
.feature-list {
  margin-top: 28px;
}

.quick h2,
.feature-list h2 {
  font-size: 16px;
  margin: 0 0 12px;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.quick-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 16px;
  background: var(--es-panel);
  border: 1px solid var(--es-border);
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  color: var(--es-text);
  font-size: 14px;
}

.quick-btn:hover {
  border-color: var(--es-primary);
}

.quick-btn small {
  color: var(--es-text-3);
  font-size: 12px;
}

.qb-icon {
  font-size: 22px;
  color: var(--es-primary);
}

.feature-list ul {
  padding-left: 18px;
  color: var(--es-text-2);
  line-height: 1.9;
}
</style>
