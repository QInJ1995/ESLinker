<script setup lang="ts">
import { ref, h } from 'vue'
import { NIcon } from 'naive-ui'
import Dashboard from './views/Dashboard.vue'
import DataSources from './views/DataSources.vue'
import MappingEditor from './views/MappingEditor.vue'
import SyncTasks from './views/SyncTasks.vue'
import SettingsView from './views/SettingsView.vue'
import CompareData from './views/CompareData.vue'
import type { DbConfig } from './lib/core'
import { themePref, setTheme, naiveTheme } from './lib/theme'

const views = [
  { key: 'dashboard', label: '概览', glyph: '◆' },
  { key: 'datasources', label: '数据源', glyph: '◈' },
  { key: 'mapping', label: 'Mapping 编辑器', glyph: '▣' },
  { key: 'sync', label: '同步任务', glyph: '⇄' },
  { key: 'compare', label: '数据对比', glyph: '≍' },
  { key: 'settings', label: '设置', glyph: '⚙' }
]

const current = ref('dashboard')
const tableContext = ref<{ cfg: DbConfig; database: string; table: string } | null>(null)

const menuOptions = views.map((v) => ({
  key: v.key,
  label: v.label,
  icon: () =>
    h(
      NIcon,
      { size: 15 },
      { default: () => h('span', { style: 'font-size: 14px; opacity:0.85' }, v.glyph) }
    )
}))

function goto(view: string): void {
  current.value = view
}

function openTable(ctx: { cfg: DbConfig; database: string; table: string }): void {
  tableContext.value = ctx
  current.value = 'mapping'
}
</script>

<template>
  <n-config-provider :theme="naiveTheme" style="height: 100%">
    <n-global-style />
    <n-layout has-sider style="height: 100vh" :native-scrollbar="false">
      <n-layout-sider
        bordered
        collapse-mode="width"
        :collapsed-width="0"
        :width="218"
        :native-scrollbar="false"
        style="padding: 0 10px"
      >
        <div class="brand">
          <div class="brand-logo">◈</div>
          <div class="brand-text">
            <strong>ESLinker</strong>
            <span>DB → ES 映射与同步</span>
          </div>
        </div>
        <n-menu :options="menuOptions" :value="current" @update:value="goto" />
        <div class="sider-foot">
          <div class="theme-row">
            <span class="muted-txt">{{ themePref === 'dark' ? '深色' : '浅色' }}主题</span>
            <n-switch
              size="small"
              :value="themePref === 'dark'"
              @update:value="setTheme($event ? 'dark' : 'light')"
            />
          </div>
          <div class="ver">v1.0.0 · 纯客户端</div>
        </div>
      </n-layout-sider>
      <n-layout :native-scrollbar="false" style="padding: 0 0 0 0">
        <main class="content">
          <Dashboard v-if="current === 'dashboard'" @go="goto" />
          <DataSources v-else-if="current === 'datasources'" @open-mapping="openTable" />
          <MappingEditor v-else-if="current === 'mapping'" :table-context="tableContext" />
          <SyncTasks v-else-if="current === 'sync'" />
          <CompareData v-else-if="current === 'compare'" />
          <SettingsView v-else />
        </main>
      </n-layout>
    </n-layout>
  </n-config-provider>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 10px 16px;
}

.brand-logo {
  font-size: 24px;
  color: inherit;
  opacity: 0.9;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.brand-text strong {
  font-size: 16px;
  letter-spacing: 0.5px;
}

.brand-text span {
  font-size: 11px;
  opacity: 0.55;
}

.sider-foot {
  padding: 12px 10px 16px;
  border-top: 1px solid rgba(128, 128, 128, 0.18);
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.theme-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.muted-txt {
  font-size: 12px;
  opacity: 0.6;
}

.ver {
  font-size: 11px;
  opacity: 0.4;
}

.content {
  padding: 24px 28px;
  max-width: 1280px;
}
</style>
