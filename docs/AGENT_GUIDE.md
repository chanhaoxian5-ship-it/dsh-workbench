# Workbench：给 Agent 的使用建议

你操作的是用户电脑上的本地工作台，保存项目元数据、文件引用、修订和回执，不是原文件编辑器或全局聊天系统。DSH 工具与 MCP 使用同一后端和数据库。

## 先连接与确认范围

0. 先由用户在网页“项目访问权限”中为已登记的项目生成配置。MCP 启动带 `--project-dir <项目绝对目录>`；DSH 工具每次传 `project_dir`。固定 --project-dir 的 MCP 不能用工具参数切换到其他目录。缺配置时报告 project_configuration_required，不读取管理 Token、不自动创建权限。
1. 调用 `workbench_service_status`。只有真实运行且身份匹配才继续。服务关闭时告知用户在 DSH「设置 → Workbench 工作台」启动，不反复重启其他程序，也不猜端口。
2. 调用 `workbench_read`，path=`/v1/capabilities`，然后读取已有工作空间。先确定用户授权的项目与原目录；不要自动扫描整块磁盘或所有会话。
3. schema_version=1 是HTTP契约；version 是每条登记的修订号；数据库结构版本3是另外一件事。不要混用。

## 读取

`workbench_read` 只允许本文所附接口清单中的 GET 路径，不允许任意URL、原文件下载或服务启停。

- `/v1/workspaces`：已有工作空间。合成测试空间默认不显示。
- `/v1/workspaces/{w}/board?limit=30`：阶段、里程碑与固定文件修订。跟进 next_before，不把首屏当全量。stages_truncated 为 true 时另用 stages 列表分页读取。
- `/v1/workspaces/{w}/{collection}/{id}?version=N`：确切登记与历史，collection 见下方。
- `/v1/workspaces/{w}/artifacts/{id}/inspect?version=N`：核对原件存在和指纹；board 不自动读磁盘。
- `/v1/workspaces/{w}/artifacts/{id}/preview?version=N`：有界MD/DOCX纯文字。不是Word批注、修订、图表或完整格式审查。
- `/v1/search?q=...`：仅查询已登记元数据与来源快照，不是全盘全文搜索。

## 登记与更新

调用 `workbench_publish_project`，传入 collection、workspace_id 和 payload 对象，DSH 工具还需 project_dir。项目凭证支持集合：refresh、artifacts、stages、versions、feedback、plans、tasks、records、canvases。工作空间的登记与根目录修改由用户在管理界面完成，项目凭证不能执行。source 由 refresh 产生，不能任意直接写入。

公共外壳：

```json
{
  "schema_version": 1,
  "operation_key": "一次逻辑操作的稳定唯一编号",
  "expected_version": 0,
  "item": {
    "id": "业务对象稳定ID",
    "kind": "stage",
    "title": "阶段名",
    "archived": false,
    "data": {
      "status": "unknown",
      "date": null,
      "summary": "只写有依据的声明，并说明未知",
      "refs": [{"id": "已登记的文件ID", "kind": "artifact", "version": 1, "role": "source"}]
    }
  }
}
```

这是结构说明，示例中的中文占位ID必须换成满足契约的真实ID；来源文件须先登记。完整字段参见随包的 API 文档。

- 新建 expected_version=0；更新先读当前登记，用返回的version，并带回需要保留的完整data。409时重新读取并理解冲突，不盲目把版本号加一。
- refs 固定到确切修订。不传version时后端会在事务内固定当时当前版本；重现历史时应明确指定。一个里程碑对同一artifact ID只能有一个artifact引用。
- 阶段kind=stage；版本kind=version；通过role=stage关联，不另存一份冲突的反向版本列表。一个阶段可以有多个里程碑，阶段产出标记有唯一性保护。
- occurred_on/date未知就null；不拿文件mtime、采集日期或文件名猜业务发生日期。planned与recorded明确分开。
- changes按文件绑定artifact_id/artifact_version，kind为semantic/format/mixed；用户note原样保留。source=user不是人工认证。
- 文件存在、文件已生成、意见已处理、导师认可、论文投稿、工作台已接收是不同事实。分别说明依据与核对范围，不把文件数换算成总体进度。
- 用户停用的来源不能再次推导当前任务；旧看板等不得因为仍存在就恢复权威。当前通用来源有效状态与整批检查点仍未正式实现，需要由Agent在明确来源上保守整理。

项目凭证不能使用全局 `workbench_publish_discovery`、home 或 changes；工具名保留兼容但会被拒绝。项目交付使用 records/artifacts 等已有归属的集合。不要为绕过 403 读取管理 Token。不要伪造主会话，导入/整理会话不冒充原作者工作会话。

## 超时、回执与恢复

工具会同键重试、查询回执并读回确切修订。只有 ok=true 且 result.readback_confirmed=true 才表述“工作台已保存并读回”。这不证明页面已显示、用户已阅读或科学结论正确。

操作结果未确认时保留原始payload和operation_key/delivery_key，不改标题、日期、run_id或编号再投。先查 `/v1/project-operations/{operation_key}` 或 `/v1/receipts/{receipt_id}`；处理401/409等明确错误。即使工具失败，也不能声称数据库肯定没有记录。

当前每次写入是单个业务事务；多次工具调用不是整批原子提交。部分记录已保存时明确报告partial，不假称完整检查点。MCP v0.3按项目凭证提供查询和项目可靠写入；重要变化状态写入尚未封装为MCP工具。

## 权限与凭据

管理令牌只供宿主控制使用。MCP 读取项目目录 .workbench/project.json 的凭证引用，从服务数据目录取对应项目秘密，Windows 使用当前用户 DPAPI 解密；绝不回退读取 api-token.txt。Token 不放进模型参数、聊天、URL、日志或仓库。MCP配置只有程序路径、数据目录和项目目录。项目凭证闲置90天或签发满365天失效；403不重试提权，401请用户重新签发。不要让MCP持有另一份数据库。停止后端不删除记录；重新启动端口可能改变，始终读取endpoint发现服务。

DSH的旧V0采集/草稿插件与新版通用工具不同，新版没有偷偷迁移旧草稿或项目策略，也没有迁移现有日常数据库。用户需要旧数据时，按安装文档用一致备份迁入全新目录后再启动。

完整登录与权限契约见 [项目凭证与浏览器登录](api/项目凭证与浏览器登录.md)。只读凭证不能写入；不同项目、根目录、服务身份和回执均由后端/客户端验证。
