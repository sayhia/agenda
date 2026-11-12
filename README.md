# 日程管家 PC 桌面版 (Agenda Butler AI Desktop)

> 基于 **Wails 3 + Vite + Vue 3 + TypeScript + Golang + SQLite + LLM 大模型** 技术栈构建的跨平台现代化高性能智能日程管理 PC 桌面软件。

---

## 🌟 核心技术栈 (Tech Stack)

| 层次 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **桌面框架** | **Wails v3.1.0** (`github.com/wailsapp/wails/v3`) | 轻量极速原生桌面框架，支持 macOS 磨砂半透明背景 (Translucent Backdrop) 与隐式标题栏 |
| **宿主后台** | **Golang 1.27** | 高性能原生进程、后台秒级调度引擎、系统原生弹窗通知调度 (AppleScript/osascript) |
| **持久层数据库** | **SQLite** (`modernc.org/sqlite`) | 纯 Go 零 CGO 嵌入式关系型数据库，开箱即用，自动迁移，存储于 `~/.agenda-desktop/agenda.db` |
| **AI 大模型接入** | **OpenAI Compatible REST API** (`internal/agenda/ai.go`) | 原生支持 **DeepSeek**、**OpenAI (GPT-4o)**、**本地 Ollama**、**通义千问 (Qwen)** 等多模型，零外部依赖 |
| **前端界面** | **Vue 3 (Composition API / `<script setup>`)** | 响应式声明式 UI，模块化组件拆分 |
| **编程语言** | **TypeScript 5.9** | 强类型安全保障，包含 Wails 自动生成的 Go-TS 服务双向绑定 |
| **构建打包** | **Vite 8 + vue-tsc** | 秒级热重载与极速静态编译 |

---

## 🤖 AI 智能助理体系 (AI Assistant Capabilities)

### 1. 全天候日程智能对话助理 (`AIAssistantDrawer.vue`)
- 点击顶部右上角 **✨ AI 助手** 即可滑出半透明毛玻璃抽屉面板。
- 后台自动向大模型注入当前精准时间与用户全量日程上下文，支持自然会话：
  - *“帮我看看今天有什么重要安排？”*
  - *“明天下午我想空出 2 小时写代码，帮我调整一下日程”*
  - *“根据我现有的会议和吃药习惯，给我提一些健康和时间管理建议”*

### 2. 交互式一键采纳操作卡片 (`agenda-action`)
- 当 AI 理解用户的排期意图后（如 *“帮我安排下周二下午 3 点的项目复盘会”*），会在回复中输出结构化行动载荷：
  ```agenda-action
  {"action":"create","title":"项目复盘会","scheduled_at":"2026-11-17T15:00:00+08:00","lead_minutes":10,"notes":"准备汇报PPT"}
  ```
- 前端自动解析并在聊天流中渲染出带有高光和芯片徽章的 **操作卡片 (Action Card)**，用户点击 **「一键添加到日程」** 即可直接入库 SQLite，无需手动输入！

### 3. 今日日程早报 (Daily Briefing)
- 点击 **🌅 今日早报**，AI 自动汇总今日待办事项，梳理时间线优先级与精力分配方案，生成专业而有温度的晨间备忘。

### 4. 智能时间冲突检测 (Conflict Detection)
- 点击 **⚠️ 冲突检测**，自动扫描所有活跃日程的开始时间与持续时长 (`duration_minutes`)，精准捕获撞期交叉点，并由 AI 给出最优避让与重新排期建议。

### 5. 灵活的大模型配置与离线自适应
- 在右上角设置中即可配置：
  - **API Base URL**（如 `https://api.deepseek.com/v1` 或本地 `http://localhost:11434/v1`）
  - **API Key**
  - **Model**（如 `deepseek-chat`, `gpt-4o-mini`, `qwen-plus`）
  - 支持 **一键测试连接**（实时检测连通性与模型响应延迟）。
- **离线智能兜底**：若未填写 API Key，内置的规则引擎依然能自动生成日程早报与冲突检测报告，确保在任何网络环境下均丝滑可用。

---

## ✨ 界面与交互特色 (UI & Aesthetics)

1. **智能自然语言录入 ([QuickAddBar.vue](./frontend/src/components/QuickAddBar.vue))**
   - 客户端 NLP 引擎即时提取时间、循环、提前量、时长与备注，输入栏下方浮现对应的高光语义解析微徽章。
2. **包豪斯几何美学与通透毛玻璃 ([styles.css](./frontend/src/assets/styles.css))**
   - 32px 点阵、36px 十字微格、24px 正交网格、48px 菱形与 32px 蓝图对角线。
   - 真实毛玻璃折射 (`backdrop-filter: blur(20px)`)、OKLab 自适应色彩与发光顶发丝微反射。
3. **高对比鲜明语义色块系统 (Semantic Chips)**
   - 涵盖循环 (紫靛)、范围 (晴空蓝)、备注 (温暖琥珀)、倒计时 (翡翠绿)、提前提醒 (青碧) 与临近到期 (落日珊瑚红微外发光)。
