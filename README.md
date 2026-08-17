<h1 align="center">ESLinker</h1>

<p align="center">数据库 → Elasticsearch 映射与同步桌面工具（Electron 纯客户端）</p>

纯桌面客户端、零服务、零部署。可视化生成 ES Mapping、一键建索引、全量数据迁移 + MySQL Binlog 实时增量同步。

## 核心能力

- **多数据源本地管理**：MySQL / PostgreSQL / SQL Server / Elasticsearch，AES-256-GCM 本地加密存储账号密码
- **表结构智能解析**：读取字段名、类型、长度、主键、可空、注释；树形浏览数据库与数据表
- **映射规则引擎**：字符串自动 text+keyword 双字段；数值区分 long/integer/float/scaled_float；时间映射 date；主键自动 keyword
- **可视化 Mapping 编辑器**：逐行编辑 ES 类型 / 分词 / 索引 / 备注，JSON 实时预览，模板保存复用，规范校验（重复字段、非法类型等）
- **ES 索引操作**：存在校验、一键创建/重建（防覆盖二次确认）、推送 Mapping、导出 Mapping JSON
- **全量同步**：主键 keyset 分页 + 批量 Bulk 写入，批次/并发可配，断点续传
- **增量同步**：本地 MySQL Binlog 监听（无需 Canal），INSERT/UPDATE/DELETE 实时同步，基于主键幂等
- **任务管控**：启动 / 暂停 / 继续 / 停止 / 重启，实时面板展示条数、进度、延迟、失败日志
- **DDL 离线生成**：粘贴 CREATE TABLE 不连库也能生成 Mapping
- **本地持久化**：数据源、映射模板、任务配置、日志全部落在本机 userData，无任何后台服务与端口

## 技术栈

- Electron（主进程承载全部 Node 能力，无独立后端）
- Vue 3 + Vite（渲染层 UI）
- mysql2 / pg / mssql（数据库驱动）
- @elastic/elasticsearch（ES 官方 SDK）
- mysql-events（zongji 内核，本地 Binlog 监听）
- electron-store（本地持久化）+ Node crypto（AES 加密）

## 快速开始

```bash
npm install
npm run dev        # 开发模式
npm run build      # 类型检查 + 打包 main/renderer
npm run build:mac  # 打包 macOS 安装包（同理 build:win / build:linux）
```

## 使用流程

1. **数据源**：新增数据库与 ES 连接，测试连通后展开表结构
2. **Mapping**：点选数据表 → 自动生成映射 → 按需调整 → 预览 JSON → 创建索引
3. **同步**：新建任务（选库表、目标索引、主键、全量/增量模式）→ 开始

## 说明

- 增量同步要求 MySQL 开启 binlog（`binlog_format=ROW`、`binlog_row_image=FULL`），MySQL 5.6+/8.0 均可
- 主键缺失的表仅支持全量同步
- 所有连接、映射、同步计算均在本地完成，数据不上传任何第三方服务
