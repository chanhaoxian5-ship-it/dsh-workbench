# DSH Workbench

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/icon-dark.png">
  <img src="assets/icon.png" alt="Workbench 插件图标" width="80" height="80">
</picture>

本地 Agent 工作台：管理项目资料、版本与工作记录，内置前后端、设置启停和 MCP 接入。

DSH负责提供设置入口和工具；随包后端在你自己的电脑上保存登记与回执；工作台网页和本机其他Agent通过同一个服务读写同一份资料库。原文件仍在原来的项目目录。

DSH插件列表显示名称为 **Workbench 工作台**。简介与图标来自`package.json`和`locale/`的导出资源；不会依赖设计源目录或远程图片地址。

```text
DSH 设置 → 原生 Connection/Gateway → Workbench宿主服务
                                      ├─ 启动/停止/重启 Python 子进程
                                      ├─ 注册4个Agent工具 + 随包操作规程
                                      └─ 生成单次工作台连接链接

随包前端 ───────── HTTP / 127.0.0.1:高位端口 ──┐
DSH 工具 ── 共享Agent适配层 ───────────────────┤ 本地后端 → 同一SQLite
其他Agent ── stdio MCP ── 共享Agent适配层 ─────┘             原文件仍在原目录
```

## 使用形态

- **DSH管理入口**：设置里的「Workbench 工作台」，可启动、停止、重启、刷新状态、打开随包工作台、显示其他Agent需要的MCP配置。
- **前后端一起打包**：`backend/workbench`包含已复核的Python后端与现有完整前端；不需要另开前端开发服务。
- **本机服务**：仅监听127.0.0.1。在49152–65535段随机直接绑定，占用时换候选；记录实际地址供客户端发现。不依赖常见固定端口。
- **数据独立**：默认`~/.dsh/storages/workbench`，不写进插件安装目录。停服务、更新或卸载插件不会删除项目记录。
- **MCP不另占端口**：客户端启动`python scripts/mcp.py --data-dir <绝对目录>`，通过标准输入输出与同一后端交互。后端关闭时不会擅自唤起。
- **不会自动启动**：autoStart默认false。后端一旦明确启动，关闭DSH后仍可供其他Agent使用；停止是明确操作。
- **打开即连接**：设置页生成30秒、单次有效的启动票据。永久令牌不进入URL、MCP配置、模型参数或日志；页面使用后立即清除fragment。

## 要求与安装

已针对 **DSH 0.2.1-rc.5、Windows、Python 3.12** 验证。DSH插件使用宿主已带的tools、skills、Connection和Remote协议；不要再安装另一份工具运行时。

后端是随包Python源码，**不包含Python解释器**。本机已有`python`即可，无第三方Python依赖；可以在插件配置指定完整`pythonPath`。MCP本身也只使用Python标准库。

详见 [安装、数据接入和回退](docs/INSTALL.md)。私有仓库访问需要你的GitHub权限；不发布到公共npm。

## 目录与文件说明

GitHub文件列表中间一列显示的是“最近一次提交说明”，不是文件的固定介绍。下面的导航与各目录内README用于长期说明源码职责。

