<script setup lang="ts">
import { ref, reactive } from 'vue'
import Dashboard from './views/Dashboard.vue'
import DataSources from './views/DataSources.vue'
import MappingEditor from './views/MappingEditor.vue'
import SyncTasks from './views/SyncTasks.vue'
import SettingsView from './views/SettingsView.vue'
import type { DbConfig } from './lib/core'
import { uid } from './lib/core'

const views = [
  { key: 'dashboard', label: '概览', icon: '◆' },
  { key: 'datasources', label: '数据源', icon: '◈' },
  { key: 'mapping', label: 'Mapping 编辑器', icon: '▣' },
  { key: 'sync', label: '同步任务', icon: '⇄' },
  { key: 'settings', label: '设置', icon: '⚙' }
]

const current = ref('dashboard')
const tableContext = ref<{ cfg: DbConfig; database: string; table: string } | null>(null)

const snacks = reactive<Array<{ id: string; text: string; type: string }>>([])

function pushSnack(text: string, type = 'info'): void {
  const id = uid()
  snacks.push({ id, text, type })
  setTimeout(() => {
    const i = snacks.findIndex((s) => s.id === id)
    if (i >= 0) snacks.splice(i, 1)
  }, 4000)
}

function goto(view: string): void {
  current.value = view
}

function openTable(ctx: { cfg: DbConfig; database: string; table: string }): void {
  tableContext.value = ctx
  current.value = 'mapping'
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-icon">◈</span>
        <div class="brand-text">
          <strong>ESLinker</strong>
          <span>DB→ES 映射与同步</span>
        </div>
      </div>
      <nav>
        <button
          v-for="v in views"
          :key="v.key"
          class="nav-item"
          :class="{ active: current === v.key }"
          @click="goto(v.key)"
        >
          <span class="nav-icon">{{ v.icon }}</span
          >{{ v.label }}
        </button>
      </nav>
      <div class="sidebar-foot">v1.0.0 · 纯客户端</div>
    </aside>

    <main class="content">
      <Dashboard v-if="current === 'dashboard'" @go="goto" />
      <DataSources
        v-else-if="current === 'datasources'"
        @snack="pushSnack"
        @open-mapping="openTable"
      />
      <MappingEditor
        v-else-if="current === 'mapping'"
        :table-context="tableContext"
        @snack="pushSnack"
      />
      <SyncTasks v-else-if="current === 'sync'" @snack="pushSnack" />
      <SettingsView v-else @snack="pushSnack" />
    </main>

    <div class="snack-wrap">
      <div
        v-for="s in snacks"
        :key="s.id"
        class="snack"
        :class="`snack-${s.type}`"
        @click="s.type === 'error' ? null : null"
      >
        {{ s.text }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #f5f6f8;
  color: #1f2430;
}

.sidebar {
  width: 216px;
  display: flex;
  flex-direction: column;
  background: #101828;
  color: #cbd5e1;
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 16px;
}

.brand-icon {
  font-size: 26px;
  color: #4f8cff;
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-text strong {
  color: #fff;
  font-size: 16px;
  letter-spacing: 0.5px;
}

.brand-text span {
  font-size: 11px;
  color: #7d8aa0;
}

nav {
  flex: 1;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #b6c2d6;
  font-size: 13.5px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.nav-item.active {
  background: #2b3a55;
  color: #fff;
}

.nav-icon {
  width: 18px;
  text-align: center;
  font-size: 13px;
  opacity: 0.85;
}

.sidebar-foot {
  padding: 14px 16px;
  font-size: 11px;
  color: #5f6d84;
}

.content {
  flex: 1;
  overflow: auto;
  padding: 22px 26px;
}

.snack-wrap {
  position: fixed;
  top: 18px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1000;
}

.snack {
  min-width: 220px;
  padding: 11px 16px;
  border-radius: 8px;
  font-size: 13px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  color: #fff;
  cursor: default;
}

.snack-info {
  background: #2563eb;
}

.snack-success {
  background: #16a34a;
}

.snack-error {
  background: #dc2626;
}
</style>
