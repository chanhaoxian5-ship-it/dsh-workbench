# 安装、运行、接入旧数据与回退

## 1. 安装到DSH

先检查`dsh --version`和`python --version`。当前宿主API验证范围是0.2.1-rc.5；其他版本先做兼容验证，不豁免版本检查。

把公开仓库clone到一个稳定的本地目录。已验证的DSH命令形态是：

```powershell
dsh plugin --profile desktop link '<本插件目录的绝对路径>'
```

这是本地link安装，不要把路径写成整个Workbench工程根目录。插件包自带cordis.patch.yml插入workbench-suite条目；DSH安装组合后，应核对该条目唯一、导入`@chanhaoxian5/dsh-workbench`、客户端导出已列入加载清单。不要给profile另装一份dsh-tools等运行时，也不要修改凭据、模型或定时任务来安装本插件。

操作日常profile前先备份其package.json、cordis.patch.yml、pnpm-lock.yaml及pnpm-workspace.yaml（实际存在的文件）。本次交付没有代替用户改日常profile或重启DSH；提供的是经隔离验证的新包，实际安装组合与加载需在目标环境核对。

## 2. 插件配置

默认值可直接用；只在需要时为该插件条目添加config：

```yaml
config:
  dataDir: 'C:\Users\你的用户名\.dsh\storages\workbench'
  pythonPath: 'python'
  preferredPort: 0
  autoStart: false
```

dataDir必须是绝对路径。preferredPort=0表示插件自行在49152–65535中选取；明确指定也必须在高位范围，占用时自动换候选。实际地址以设置页和endpoint.json为准，不用扫描端口。多个DSH实例指向同一dataDir时，跨进程文件锁保证只有一份后端。不同目录则是不同资料库。

重启DSH使新插件加载，在「设置 → Workbench 工作台」点击启动。设置页通过DSH原生Connection调用宿主Remote服务，不依赖另一个临时管理网页或额外端口。

后端进程独立存活，升级或移除插件前可在这里先停止。控制器只向验证过身份的实例发送认证停止请求，不按磁盘里的PID杀进程；身份无法确认时明确报错，不误杀其他服务。

也可在插件目录用`./scripts/service.ps1 -Action start|stop|restart|status`，使用相同dataDir。CLI不修改任何DSHprofile。

## 3. 现有Workbench数据库

新目录初次启动为空库，**不是删除了旧记录**。本插件不猜测或自动迁移旧数据库，也不把原有8765服务与新插件服务混作同一实例。

需要延续旧记录时，先确定旧库绝对路径和新的、尚未启动的数据目录。用旧Workbench维护工具进行SQLite一致备份，再恢复到全新目录；不要只复制运行中的sqlite3主文件。原工程示意：

```powershell
./scripts/maintain-backend.ps1 -Action backup -Source '<旧库.sqlite3>' -Destination '<新的备份.sqlite3>'
./scripts/maintain-backend.ps1 -Action restore -Source '<新的备份.sqlite3>' -Destination '<全新插件数据目录>'
```

随后把插件dataDir设为该新目录，再启动；新服务会生成自己的令牌和endpoint.json。不要复制旧令牌，不把同一数据库同时交给不同代码版本读写。核对空间/资料数、修订和回执后再切换日常使用；旧原件路径保持不动。

## 4. 其他Agent的MCP

先从设置页打开工作台，在网页顶部“项目访问权限”选择已登记项目，生成并写入该项目连接配置。再回设置页填写该项目绝对目录，点击「显示此项目的 MCP 配置」，复制到目标Agent允许的MCP配置位置。不同客户端可能只接受其中的server对象；以该客户端的格式为准。

```json
{
  "mcpServers": {
    "workbench": {
      "command": "python",
      "args": ["C:/path/to/dsh-workbench/scripts/mcp.py", "--data-dir", "C:/Users/you/.dsh/storages/workbench", "--project-dir", "D:/Projects/你的项目"]
    }
  }
}
```

所有路径换成实际绝对路径；必要时command用Python解释器完整路径。stdio不需要URL、端口或令牌。每次工具调用读取endpoint并验证实例，后端重启换端口无需改MCP配置。MCP进程退出不会关闭共享后端。

MCP 只使用该项目凭证，按只读/读写权限访问一个工作区；项目配置不含秘密。Windows 下本机秘密由当前用户 DPAPI 加密。DSH 工具每次传 project_dir；未配置不会读取全局管理 Token。完整期限、撤销、目录与接口见[登录与项目凭证](api/项目凭证与浏览器登录.md)。

## 5. 更新与卸载

0.3.0 启用持久浏览器登录与项目凭证。先停止旧后端，再替换/更新插件源码并重载DSH；确认启动的是新版本。旧 MCP 配置要新增 --project-dir，并先由用户签发项目连接配置。旧项目记录无需迁移；新建 auth.sqlite3 与 credentials，保留现有管理令牌供宿主控制使用。数据保留在独立目录，不被build、升级或插件卸载清除。

回退时停止新后端、恢复原profile配置或移除该插件条目，按原方式启动旧服务。保留操作前数据库一致备份；不自动把新写入倒灌旧库。移除插件与删除用户数据是不同动作，本包没有删除资料库的按钮。
