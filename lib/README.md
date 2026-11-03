# DSH宿主、设置页与连接引导

这一层适配DSH，不另存项目资料，也不另造一套后端接口。

| 文件 | 职责 |
|---|---|
| `index.mjs` | 插件主入口。声明名称、依赖服务和配置字段，导入宿主SDK并装配插件。 |
| `host.mjs` | 注册Workbench Remote管理服务、4个Agent工具及随包操作规程。管理调用限制为owner；DSH工具转交共享Python适配层。 |
| `controller.mjs` | 本地进程控制。发现并核对实例，串行处理启动/停止/重启，启动Python，查询状态，准备网页票据和MCP配置。只保留必要系统环境，不传递模型服务等无关环境变量。 |
| `client.js` | DSH设置页浏览器入口，注册`settings.section`，展示状态、地址、数据目录及启停按钮。通过DSH原生Connection调用宿主，不直接执行系统命令。 |
| `launch.js` | 独立工作台网页的自动连接引导。构建时复制到`backend/workbench/web/launch.js`；不负责启动服务。 |
| `tools.json` | 从Python的TOOLS定义生成的工具名称、参数与说明，供DSH注册。不要单独编辑，否则下次构建会覆盖。 |

改设置页布局看`client.js`；改进程生命周期看`controller.mjs`和`python/workbench/managed.py`；改工具业务参数先看`python/workbench/agent.py`，再构建更新tools.json。图标、插件名称与列表简介由根目录package.json、assets和locale提供，不在设置页代码里硬编码。
