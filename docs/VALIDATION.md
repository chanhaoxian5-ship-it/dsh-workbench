# 验证范围

2026-11-03，Windows / Python3.12，安装版DSH0.2.1-rc.5。测试数据均为新建隔离库和合成项目，不包含日常资料或凭据。

## 已亲自执行

- 随包后端89项完整回归通过，包括原有接口、并发、提交故障、响应丢失、旧库升级、修订、备份恢复与本轮review修复。测试执行的是本包backend目录，不是原工程src目录。
- Node运行集成5组通过：两个控制器竞争启动同一资料库只产生一份服务；高位优先端口被占用时改绑另一个高位端口；重启保留登记/回执；身份不匹配时不停止其他服务；一次性网页票据、认证和实例匹配；MCP关闭时如实报告，不自动唤起，重启后自动发现新端口。
- 安装包中的真实DSH Cordis、ToolRuntime、SkillRegistry、Typert Registry和Gateway在全新上下文中注册本插件逻辑：4工具、操作文档加载、6个管理方法、实际start/restart/stop调用通过。即便测试访问决策允许其他API Peer，插件自身仍拒绝非owner启停。未调用模型，未改日常profile。
- 官方`@modelcontextprotocol/client` 2.2.0真实stdio客户端完成握手、tools/list、tools/call，读取后端能力。不是仅自行拼一份成功日志。
- 使用安装版DSH的React18.3.1在隔离浏览器测试台渲染设置页，实际点击启动、重启、停止、显示MCP配置；打开随包前端后通过一次性票据自动连接成功，fragment清除，页面无JS错误。浏览器测试台替代DSH Connection传输，原生Gateway路径已另行验证；两者不能冒充日常desktop完整端到端验收。
- 实际npm打包后解压到独立目录，从解压包启动后端、读取能力、提供完整前端并停止成功，不依赖原工程源码路径。核对70份随包源码的SHA-256清单；包文件列表无数据库、令牌、endpoint、pycache或实验资料。对Git暂存文本做常见凭据模式扫描未发现命中，不作全面安全认证。

## 代码/契约依据

客户端通过DSH的`connection.rpc.call('/api', 'workbench/{method}', {args:{}})`调用宿主的Remote服务；继承TypertRemoteService，通过协议公开的Remote装饰器注册无参数方法，使用安装版支持的SRC描述回退。输入和owner范围由插件再次约束，未把它描述为Typert编译生成的严格描述文件。

设置贡献注册在`settings.section`。管理方法无任意命令、任意PID或任意URL参数。DSH工具和MCP共享Python AgentService，元数据写入复用已经review的可靠发布客户端；MCP不另设数据库。

Python解释器外置；仅包含后端源码与完整前端。高位端口是直接bind候选（不是先探测再bind），实际端点保存在独立dataDir。MCP取消或客户端终止不承诺回滚已提交写入，未知结果必须查原键与回执。

## 尚未验收

- 未向用户日常desktop自动安装、改配置或重启。目标profile实际依赖解析、插件加载及日常UI点击仍需安装后验证；不能把隔离注册当成常驻安装成功。
- 未迁移日常工作台库、旧V0草稿/来源策略或原项目文件。
- 新版双轨概览与board数据映射、整批validate/commit、来源有效状态仍待实现；打包不改变这些能力边界。
- 未在其他DSH版本、其他操作系统或全部Agent客户端验证。MCP工具支持核心查询和项目/发现写入，不是现有HTTP所有POST路由的一比一封装。
