<div align="center">

<img src="./build/appicon.png" width="100" height="100" alt="Agenda Butler Logo" style="border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.28);" />

# Agenda Butler · 日程管家

**基于 Wails 3 + Vue 3 + Golang + SQLite 构建的现代化极速 AI 桌面日程管理应用**

[![CI Status](https://github.com/sayhia/agenda/actions/workflows/ci.yml/badge.svg)](https://github.com/sayhia/agenda/actions/workflows/ci.yml)
[![Latest Release](https://img.shields.io/github/v/release/sayhia/agenda?color=00d2ef&label=release)](https://github.com/sayhia/agenda/releases/latest)
[![Go Version](https://img.shields.io/badge/Go-1.26+-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Vue 3](https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)]()

[📥 下载最新版本](https://github.com/sayhia/agenda/releases/latest) · [✨ 核心特性](#-核心特性) · [📸 界面预览](#-界面预览) · [⌨️ 快捷键](#️-全局快捷键) · [🚀 开发与编译](#-本地开发与编译)

<br/>

<img src="./docs/images/desktop-hero-dark.png" width="880" alt="Agenda Butler Preview" style="border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,0.38);" />

</div>

---

## 📥 跨平台下载安装 (Downloads)

前往 [GitHub Releases](https://github.com/sayhia/agenda/releases/latest) 直接获取最新安装包：

| 操作系统 | 下载文件 | 架构支持 / 说明 |
| :--- | :--- | :--- |
| **macOS** | [`.dmg`](https://github.com/sayhia/agenda/releases/latest) / [`.app.tar.gz`](https://github.com/sayhia/agenda/releases/latest) | Universal 通用架构（原生支持 Apple Silicon M系列 与 Intel 芯片） |
| **Windows** | [`.exe` 安装器](https://github.com/sayhia/agenda/releases/latest) / [`.zip` 便携版](https://github.com/sayhia/agenda/releases/latest) | 包含 `amd64` (x64) 与 `arm64` 原生双架构版本，开箱即用 |
| **Linux** | [`.AppImage`](https://github.com/sayhia/agenda/releases/latest) / [`.deb`](https://github.com/sayhia/agenda/releases/latest) / [`.rpm`](https://github.com/sayhia/agenda/releases/latest) | 适配主流 Linux 发行版（Ubuntu、Debian、Fedora、Arch 等） |

---

## ✨ 核心特性

- 🧠 **智能自然语言录入 (Smart NLP)**  
  支持类似 `明天下午4点架构评审 #工程 #发布 P0 提前15分钟` 的自然输入，毫秒级提取时间、优先级、标签与提醒规则。
- 🤖 **AI 全场景时间对话助手 (AI Copilot)**  
  原生接入 **DeepSeek / OpenAI / Ollama / 通义千问** 等主流大模型，支持全日程上下文答疑，并在会话中输出可**一键采纳**的日程操作卡片。
- ⚡ **时间冲突检测与智能避让**  
  秒级扫描待办重合时段，一键由 AI 分析冲突并推荐最优空闲时段。
- 🌅 **今日日程早报 (Daily Briefing)**  
  一键生成今日待办事项综述与精力分配规划。
- 📊 **多维全景视图**  
  支持 **清单列表**、**7 日律动周计划**、**全景月历** 以及 **艾森豪威尔优先级四象限矩阵**。
- 🔒 **本地优先与纯 Go SQLite**  
  零 CGO 嵌入式数据库存储于 `~/.agenda/agenda.db`，数据隐私完全归属本地；支持 **RFC 5545 iCalendar (`.ics`)** 及 **CSV** 双向导入导出。
- 🎨 **包豪斯几何美学与沉浸毛玻璃**  
  支持 **Obsidian Ink、Daylight、Midwater、Ember、Orchid** 5 款设计主题，内置 Web Audio 原生合成晶体音效提示。

---

## 📸 界面预览

| 🤖 AI 日程对话管家 | 📅 7 日律动周计划视图 |
| :---: | :---: |
| <img src="./docs/images/desktop-ai-copilot.png" width="420" alt="AI Copilot" /> | <img src="./docs/images/desktop-daylight-week.png" width="420" alt="Week View" /> |
| **⌗ 优先级四象限矩阵** | **⏱ 临近日程 NEXT UP 信号卡** |
| <img src="./docs/images/desktop-matrix.png" width="420" alt="Eisenhower Matrix" /> | <img src="./docs/images/desktop-hero-dark.png" width="420" alt="Desktop Hero" /> |

---

## ⌨️ 全局快捷键

| 快捷键 | 功能描述 |
| :--- | :--- |
| <kbd>⌘</kbd> + <kbd>K</kbd> / <kbd>Ctrl</kbd> + <kbd>K</kbd> | 唤起全局 Spotlight 命令面板 |
| <kbd>⌘</kbd> + <kbd>J</kbd> / <kbd>Ctrl</kbd> + <kbd>J</kbd> | 展开 / 折叠 AI 对话助理抽屉 |
| <kbd>⌘</kbd> + <kbd>N</kbd> / <kbd>Ctrl</kbd> + <kbd>N</kbd> | 打开全字段新建日程弹窗 |
| <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> / <kbd>4</kbd> | 快速切换视图（列表 / 周计划 / 月历 / 优先级矩阵） |
| <kbd>⌘</kbd> + <kbd>F</kbd> / <kbd>/</kbd> | 快速聚焦全局搜索栏 |
| <kbd>P</kbd> | 打开专注番茄钟 |
| <kbd>Esc</kbd> | 依次关闭开启的弹层、抽屉或清空筛选 |

---

## 🛠️ 架构与技术选型

| 层次 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **桌面框架** | **Wails v3.1** | 轻量跨平台原生桌面框架，支持 macOS 毛玻璃与隐式标题栏 |
| **宿主后台** | **Golang 1.26+** | 后台秒级调度引擎、系统托盘、系统级原生通知分发 |
| **持久层** | **SQLite (`modernc.org/sqlite`)** | 纯 Go 零 CGO 嵌入式数据库，免环境依赖自动迁移 |
| **大模型层** | **OpenAI Compatible REST API** | 原生协议适配 DeepSeek、GPT-4o、Ollama 与 Qwen |
| **前端应用** | **Vue 3 + TypeScript + Vite 8** | 模块化组件拆分，Wails 自动生成强类型 TS 服务调用 |

---

## 🚀 本地开发与编译

### 环境准备
- **Go**: 1.26 或更高版本
- **Node.js**: 22 或更高版本 (推荐 Node 24)
- **Wails 3 CLI**: `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0`

### 快速启动
```bash
# 1. 安装前端依赖并构建前端资源
cd frontend && npm install && npm run build && cd ..

# 2. 运行代码检查与单元测试
go vet ./... && go test -count=1 ./...

# 3. 编译二进制桌面程序
go build -tags production -trimpath -ldflags="-w -s" -o bin/agenda .

# 4. 运行应用
./bin/agenda
```

---

## 📄 开源许可

本项目基于 [Apache License, Version 2.0](./LICENSE) 协议开源。