| 目录 / 文件 | 保存什么、负责什么 | 从哪里开始看 |
|---|---|---|
| [.github/workflows](.github/workflows/) | Windows CI定义：干净checkout后重建、跑后端回归、测试进程/MCP并预检npm包。没有日常资料或凭据。 | [CI步骤说明](.github/workflows/README.md) |
| [backend/workbench](backend/workbench/) | 插件真正运行的Python包：HTTP、契约、业务逻辑、SQLite、可靠发布、文件读取、维护，以及托管/MCP扩展的生成副本。 | [后端文件职责](backend/workbench/README.md) |
| [backend/workbench/web](backend/workbench/web/) | 你打开的完整工作台网页；包含HTML、全局样式、页面交互、真实项目页面、预览样例、双轨概览和页面图标。 | [前端逐文件说明](backend/workbench/web/README.md) |
| [lib](lib/) | DSH适配层：插件入口、宿主Remote服务、工具/规程注册、设置页、Python进程控制和网页自动连接引导。 | [DSH文件职责](lib/README.md) |
| [python/workbench](python/workbench/) | `managed.py`、`agent.py`、`mcp.py`的维护源。构建时覆盖backend中的对应副本，避免两份独立演进。 | [维护源与生成副本的区别](python/workbench/README.md) |
| [scripts](scripts/) | 构建、管理服务、启动stdio MCP、可靠HTTP发布、检查/备份/恢复、运行测试的命令入口。 | [各脚本用法](scripts/README.md) |
| [tests](tests/) | Python回归与Node集成测试；验证存储、HTTP、冲突、进程、票据和MCP，使用合成/隔离数据。 | [测试文件覆盖范围](tests/README.md) |
| [docs](docs/) | 安装、Agent工作规程、验证范围、HTTP字段/接口说明及合成请求样例。 | [文档导航](docs/README.md) |
| [assets](assets/) | 用户提供的W图标：主PNG、深色版和SVG原稿。用于DSH插件列表与README，区别于网页内部业务图标。 | [图标使用说明](assets/README.md) |
| [locale](locale/) | DSH插件列表和详情的中英文名称、简介；只改展示文字，不改变技术包名或工具身份。 | [展示元数据说明](locale/README.md) |
| [package.json](package.json) | 插件技术身份、版本、简介、图标、DSH宿主/客户端声明、资源导出、依赖边界与npm随包清单。 | 调整插件展示或包入口时先看这里。 |
| [cordis.patch.yml](cordis.patch.yml) | 安装组合用的Cordis补丁，插入`workbench-suite`插件条目，不存用户私有配置。 | 修改注册入口，保持条目ID稳定。 |
| [bundle-manifest.json](bundle-manifest.json) | 构建生成的随包源码/展示资源SHA-256清单，便于核对包内资源一致；不含数据库和凭据。 | 由build_bundle生成，不手工改摘要。 |
| [.gitattributes](.gitattributes) | 统一文本换行为LF，减少Windows/CI差异，保持按字节计算的资源摘要可复现。 | 影响文本归一化，不影响程序逻辑。 |
| [.gitignore](.gitignore) | 防止Git提交运行数据库、令牌、endpoint、日志、依赖和测试输出。 | 不负责npm发布筛选。 |
| [.npmignore](.npmignore) | npm发布时的补充排除规则；与package.json.files白名单共同防止缓存和运行资料进入安装包。 | 修改打包后应检查真实npm包文件列表。 |
| [README.md](README.md) | 项目总览、目录导航、使用形态和开发入口；不是部署成功的验收记录。 | 首次了解项目从这里开始。 |

### 要改某一处时，通常看哪里

- **网页外观、排版和文案**：`backend/workbench/web/index.html`、`app.css`；主要页面组织看`experience.js`，真实项目资料流程看`projects.js`。
- **双轨阶段与里程碑**：`web/stages.js`、`stages.css`；接真实数据还要对照`projects.py`的board读取与项目契约。
- **DSH设置页的按钮和说明**：`lib/client.js`；按钮背后的宿主注册在`lib/host.mjs`，进程控制在`lib/controller.mjs`。
- **Agent工具或MCP行为**：先改`python/workbench/agent.py`或`mcp.py`，构建同步；`lib/tools.json`是生成文件。
- **插件列表图标、名称和简介**：`assets/icon.png`、`package.json.icon/description`、`locale/en.json`与`locale/zh.json`。
- **新增网页资源或API字段**：不仅改页面，还要核对`server.py`的静态白名单、对应契约、路由和相关验证。

## Agent怎么用

先读 [AGENT_GUIDE.md](docs/AGENT_GUIDE.md)。这份文档也作为`workbench-agent-guide`在DSH中供模型和用户加载。

| 工具 | 用途 |
|---|---|
| workbench_service_status | 核对实际服务身份与健康状态；不启停 |
| workbench_read | 查询白名单`/v1`路径，包括board、文件、修订、回执与搜索 |
| workbench_publish_project | 按现有v1契约可靠登记/更新项目资料，回执与确切修订读回 |
| workbench_publish_discovery | 可靠交付带来源、会话与核验声明的发现 |

DSH与MCP工具参数/结果共用同一Python适配层。项目写入仍为逐操作事务，不冒充整批检查点。重要变化可通过查询工具读取，关注状态写入尚未封装为MCP工具。

## 开发与验证

```powershell
python scripts/build_bundle.py
./scripts/test-backend.ps1
node --test tests/runtime.test.mjs
./scripts/service.ps1 -Action status
```

独立仓库内`backend/`是随包基础源码，`python/workbench/`维护进程与Agent/MCP扩展；build_bundle同步扩展和资源清单。原Workbench工程可用`--source-root <工程绝对目录>`重新打包后端和现有前端。所有测试用隔离数据，不读取日常库。

验证范围与限制见 [VALIDATION.md](docs/VALIDATION.md)。日常desktop未自动安装/重启，当前双轨前端数据映射、整批检查点和来源有效状态仍是已有未完成项，不因打包而声称完成。原V0采集/草稿桥接插件仍在原工程保留，新包不自动迁移其策略或草稿。
