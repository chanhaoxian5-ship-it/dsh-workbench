# Workbench：给 Agent 的使用建议

你操作的是用户电脑上的本地工作台，保存项目元数据、文件引用、修订和回执，不是原文件编辑器或全局聊天系统。DSH 工具与 MCP 使用同一后端和数据库。

## 先连接与确认范围

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

调用 `workbench_publish_project`，传入 collection、workspace_id（登记工作空间时可省略）和 payload 对象。集合：workspaces、refresh、artifacts、stages、versions、feedback、plans、tasks、records、canvases。source 由 refresh 产生，不能任意直接写入。

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

发现交付使用 `workbench_publish_discovery`，保留 excerpt 与 interpretation 的区别、完整 source、实际 producer 和核验声明。不要伪造主会话，导入/整理会话不冒充原作者工作会话。

## 超时、回执与恢复

工具会同键重试、查询回执并读回确切修订。只有 ok=true 且 result.readback_confirmed=true 才表述“工作台已保存并读回”。这不证明页面已显示、用户已阅读或科学结论正确。

操作结果未确认时保留原始payload和operation_key/delivery_key，不改标题、日期、run_id或编号再投。先查 `/v1/project-operations/{operation_key}`、`/v1/deliveries/{delivery_key}` 或 `/v1/receipts/{receipt_id}`；处理401/409等明确错误。即使工具失败，也不能声称数据库肯定没有记录。

当前每次写入是单个业务事务；多次工具调用不是整批原子提交。部分记录已保存时明确报告partial，不假称完整检查点。MCP v0.2提供查询和项目/发现可靠写入；重要变化状态写入尚未封装为MCP工具。

## 权限与凭据

令牌由插件和MCP在本机读取，不放进模型参数、聊天、URL、日志或仓库。MCP配置只有程序路径和数据目录。不要让MCP持有另一份数据库。停止后端不删除记录；重新启动端口可能改变，始终读取endpoint发现服务。

DSH的旧V0采集/草稿插件与新版通用工具不同，新版没有偷偷迁移旧草稿或项目策略，也没有迁移现有日常数据库。用户需要旧数据时，按安装文档用一致备份迁入全新目录后再启动。