4. **悬浮毛玻璃操作胶囊浮岛 ([ReminderList.vue](./frontend/src/components/ReminderList.vue))**
   - 任务行悬停滑入操作坞：顺延 1 小时、暂停/恢复、可视化编辑、投递记录审计、删除。
5. **双重视图体系与 7 日律动周历**
   - 分组任务列表（按今天/明天/即将到来/循环/暂停/结束归并，时间列等宽排布）。
   - 全景月历视图（7 列精密网格，今日单元格搭载高光品牌药丸）。
   - 7 日律动周历条（横向活动条，支持单日快速穿梭过滤）。
6. **多维主题美学与晶莹声音提示 ([SettingsModal.vue](./frontend/src/components/SettingsModal.vue))**
   - 5 种沉浸式美学主题自由切换：Obsidian Ink、Daylight、Midwater、Ember、Orchid，纯 CSS 变量平滑驱动，开箱持久化。
   - 内置 Web Audio API 原生合成的双音谐波晶体音效 (`E5 -> A5 -> C#6`)，到期柔和悦耳发声，支持一键试听与静音开关。
7. **全场景全局键盘快捷键 (Power Keyboard Navigation)**
   - `⌘K` / `Ctrl+K`: 瞬间聚焦聚光灯命令面板
   - `⌘J` / `Ctrl+J`: 一键唤出 / 隐藏 AI 对话助手抽屉
   - `⌘N` / `Ctrl+N`: 唤起全字段日程编辑弹窗
   - `⌘F` / `Ctrl+F` 或 `/`: 快速聚焦全局搜索栏
   - `Esc`: 阶梯式关闭开启的弹窗、抽屉或清空筛选
8. **月历深度交互 ([MonthCalendar.vue](./frontend/src/components/MonthCalendar.vue))**
   - 点击任意日期单元格即时展开 **当日日程清单浮层**，支持行内快捷暂停/激活、编辑、删除与「在此日期新建日程」。
9. **RFC 5545 iCalendar 互导支持 ([ics.go](./internal/agenda/ics.go))**
   - 支持从第三方日历（Apple Calendar、Google Calendar 等）导入/导出 `.ics` 文件。

---

## 📁 目录结构 (Project Layout)

```text
agenda-desktop/
├── main.go                     # Wails3 应用初始化、Mac 磨砂窗口配置与调度器启动
├── internal/
│   └── agenda/
│       ├── service.go          # AgendaService 后台 RPC 接口定义
│       ├── ai.go               # AI 大模型接口 (OpenAI 协议/DeepSeek/Ollama 适配、早报、冲突检测)
│       ├── db.go               # SQLite 初始化、自动建表迁移、默认日程种子
│       ├── scheduler.go        # 后台轮询、系统通知分发、RRULE 下次时间推算
│       ├── csv.go              # CSV 导出与导入解析
│       └── ics.go              # iCalendar RFC 5545 导出与导入解析
├── bin/
│   └── agenda-desktop          # 编译完成的独立桌面可执行程序 (~22 MB)
└── frontend/                   # Vue 3 + TypeScript 前端工程
    ├── src/
    │   ├── App.vue             # 主界面布局与状态协同
    │   ├── assets/styles.css   # 几何背景图、毛玻璃系统、OKLab 配色
    │   ├── utils/nlp.ts        # 客户端智能自然语言识别引擎
    │   ├── utils/format.ts     # 时间、日期与循环标签格式化
    │   └── components/
    │       ├── HeaderBar.vue           # 顶部应用栏、AI助手入口、搜索框、ICS
    │       ├── AIAssistantDrawer.vue   # ✨ AI 对话管家抽屉、早报、冲突分析、一键采纳卡片
    │       ├── QuickAddBar.vue         # 智能命令输入栏与实时解析 Chip 徽标
    │       ├── StatsBar.vue            # KPI 关键指标卡片
    │       ├── WeekStrip.vue           # 7 日律动周历横条
    │       ├── ReminderList.vue        # 分组日程列表与悬浮操作胶囊
    │       ├── MonthCalendar.vue       # 7 列月历全景视图
    │       ├── ReminderEditorModal.vue # 可视化全字段编辑抽屉
    │       ├── HistoryModal.vue        # 45° 菱形水晶时间轴审计面板
    │       ├── BatchActionBar.vue      # 底部批量操作胶囊浮条
    │       ├── SettingsModal.vue       # 系统设置与 AI 大模型配置面板
    │       └── ToastNotice.vue         # 悬浮轻吐司通知
    └── bindings/agenda-desktop/internal/agenda # Wails3 自动生成的强类型 TS/JS 绑定
```

---

## 🚀 编译、测试与运行 (Build, Test & Run)

```bash
# 1. 运行前端工具单测并编译前端产物
cd frontend && npm ci && npm test && npm run build && cd ..

# 2. 运行 Go 静态检查与后端单测
go vet ./... && go test -count=1 -v ./...

# 3. 编译并生成单文件桌面二进制
go build -o bin/agenda-desktop .

# 4. 启动桌面应用
./bin/agenda-desktop
```
启动后即可在独立的桌面窗口中体验完整的 AI 智能日程管家！

---

## 📄 License

本项目基于 [Apache License, Version 2.0](./LICENSE) 开源。
