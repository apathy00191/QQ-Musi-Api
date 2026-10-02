#QQMusiApi — QQ 音乐统一 API 网关

> A unified QQ Music API gateway: core API + extension proxy + token auth + built-in Web console — pure JS ESM, zero build.

![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Koa 2](https://img.shields.io/badge/Koa-2-333333)

> 本项目仅供学习与技术研究使用，请勿用于商业或侵权用途，请支持正版音乐。

## 目录

1. [项目简介](#1-项目简介)
2. [特性](#2-特性)
3. [架构](#3-架构)
4. [快速开始](#4-快速开始)
   - [4.1 环境要求](#41-环境要求)
   - [4.2 安装与启动](#42-安装与启动)
   - [4.3 首次使用与 curl 三连](#43-首次使用与-curl-三连)
   - [4.4 Web 界面介绍](#44-web-界面介绍)
     - [4.4.1 概览](#441-概览)
     - [4.4.2 Token 管理](#442-token-管理)
     - [4.4.3 接口文档](#443-接口文档)
     - [4.4.4 登录管理](#444-登录管理)
5. [环境变量](#5-环境变量)
6. [鉴权说明](#6-鉴权说明)
7. [接口文档](#7-接口文档)
   - [7.1 基础](#71-基础)
   - [7.2 搜索](#72-搜索)
   - [7.3 歌曲](#73-歌曲)
   - [7.4 用户](#74-用户)
   - [7.5 管理接口（网关）](#75-管理接口网关)
   - [7.6 管理接口（登录与凭证）](#76-管理接口登录与凭证)
   - [7.7 扩展代理接口](#77-扩展代理接口)
8. [扩展服务接入](#8-扩展服务接入)
   - [8.1 从 Release 安装并启动 qq-music-ext](#81-从-release-安装并启动-qq-music-ext)
   - [8.2 方式 B 网关自动拉起扩展服务](#82-方式-b-网关自动拉起扩展服务)
   - [8.3 排查 /api/v2 是否可用](#83-排查-apiv2-是否可用)
   - [8.4 宝塔部署要点](#84-宝塔部署要点)
9. [部署](#9-部署)
   - [9.1 源码上传](#91-源码上传)
   - [9.2 安装依赖](#92-安装依赖)
   - [9.3 手动运行验证](#93-手动运行验证)
   - [9.4 systemd 服务](#94-systemd-服务)
   - [9.5 nginx 反向代理](#95-nginx-反向代理)
   - [9.6 防火墙与端口](#96-防火墙与端口)
   - [9.7 升级流程](#97-升级流程)
   - [9.8 宝塔面板部署（Linux）](#98-宝塔面板部署linux)
10. [FAQ](#10-faq)
11. [与上游项目的关系与致谢](#11-与上游项目的关系与致谢)
12. [License](#12-license)
13. [免责声明](#13-免责声明)
14. [贡献](#14-贡献)

## 1. 项目简介

`qqmusic-gateway` 是基于同工作区两个 QQ 音乐项目统一而成的 **API 网关**：

- **核心能力**移植自 `音乐解析api`（Koa 实现）：搜索、歌曲详情、17 种音质播放直链、QRC 歌词解密、相似歌曲、用户信息与歌单、QQ 扫码与手机验证码登录凭证管理。
- **扩展能力**代理自 `qq-music-ext`（TypeScript 项目，默认端口 3200）：网关通过 `/api/v2/*` 前缀反向代理到 `UPSTREAM_V2`（默认 `http://127.0.0.1:3200`），提供 `getSearchByKey`、`getSongInfo`、`getLyric`、`getMusicPlay`、`getTopLists`、`getRanks`、`getSongListDetail`、`getAlbumInfo`、`getSingerHotsong`、`getComments`、`getRecommend`、`getQQLoginQr`、`getMv`、`getImageUrl` 等接口。

网关为纯 JS ESM、**零构建**，可在 Linux 与 Windows 直接运行；依赖仅 4 个：`koa`、`@koa/router`、`koa-bodyparser`、`undici`。`npm start` 即 `node server.js`。

**一句话定位**：用一个端口（默认 `3400`）同时提供核心 API、扩展代理、统一 Token 鉴权与 Web 管理台的 QQ 音乐统一入口。

**为什么存在**：

- 两个项目的接口分散在不同进程与端口（核心 Koa 服务 vs 扩展服务 `:3200`），调用方要分别对接、分别管理；
- 鉴权方式不统一，API Token、管理令牌与登录凭证散落各处，难以统计与轮换；
- 部署方式不统一（systemd / nginx / 宝塔），逐项目配置繁琐。

本项目把它们收敛成一个网关：**统一端口、统一鉴权、统一统计与凭证管理**，扩展能力按需接入。

## 2. 特性

- **统一入口**：核心 + 扩展两个项目的接口收敛到一个网关端口（默认 3400）。
- **双通道鉴权**：业务接口使用 API Token（`Bearer`），管理接口使用管理令牌（`X-Admin-Token`），并支持 `AUTH_MODE=open` 免鉴权调试模式。
- **Token 调用统计**：按 Token 记录调用次数并持久化到 `DATA_DIR`。
- **内置 Web 管理界面**（`GET /`）：管理令牌登录，含「概览 / Token 管理 / 接口文档 / 登录管理」四个标签页，覆盖状态与统计、Token 创建/启停/重置/删除、接口文档浏览、QQ 扫码登录管理。
- **扩展服务代理**：`/api/v2/*` 反向代理到 `UPSTREAM_V2`，支持 `V2_AUTOSTART` 自动拉起扩展服务子进程。
- **零构建、轻依赖**：纯 JS ESM，4 个运行时依赖，`engines.node >= 18` 即可运行，`npm start` 直接启动。
- **数据持久化在 `data/`**：管理令牌、API Token、调用统计、设备信息与登录凭证全部落在 `DATA_DIR`（默认 `./data`），备份该目录即可整体迁移。
- **机读接口清单**：`GET /docs.json` 返回全部端点的结构化文档（与下文接口表格同源），Web UI「接口文档」页据此渲染。
- **优雅退出**：`SIGINT` / `SIGTERM` 时关闭监听、终止扩展服务子进程、刷写统计数据，5 秒超时强制退出兜底。
- **跨平台 Windows / Linux**：两个平台均可直接运行（Windows 下自动处理扩展服务子进程的启动细节），Linux 部署见[第 9 章](#9-部署)。

## 3. 架构

```text
   调用方 (浏览器 / curl / 应用)
      │
      │  管理请求:  X-Admin-Token: <管理令牌>
      │  业务请求:  Authorization: Bearer <API Token>
      ▼
┌─────────────────────────────────────────────────────────────────┐
│                  qqmusic-gateway  (默认 :3400)                  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  鉴权中间件 (AUTH_MODE=token / open)  +  Token 调用统计   │  │
│  └───────────────────────────────────────────────────────────┘  │
│      │              │                      │                    │
│  ┌───▼────┐   ┌──────▼───────┐   ┌─────────▼──────────────────┐ │
│  │ Web UI │   │  /api/v1/*   │   │  /api/v2/*  反向代理       │ │
│  │  /     │   │  核心内核     │   │  (undici 转发)             │ │
│  │ /admin │   │  search/     │   │                            │ │
│  │ /docs… │   │  song/ user/ │   │                            │ │
│  └────────┘   └──────────────┘   └─────────┬──────────────────┘ │
│  ┌────────────────────────────────────────┐ │                    │
│  │ 数据层 data/ (共享持久化)              │ │                    │
│  │ admin-token · tokens.json · stats.json │ │                    │
│  │ device.json · credential.json          │ │                    │
│  └────────────────────────────────────────┘ │                    │
└────────────────────────────────────────────┼────────────────────┘
                                             │ UPSTREAM_V2
                                             │ (默认 http://127.0.0.1:3200)
                                             ▼
                          ┌─────────────────────────────────────┐
                          │  扩展服务  :3200                    │
                          │  qq-music-ext                      │
                          │  getSearchByKey / getSongInfo / …   │
                          └─────────────────────────────────────┘
```

- 公开接口（`/`、`/health`、`/docs.json`）不经过鉴权。
- 业务接口（`/api/v1/*`、`/api/v2/*`）先经鉴权与统计，再进入内核路由或代理转发。
- 管理接口（`/admin/*`）只认管理令牌。
- 数据层 `DATA_DIR`（默认 `./data`）由鉴权统计、管理接口与核心登录模块共同读写，包含 `admin-token`、`tokens.json`、`stats.json`、`device.json`、`credential.json`。

## 4. 快速开始

### 4.1 环境要求

- **Node.js >= 18**（网关本体）。
- 若同时运行扩展服务 `qq-music-ext`，该项目自身要求 **Node.js `^20.17.0 || >=22.9.0`**（建议直接用 Node 22 LTS）。

### 4.2 安装与启动

仓库地址：<https://github.com/apathy00191/QQ-Musi-Api>

```bash
# 1) 获取源码（二选一）
# 方式一：克隆仓库
git clone https://github.com/apathy00191/QQ-Musi-Api.git
cd QQ-Musi-Api

# 方式二：从 Release 页下载压缩包解压（Release 资产说明见下表）
# cd <解压后的目录>

# 2) 安装依赖
npm install

# 3) 启动
npm start        # 等价于 node server.js，默认监听 0.0.0.0:3400
```

**Release 资产说明**（<https://github.com/apathy00191/QQ-Musi-Api/releases>）：

| 资产 | 内容 | 说明 |
|---|---|---|
| `QQMusicApi.zip` | 网关本体 | 解压后得到本 README 所在的全部内容（`server.js`、`src/`、`public/`、`deploy/` 等） |
| `qq-music-ext.zip` | 扩展服务 | 解压得到 `qq-music-ext/`，作为 `/api/v2/*` 的上游服务，搭建见 [8.1](#81-从-release-安装并启动-qq-music-ext) |

> 解压后的目录名可自定，本文命令示例中网关目录以 `QQMusicApi` 为例。

启动日志会打印**管理令牌**；同时它会被写入 `DATA_DIR/admin-token`（默认 `./data/admin-token`）。

### 4.3 首次使用与 curl 三连

1. **复制管理令牌**（三种途径任选）：
   - 启动日志中的 `ADMIN_TOKEN` 行；
   - 数据目录文件：Linux/macOS 执行 `cat data/admin-token`，Windows PowerShell 执行 `Get-Content .\data\admin-token`；
   - systemd 部署后用 `journalctl -u qqmusic-gateway -f` 查看启动日志。
2. **打开 Web 管理界面**：浏览器访问 `http://localhost:3400/`（即 `http://127.0.0.1:3400/`；远程部署时用 `http://服务器IP:3400/`），把管理令牌粘贴到右上角输入框并点「连接」。
3. **创建 API Token**：在「Token 管理」页填写名称并创建，复制弹窗中的完整令牌备用；然后按下面的 curl 三连调用。

curl 调用三连（下文以 `$TOKEN` 表示 API Token）：

```bash
TOKEN=你刚创建的API-Token

# 1) 健康检查（公开接口，无需鉴权）
curl http://127.0.0.1:3400/health

# 2) 核心接口：热搜词
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3400/api/v1/search/hotkey

# 3) 扩展接口：排行榜元数据（需扩展服务在线，见第 8 章）
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3400/api/v2/getTopLists
```

### 4.4 Web 界面介绍

<!-- screenshots: 部署后可补充 Web UI 截图 -->

顶部导航共四个标签页；右上角为管理令牌输入框与「连接 / 断开」按钮。管理令牌只保存在浏览器 `localStorage`（键 `qmg_admin_token`），仅用于携带 `X-Admin-Token` 请求头。

#### 4.4.1 概览

- 未连接时显示获取管理令牌的指引（启动日志或 `DATA_DIR/admin-token` 文件）。
- 连接后显示**网关状态卡片**：版本、鉴权模式、运行时长、Token 数量（总数 / 启用数）、登录状态、扩展上游 `UPSTREAM_V2` 的健康指示灯与地址，可点「⟳ 刷新」。
- **每日调用统计**表：日期 / 总调用数。
- **Token 调用排行（Top 10）**：序号 / 名称 / 调用数 / 占比 / 最后使用。

#### 4.4.2 Token 管理

- **创建**：填写名称 →「＋ 新建 Token」→ 弹窗显示完整令牌，可一键复制（之后也可随时在列表中「复制」取回完整值）。
- **列表字段**：名称、令牌（掩码显示 + 复制按钮）、启用开关、调用次数、最后使用、创建时间、操作。
- **操作**：启用 / 禁用（开关或按钮）、**重置令牌**（轮换令牌值，保留 id 与历史统计）、**删除**（二次确认，不可恢复）。
- 业务接口（`/api/v1/*`、`/api/v2/*`）调用时携带 `Authorization: Bearer <API Token>`。

#### 4.4.3 接口文档

- 该页数据**公开**，无需管理令牌即可查看：点「查看公开接口文档」加载 `GET /docs.json`。
- 顶部**快速上手卡片**：获取管理令牌、创建 API Token、管理/业务接口鉴权头、`AUTH_MODE` 说明（连接后自动显示当前鉴权模式）。
- 左侧**分组导航** + 右侧端点明细（方法 / 路径 / 说明 / 参数 / 示例）；点击路径或示例可复制整条 curl。

#### 4.4.4 登录管理

- **当前登录状态**：登录状态、是否过期、musicid、凭证文件路径，可「⟳ 刷新状态」。
- **QQ 扫码登录**：「QR 获取二维码」展示 base64 二维码与 identifier，每 2 秒自动轮询扫码结果（切换标签或页面隐藏时自动停止），扫码完成即自动保存凭证。
- **凭证操作**：刷新凭证、退出登录、清空凭证。
- **高级 · 查看凭证**：以 `raw=1` 读取，敏感值默认遮罩，可「显示敏感值」与「复制完整凭证」。

## 5. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3400` | 网关监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `AUTH_MODE` | `token` | `token`=业务接口需 Bearer token；`open`=免鉴权 |
| `ADMIN_TOKEN` | 无 | 管理令牌；不设则自动生成并写入 `DATA_DIR/admin-token`，启动日志会打印 |
| `DATA_DIR` | `./data` | token/凭证/统计持久化目录 |
| `UPSTREAM_V2` | `http://127.0.0.1:3200` | 扩展服务上游 |
| `V2_AUTOSTART` | `0` | 设 `1` 时网关尝试自动拉起扩展服务子进程 |
| `V2_DIR` | 无 | 扩展项目目录（`V2_AUTOSTART=1` 时用） |
| `DEVICE_PATH` | `DATA_DIR/device.json` | 设备信息持久化路径（与核心登录相关） |
| `CREDENTIAL_PATH` | `DATA_DIR/credential.json` | 登录凭证持久化路径（与核心登录相关） |
| `PLATFORM` | `android` | 请求平台：`android` / `desktop` / `web` |

> 上表即网关的全部环境变量。`DATA_DIR`（默认 `./data`）内还会存放 `admin-token`、`tokens.json`、`stats.json`、`device.json`、`credential.json`；如需迁移登录凭证与统计，整体备份 `DATA_DIR` 即可。

## 6. 鉴权说明

| 接口范围 | 鉴权方式 | 示例 |
|---|---|---|
| 公开：`GET /`、`GET /health`、`GET /docs.json` | 无需鉴权 | `curl http://127.0.0.1:3400/health` |
| 业务：`/api/v1/*`、`/api/v2/*` | `Authorization: Bearer <token>`，或查询参数 `?token=<token>` | `curl -H "Authorization: Bearer $TOKEN" ...` |
| 管理：`/admin/*` | 请求头 `X-Admin-Token: <管理令牌>` | `curl -H "X-Admin-Token: $ADMIN_TOKEN" ...` |

- **Bearer 方式**（推荐）：`Authorization: Bearer $TOKEN`，注意 `Bearer` 与 token 之间有一个空格。
- **查询参数方式**：适用于不方便设置请求头的场景，`?token=$TOKEN`。
- **管理令牌**：与 API Token 是两套凭据。管理令牌用于 Web UI 登录与 `/admin/*` 调用，首次启动自动生成；API Token 在 Web UI 中按需创建。
- **`AUTH_MODE=open`**：业务接口不再校验 Bearer token，适合内网联调；公网环境请保持默认 `token` 模式。

## 7. 接口文档

> **机读清单**：`GET /docs.json`（公开）返回与本章同源的结构化端点文档（方法 / 路径 / 说明 / 参数 / 示例），Web UI「接口文档」页据此渲染，参数细节以 `/docs.json` 为准。
>
> 下表为 **7 组共 58 个端点**的完整清单（由 `src/docs.js` 生成）。鉴权级别：**公开** = 无需凭据；**Bearer** = `Authorization: Bearer <token>` 或 `?token=<token>`；**管理** = `X-Admin-Token: <管理令牌>`。参数列中的“(必填)”表示必填参数，其余为可选。
>
> `GET /`（Web 管理界面）同为公开访问，见[第 6 章 鉴权说明](#6-鉴权说明)。`/api/v2/*` 组需扩展服务在线（见[第 8 章](#8-扩展服务接入)），路径为扩展项目原路径加 `/api/v2` 前缀；扩展接口参数亦可参见源项目 `qq-music-ext/src/routes/api-metadata.ts` 与其 `docs/` 目录。

### 7.1 基础

共 2 个端点（均公开、无需鉴权）：

| 方法 | 路径 | 说明 | 关键参数 | 鉴权 |
|---|---|---|---|---|
| GET | `/health` | 健康检查，返回服务状态、登录态与当前 musicid | — | 公开 |
| GET | `/docs.json` | 本接口清单（结构化端点文档），Web UI 据此渲染使用说明 | — | 公开 |

```bash
curl http://127.0.0.1:3400/health
curl http://127.0.0.1:3400/docs.json
```

### 7.2 搜索

共 5 个端点：

| 方法 | 路径 | 说明 | 关键参数 | 鉴权 |
|---|---|---|---|---|
| GET | `/api/v1/search/hotkey` | 热搜词 | — | Bearer |
| GET | `/api/v1/search/complete` | 搜索补全建议 | `keyword`(必填) | Bearer |
| GET | `/api/v1/search/quick` | 快速搜索 | `keyword`(必填) | Bearer |
| POST | `/api/v1/search/general` | 综合搜索（JSON body） | `keyword`(必填)、`page`、`num`、`searchid`、`pageStart`、`highlight` | Bearer |
| POST | `/api/v1/search/byType` | 按类型搜索（歌曲/专辑/歌手/歌单等） | `keyword`(必填)、`type`、`num`、`page`、`searchid`、`highlight` | Bearer |

```bash
# 热搜词
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3400/api/v1/search/hotkey

# 综合搜索（POST + JSON）
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"keyword":"周杰伦","page":1,"num":10}' \
  http://127.0.0.1:3400/api/v1/search/general
```

### 7.3 歌曲

共 5 个端点：

| 方法 | 路径 | 说明 | 关键参数 | 鉴权 |
|---|---|---|---|---|
| GET | `/api/v1/song/detail` | 歌曲详情（支持逗号分隔多个 mid） | `mids`(必填) | Bearer |
| GET | `/api/v1/song/urls` | 播放直链（17 种音质） | `mids`(必填)、`type`（音质代码，默认 `MP3_128`） | Bearer |
| GET | `/api/v1/song/lyric` | 歌词（默认自动 QRC 解密，含原文/翻译/罗马音） | `mid`(必填)、`decode`（1=解密默认，0=仅原始密文） | Bearer |
| GET | `/api/v1/song/similar` | 相似歌曲（展平为一维列表） | `songid`(必填，也接受 `id`) | Bearer |
| GET | `/api/v1/song/relatedSonglist` | 相关歌单 | `mid`(必填) | Bearer |

```bash
# 17 种音质直链
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3400/api/v1/song/urls?mids=0039MnYb0qxYhV&type=MP3_128"

# 歌词（QRC 自动解密，decode=0 关闭解密）
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3400/api/v1/song/lyric?mid=0039MnYb0qxYhV&decode=1"
```

`/api/v1/song/urls` 的 `type` 参数支持 17 种音质（代码引自核心项目 `音乐解析api`）：

| 代码 | 说明 | 代码 | 说明 |
|---|---|---|---|
| `DT03` | DTS:X | `O800` | OGG 320 |
| `AI00` | 臻品母带 | `O600` | OGG 192 |
| `Q000` | 臻品音质 | `O400` | OGG 96 |
| `Q001` | 臻品全景声 5.1 | `M800` | MP3 320 |
| `Q003` | 臻品全景声 7.1 | `M500` | MP3 128 |
| `D004` | 杜比全景声 | `C600` | ACC 192 |
| `TL01` | AICodec | `C400` | ACC 96 |
| `F000` | SQ 无损 | `C200` | ACC 48 |
| `O801` | OGG 640 | | |

### 7.4 用户

共 6 个端点：

| 方法 | 路径 | 说明 | 关键参数 | 鉴权 |
|---|---|---|---|---|
| GET | `/api/v1/user/self` | 当前登录用户信息（需先在管理端登录） | — | Bearer |
| GET | `/api/v1/user/info` | 指定用户信息 | `uin`(必填) | Bearer |
| GET | `/api/v1/user/songlist` | 用户歌单 | `uin`(必填)、`page`、`num` | Bearer |
| GET | `/api/v1/user/follows` | 关注列表 | `uin`(必填)、`page`、`num` | Bearer |
| GET | `/api/v1/user/fans` | 粉丝列表 | `uin`(必填)、`page`、`num` | Bearer |
| POST | `/api/v1/user/follow` | 关注 / 取消关注（JSON body） | `uin`(必填)、`follow`（true=关注默认，false=取消） | Bearer |

```bash
# 用户歌单
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3400/api/v1/user/songlist?uin=123456789&page=1&num=30"

# 关注 / 取消关注（POST + JSON）
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uin":"123456789","follow":true}' \
  http://127.0.0.1:3400/api/v1/user/follow
```

### 7.5 管理接口（网关）

共 7 个端点（均需 `X-Admin-Token`）：

| 方法 | 路径 | 说明 | 关键参数 | 鉴权 |
|---|---|---|---|---|
| GET | `/admin/status` | 网关状态：版本/鉴权模式/运行时长/令牌来源/扩展上游健康度 | — | 管理 |
| GET | `/admin/tokens` | 列出全部 Bearer 令牌（含明文 token 值） | — | 管理 |
| POST | `/admin/tokens` | 创建令牌（JSON body），返回明文 token | `name`(必填) | 管理 |
| PATCH | `/admin/tokens/:id` | 更新令牌名称 / 启用状态 | `name`、`enabled` | 管理 |
| DELETE | `/admin/tokens/:id` | 删除令牌 | `:id` | 管理 |
| POST | `/admin/tokens/:id/rotate` | 轮换令牌值（保留 id 与统计） | `:id` | 管理 |
| GET | `/admin/stats` | 调用统计：按日期 total/byToken + 各令牌累计 | — | 管理 |

```bash
# Linux / macOS
ADMIN_TOKEN=$(cat data/admin-token)
# Windows PowerShell: $ADMIN_TOKEN = Get-Content .\data\admin-token

curl -H "X-Admin-Token: $ADMIN_TOKEN" http://127.0.0.1:3400/admin/status

# 创建 API Token（返回明文 token）
curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-app"}' \
  http://127.0.0.1:3400/admin/tokens
```

### 7.6 管理接口（登录与凭证）

共 10 个端点（均需 `X-Admin-Token`；凭证类操作只在本组暴露，绝不下发给普通 Bearer token）：

| 方法 | 路径 | 说明 | 关键参数 | 鉴权 |
|---|---|---|---|---|
| GET | `/admin/login/status` | 登录状态（loggedIn/expired/musicid/凭证文件路径） | — | 管理 |
| GET | `/admin/login/credential` | 查看凭证（脱敏） | `raw`（1=包含敏感字段） | 管理 |
| PUT | `/admin/login/credential` | 整体替换凭证（JSON body，格式同 credential 文件） | — | 管理 |
| DELETE | `/admin/login/credential` | 清空本地凭证（仅清 musickey/musicid，保留 device） | — | 管理 |
| POST | `/admin/login/refresh` | 刷新凭证并落盘 | — | 管理 |
| POST | `/admin/login/logout` | 服务端登出 + 本地清空凭证 | — | 管理 |
| POST | `/admin/login/qrcode` | 获取登录二维码（QQ/微信/手机端），返回 base64 | `type`（qq 默认 / wx / mobile） | 管理 |
| POST | `/admin/login/checkQrcode` | 轮询二维码扫码状态，完成时返回凭证 | `identifier`(必填)、`type`（qq 默认 / wx） | 管理 |
| POST | `/admin/login/sendAuthcode` | 发送手机验证码 | `phone`(必填)、`countryCode`（默认 86） | 管理 |
| POST | `/admin/login/phone` | 手机验证码登录，成功后保存凭证 | `phone`(必填)、`code`(必填) | 管理 |

```bash
# 登录状态
curl -H "X-Admin-Token: $ADMIN_TOKEN" http://127.0.0.1:3400/admin/login/status

# 获取 QQ 登录二维码（返回 base64）
curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"qq"}' \
  http://127.0.0.1:3400/admin/login/qrcode
```

### 7.7 扩展代理接口

共 23 个代理端点（均需 Bearer token，**需扩展服务在线**；路径为扩展项目原路径加 `/api/v2` 前缀）。此外网关自身提供 `GET /api/v2/_status`（返回 `upstream` / `healthy` / `autostart` / `spawned`，见 [8.3](#83-排查-apiv2-是否可用)），不计入本表 23 行：

| 方法 | 路径 | 说明 | 关键参数 | 鉴权 |
|---|---|---|---|---|
| GET | `/api/v2/getHotkey` | 热搜关键词（上游 getHotKey） | — | Bearer |
| GET | `/api/v2/getSearchByKey` | 关键词搜索（歌曲等内容） | `key`(必填)、`limit`、`page`、`catZhida`、`remoteplace` | Bearer |
| GET | `/api/v2/getSmartbox` | 智能搜索联想 | `key`(必填) | Bearer |
| GET | `/api/v2/getSongInfo` | 歌曲详情（songmid 或 songid） | `songmid`(必填)、`songid` | Bearer |
| GET | `/api/v2/getLyric` | 歌词（isFormat 可格式化） | `songmid`(必填)、`isFormat`、`cookie` | Bearer |
| GET | `/api/v2/getMusicPlay` | 播放直链（需有效登录 cookie） | `songmid`(必填)、`quality`、`resType`、`mediaId`、`cookie` | Bearer |
| GET | `/api/v2/getTopLists` | 排行榜元数据 | — | Bearer |
| GET | `/api/v2/getRanks` | 排行榜详情歌曲 | `topId`、`page`、`limit`、`resolveMid` | Bearer |
| GET | `/api/v2/getSongListDetail` | 歌单详情 | `disstid`(必填) | Bearer |
| GET | `/api/v2/getSongLists` | 歌单列表 | `limit`、`page`、`sortId`、`categoryId` | Bearer |
| GET | `/api/v2/getSongListCategories` | 歌单分类 | — | Bearer |
| GET | `/api/v2/getAlbumInfo` | 专辑信息 | `albummid`(必填) | Bearer |
| GET | `/api/v2/getAlbumSongs` | 专辑歌曲列表 | `albummid`(必填)、`albumid`、`begin`、`limit`、`order` | Bearer |
| GET | `/api/v2/getSingerHotsong` | 歌手热门歌曲 | `singermid`(必填)、`limit`、`page` | Bearer |
| GET | `/api/v2/getSingerList` | 歌手列表（分区/性别/流派/首字母） | `area`、`sex`、`genre`、`index`、`page` | Bearer |
| GET | `/api/v2/getComments` | 评论列表（歌曲/歌单/专辑） | `id`(必填)、`pagesize`、`pagenum`、`cid`、`cmd`、`reqtype`、`biztype`、`rootcommentid` | Bearer |
| GET | `/api/v2/getRecommend` | 首页推荐聚合 | — | Bearer |
| GET | `/api/v2/getDailyRecommend` | 每日推荐（cookie 提升个性化） | `cookie` | Bearer |
| GET | `/api/v2/getQQLoginQr` | 创建 QQ 登录二维码会话 | — | Bearer |
| GET | `/api/v2/getMv` | MV 列表 | `area_id`、`version_id`、`limit`、`page` | Bearer |
| GET | `/api/v2/getMvPlay` | MV 播放信息 | `vid`(必填) | Bearer |
| GET | `/api/v2/getImageUrl` | 构建专辑封面图片 URL | `id`(必填)、`size`、`maxAge` | Bearer |
| GET | `/api/v2/getSimilarSongs` | 相似歌曲推荐 | `songmid`(必填)、`cookie` | Bearer |

```bash
# 上游健康检查（网关自身提供，不计入 23 行代理端点）
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3400/api/v2/_status

# 排行榜元数据
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3400/api/v2/getTopLists
```

## 8. 扩展服务接入

`/api/v2/*` 只是代理；**扩展服务本身必须在 `UPSTREAM_V2`（默认 `http://127.0.0.1:3200`）在线**。两种接入方式：

### 8.1 从 Release 安装并启动 qq-music-ext

扩展服务以压缩包 **`qq-music-ext.zip`** 形式挂在本仓库 [Release](https://github.com/apathy00191/QQ-Musi-Api/releases) 页面，解压得到 `qq-music-ext/`（TypeScript 项目，默认端口 3200）。以下步骤以宝塔/Debian 服务器为例（均为实测步骤）：

**1）下载解压**

从 Release 下载 `qq-music-ext.zip`，上传到服务器后解压：

```bash
cd /www/wwwroot
unzip qq-music-ext.zip        # 得到 /www/wwwroot/qq-music-ext
cd qq-music-ext
```

**2）准备 Node 20.17+ / 22**

```bash
node -v    # 必须满足 ^20.17.0 || >=22.9.0，系统自带的 12/16/18 均不可用
```

宝塔环境常见坑：终端 `node -v` 显示系统旧版（如 v12）而面板装的是新版——把面板 Node 提到 PATH 前面（以实际安装目录为准）：

```bash
export PATH=/www/server/nodejs/v22.15.1/bin:$PATH
hash -r
echo 'export PATH=/www/server/nodejs/v22.15.1/bin:$PATH' >> ~/.bashrc   # 持久化
node -v
```

**3）安装依赖（建议国内镜像）**

```bash
npm config set registry https://registry.npmmirror.com
npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
# 若报 "Cannot read property 'edgesOut' of null"：先升级 npm 11 再重装
#   npm install -g npm@11 --registry=https://registry.npmmirror.com
```

**4）批准 esbuild 安装脚本**（npm 11 安全机制；不批准则 vite 构建会失败）

```bash
npm install-scripts approve esbuild
# 若提示命令不存在，等效方式：npm rebuild esbuild
```

**5）构建生产产物**

```bash
npm run build              # 产出 dist/app.js
# 若最后 MCP 子包（build:mcp）报错，可只构建主服务：npm run build:core
ls dist/app.js && echo "构建OK"
```

**6）启动（二选一）**

```bash
# 终端 1：手动启动（先用这种方式验证链路）
npm start                   # = node dist/app.js，端口 3200
# 或开发模式 npm run dev（tsx 直跑源码，无需构建）

# 终端 2：另一个终端启动网关
cd QQMusicApi && npm start
```

生产环境建议交给宝塔 **Node 项目 / PM2 管理器**托管：目录 `/www/wwwroot/qq-music-ext`，启动命令 `node dist/app.js`，端口 `3200`，Node 版本选 22，勾选开机自启（见 [8.4](#84-宝塔部署要点) 与 [9.8](#98-宝塔面板部署linux)）。

**7）验证链路**

```bash
curl http://127.0.0.1:3200/getHotkey                              # 扩展服务自身可用
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3400/api/v2/_status                             # 网关链路 → healthy:true
```

**注意事项**

- `3200` 端口**不要对公网开放**，外部流量统一走网关 `/api/v2/*`；
- 用户歌单等需登录态的接口要配置 Cookie，见 `qq-music-ext/docs/COOKIE_CONFIG_GUIDE.md`（支持全局配置，或调用时透传 `?cookie=` / `X-Custom-Cookie` 头的降级模式）；
- 扩展服务自带调试台：`http://127.0.0.1:3200/explorer`（仅本机/内网访问即可）。

### 8.2 方式 B 网关自动拉起扩展服务

```bash
V2_AUTOSTART=1 V2_DIR="/path/to/qq-music-ext" npm start
```

网关启动时会尝试把 `V2_DIR` 指向的扩展项目作为子进程拉起（优先 `dist/app.js`，否则回退开发模式启动）；是否成功看启动日志。

### 8.3 排查 /api/v2 是否可用

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3400/api/v2/_status
```

- `GET /api/v2/_status` 返回 `upstream`（上游地址）、`healthy`（上游是否健康）、`autostart`（是否开启自动拉起）、`spawned`（扩展服务子进程是否在运行）。
- 返回上游正常信息 → 代理链路通。
- 返回 502/504 或上游不可达 → 扩展服务未启动或 `UPSTREAM_V2` 配置错误，参见 [FAQ](#10-faq)。

### 8.4 宝塔部署要点

- 扩展服务在宝塔面板下与网关一样按 **Node 项目 / PM2 管理器**部署，端口保持 `3200`；或给网关设置 `V2_AUTOSTART=1` 与 `V2_DIR=/www/wwwroot/qq-music-ext` 让网关自动拉起它。
- 验证：`GET /api/v2/_status` 返回 `healthy:true` 即链路正常。
- 完整面板步骤（Node 版本管理器、上传安装、启动方式、反向代理、备份升级）见 [9.8 宝塔面板部署（Linux）](#98-宝塔面板部署linux)；宝塔托管与 systemd/nginx 两套方式不要混用。

## 9. 部署

以下命令以 Debian/Ubuntu 为例，其他发行版思路相同（路径、服务管理命令可能略有差异）。

### 9.1 源码上传

```bash
# 方式一：scp 上传（在本机执行）
scp -r qqmusic-gateway user@your-server:/opt/qqmusic-gateway

# 方式二：服务器上 git 拉取（把仓库地址换成你的实际地址）
ssh user@your-server
sudo mkdir -p /opt/qqmusic-gateway
git clone https://github.com/apathy00191/QQ-Musi-Api.git /opt/qqmusic-gateway

# 创建运行用户并交出目录所有权（已存在可跳过）
sudo useradd -r -s /usr/sbin/nologin qqmusic || true
sudo chown -R qqmusic:qqmusic /opt/qqmusic-gateway
```

### 9.2 安装依赖

```bash
cd /opt/qqmusic-gateway
sudo -u qqmusic npm install --omit=dev
```

### 9.3 手动运行验证

```bash
cd /opt/qqmusic-gateway
sudo -u qqmusic node server.js
```

确认两点后 `Ctrl+C` 停止：

1. 日志显示监听 `3400` 端口；
2. 日志打印了管理令牌（同时写入 `./data/admin-token`）。

### 9.4 systemd 服务

仓库提供了单元文件模板 [`deploy/qqmusic-gateway.service`](deploy/qqmusic-gateway.service)（其中注释标出了需要按环境修改的 `User`、`WorkingDirectory`、`ExecStart` 中的 node 路径、`ReadWritePaths`）。

```bash
sudo cp deploy/qqmusic-gateway.service /etc/systemd/system/qqmusic-gateway.service
# 按需编辑：sudo vi /etc/systemd/system/qqmusic-gateway.service

# 可选：集中存放环境变量（PORT / AUTH_MODE / ADMIN_TOKEN / DATA_DIR / UPSTREAM_V2 等）
sudo mkdir -p /etc/qqmusic-gateway
sudo tee /etc/qqmusic-gateway/env >/dev/null <<'EOF'
PORT=3400
AUTH_MODE=token
EOF
sudo chmod 600 /etc/qqmusic-gateway/env

sudo systemctl daemon-reload
sudo systemctl enable --now qqmusic-gateway
systemctl status qqmusic-gateway

# 查看启动日志（管理令牌就打印在这里）
journalctl -u qqmusic-gateway -f
```

### 9.5 nginx 反向代理

仓库提供了示例 [`deploy/nginx.conf.example`](deploy/nginx.conf.example)，包含 80 端口、注释掉的 443/HTTPS 证书占位、`client_max_body_size 10m` 与 60 秒超时。

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/qqmusic-gateway
# 编辑 server_name 与证书路径
sudo ln -s /etc/nginx/sites-available/qqmusic-gateway /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

> RHEL/CentOS 系没有 `sites-enabled` 机制，把文件放入 `/etc/nginx/conf.d/` 即可。
> 注意：示例中 upstream 端口 `3400` 必须与网关的 `PORT` 保持一致。

### 9.6 防火墙与端口

```bash
# 只对外暴露 80/443（网关 3400 仅本机反代时无需开放）
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# 若需直连网关端口（内网调试），再放开：
# sudo ufw allow 3400/tcp
```

对外只开 80/443，`3400` 保持 `HOST=0.0.0.0` 但由防火墙/安全组拦截，或直接把 `HOST` 收敛为 `127.0.0.1` 只供本机 nginx 反代。

### 9.7 升级流程

```bash
cd /opt/qqmusic-gateway
git pull
sudo -u qqmusic npm install --omit=dev
sudo systemctl restart qqmusic-gateway
journalctl -u qqmusic-gateway -n 50 --no-pager
```

### 9.8 宝塔面板部署（Linux）

使用宝塔面板时**不需要** `deploy/qqmusic-gateway.service`（systemd）与 `deploy/nginx.conf.example`——进程托管用宝塔的 Node 项目 / PM2，反代用宝塔自带 nginx，在面板里配置即可，两套方式不要混用。

**1）前置准备**

- 软件商店安装「**Node 版本管理器**」，安装 Node.js **18 或更高**（推荐 20 LTS）；
- 软件商店安装「**PM2 管理器**」（方式 B 用；若用方式 A 可不装）。

**2）上传代码并安装依赖**

文件管理器把项目上传解压到 `/www/wwwroot/QQMusicApi`（或在终端 `git clone`），然后面板【终端】执行：

```bash
cd /www/wwwroot/QQMusicApi
npm install --omit=dev
```

**3）启动网关（二选一）**

- 方式 A：【网站】→【Node项目】→ 添加 Node 项目
  - 项目目录：`/www/wwwroot/QQMusicApi`
  - 启动选项 / 命令：`node server.js`
  - Node 版本：选 18+；包管理器选 npm；端口 `3400`；建议勾选「开机自启动」
- 方式 B：【PM2 管理器】→ 添加项目
  - 启动文件：`server.js`（即命令 `node server.js`），项目目录同上
  - 项目名称：`qqmusic-gateway`

本项目开箱即用：不设任何环境变量也会自动监听 `0.0.0.0:3400`，管理令牌自动生成到 `data/admin-token`。如需改端口/鉴权模式等，在启动命令前加环境变量即可，例如 `PORT=3500 AUTH_MODE=open node server.js`（方式 B 也可在 PM2 配置文件的 `env` 中设置）。

**4）对外访问（二选一）**

- 方式 1（推荐）：【网站】→ 添加站点（填域名、PHP 版本选"纯静态"）→ 站点设置 →【反向代理】→ 目标 URL 填 `http://127.0.0.1:3400`，保存启用。之后浏览器访问域名即为 Web 管理界面；HTTPS 在站点【SSL】里申请 Let's Encrypt 即可。
- 方式 2（直连端口）：【安全】放行端口 `3400`，同时在云厂商安全组放行，访问 `http://IP:3400`。仅建议调试时使用。

**5）获取管理令牌**

PM2 / Node 项目日志里有启动打印，或文件管理器查看 `/www/wwwroot/QQMusicApi/data/admin-token`，复制后粘贴到 Web 界面右上角登录。

**6）扩展服务（可选，`/api/v2/*` 代理需要）**

再添加一个 Node 项目或 PM2 项目指向 `qq-music-ext` 目录：先在该目录 `npm install`，启动命令用 `npm run dev`（或 `npm run build` 后 `node dist/app.js`），端口保持 `3200`。也可给网关设置 `V2_AUTOSTART=1` 与 `V2_DIR=/www/wwwroot/qq-music-ext` 让网关自动拉起它。验证：`/api/v2/_status` 返回 `healthy:true`。

**7）备份与升级**

- 重要数据都在 `data/`（管理令牌、API token、登录凭证、调用统计），备份该目录即可；
- 升级：覆盖新代码 → 面板执行 `npm install --omit=dev` → PM2/Node 项目重启；
- 注意：宝塔的 Node 项目/PM2 会把服务托管给面板自身，**不要**同时再执行 `systemctl enable qqmusic-gateway`。

## 10. FAQ

### 业务接口返回 401 怎么排查？

1. 是否携带了 `Authorization: Bearer $TOKEN`（`Bearer` 后有一个空格，token 复制完整、无多余换行）。
2. 是否误用了查询参数方式：`?token=$TOKEN` 与请求头二选一即可。
3. Token 是否已被停用：Web UI「Token 管理」或 `GET /admin/tokens` 检查状态。
4. `AUTH_MODE` 是否为 `token`（默认）；`open` 模式下业务接口不应出现 401。
5. 调用的是管理接口却用了 Bearer：`/admin/*` 必须用 `X-Admin-Token` 请求头。
6. 调用 `/api/v1`、`/api/v2` 时忘了带任何凭据。

### `/api/v2/*` 返回 502 / 上游不可达？

1. 扩展服务是否已启动（[8.1](#81-从-release-安装并启动-qq-music-ext) 手动启动，或 [8.2](#82-方式-b-网关自动拉起扩展服务) `V2_AUTOSTART=1 V2_DIR=...`）。
2. `UPSTREAM_V2` 是否指向正确地址（默认 `http://127.0.0.1:3200`）。
3. 用 `GET /api/v2/_status`（带 Bearer token）确认上游健康。
4. 用 `V2_AUTOSTART=1` 时检查 `V2_DIR` 是否指向扩展项目根目录，失败原因见网关启动日志。

### Token 调用统计在哪里看？

- Web UI 的「概览」页（管理令牌登录后）：每日调用统计表 + Token 调用排行 Top 10。
- 接口方式：`GET /admin/stats`（`X-Admin-Token` 请求头）。
- 数据持久化在 `DATA_DIR`（默认 `./data`）内，重启不丢。

### 登录凭证文件在哪个位置？如何备份？

- 设备与登录凭证默认持久化在 `DATA_DIR` 根下：`./data/device.json`（`DEVICE_PATH`）与 `./data/credential.json`（`CREDENTIAL_PATH`），可用环境变量改到其他路径。
- 凭证文件包含登录态，**属敏感数据**；备份整个 `DATA_DIR` 目录即可迁移（其中还包含 `admin-token`、`tokens.json`、`stats.json`）。
- 不要把 `DATA_DIR` 提交到版本库或暴露到公网。

### 如何重置管理令牌？

删除 `DATA_DIR/admin-token`（默认 `./data/admin-token`）后重启网关：

```bash
rm -f ./data/admin-token
npm start            # systemd 环境：sudo systemctl restart qqmusic-gateway
```

启动日志会打印新生成的管理令牌，同时覆盖写入该文件。若设置了 `ADMIN_TOKEN` 环境变量，则以环境变量为准（需先修改环境变量再重启）。

### `npm install` 报 EBADENGINE / 系统 Node 是 12、14、16 怎么办？

该警告表示服务器自带的 Node 版本低于项目要求的 **≥18**（Debian 10 / 老版 Ubuntu 自带 Node 12 很常见）。此时 `npm install` 可能"看起来成功"，但**服务启动必然失败**（代码使用了 `node:` 前缀导入、可选链等新特性）。升级方式任选其一：

```bash
# 方式一：NodeSource 官方源（Debian/Ubuntu，装 20.x）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs        # CentOS/RHEL 用 dnf/yum
node -v                          # 必须显示 v18 以上

# 方式二：nvm（不污染系统包，适合单用户）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
node -v
```

**宝塔面板推荐做法**：软件商店安装「Node 版本管理器」→ 安装 Node 20 → 在「Node项目 / PM2 管理器」的版本下拉里**显式选择 20**（终端里 `node -v` 仍是旧版不影响，托管进程用所选版本即可）。

升级后清掉旧环境重新安装：

```bash
cd /www/wwwroot/QQMusicApi
rm -rf node_modules
npm install --omit=dev
node -v   # 确认 ≥18 再启动
```

## 11. 与上游项目的关系与致谢

本项目整合自两个开源项目，接口与核心算法的出处如下：

| 上游项目 | 在本项目中的角色 | 出处与链接 |
|---|---|---|
| `音乐解析api` | **核心能力**：`/api/v1/*` 的登录凭证、搜索、歌曲、用户接口，以及签名 / TripleDES / QRC 解密等核心算法 | 其 `package.json` 标注为 [L-1124/QQMusicApi](https://github.com/L-1124/QQMusicApi) 的 Node.js（JavaScript）移植，Koa 实现 |
| `qq-music-ext` | **扩展能力**：`/api/v2/*` 的上游服务与接口元数据（`src/routes/api-metadata.ts`、`docs/` 文档目录） | 对应 [sansenjian/qq-music-api](https://github.com/sansenjian/qq-music-api)，Fork 自 [Rain120/qq-music-api](https://github.com/Rain120/qq-music-api)（原项目已停止维护，该 Fork 持续更新），License 为 MIT |

- **核心算法与接口归属**：`zzc_sign` 签名、自定义 TripleDES 加解密、QRC 歌词解密等核心算法，以及登录 / 搜索 / 歌曲 / 用户等核心接口实现，移植自 `音乐解析api`，其上游为 [L-1124/QQMusicApi](https://github.com/L-1124/QQMusicApi) 的 Node.js 移植（出处以 `音乐解析api/package.json` 的 "JavaScript port of L-1124/QQMusicApi" 标注为准）。
- **扩展服务接口元数据归属**：`/api/v2/*` 各接口的行为、参数与文档取自 `qq-music-ext` 的 `src/routes/api-metadata.ts`，即 [sansenjian/qq-music-api](https://github.com/sansenjian/qq-music-api)；其 README 明确声明 Fork 自 [Rain120/qq-music-api](https://github.com/Rain120/qq-music-api) 并使用 MIT 许可证。
- 衷心感谢 [L-1124](https://github.com/L-1124)、[sansenjian](https://github.com/sansenjian) 与 [Rain120](https://github.com/Rain120) 及各上游项目的所有贡献者；上游项目的版权归其各自作者所有，License 以其各自仓库的声明为准。

## 12. License

本仓库以 **MIT** 许可证发布，全文见仓库内的 [LICENSE](LICENSE) 文件。

上游各项目的 License 以其各自仓库的声明为准（`qq-music-api` 的 Rain120 系项目为 **MIT**，见其仓库 LICENSE；`L-1124/QQMusicApi` 与 `音乐解析api` 以上游仓库内的声明为准）。

## 13. 免责声明

- 本项目仅供学习与技术研究使用，请勿用于侵犯版权或其他商业用途。
- 请支持正版音乐，通过官方渠道收听与购买。
- 项目涉及的登录凭证等敏感数据由使用者自行妥善保管，因使用不当造成的损失与本项目无关。

## 14. 贡献

欢迎通过 Issue 与 Pull Request 参与改进：接口补充、文档修正、部署脚本与问题排查经验都欢迎提交。
