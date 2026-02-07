# uTools 定时任务插件

一个功能完整的 uTools 定时任务管理插件，支持多种定时配置和跨平台命令执行。

## 功能特性

- **多种定时方式**
  - 固定间隔：1分钟、15分钟、30分钟、1小时
  - 每天固定时间：指定 HH:mm 执行
  - 自定义 Cron 表达式：灵活的调度配置

- **跨平台支持**
  - Windows: 使用 `cmd.exe /c` 执行命令
  - Linux: 使用 `bash -c` 执行命令
  - macOS: 使用 `bash -c` 执行命令

- **任务管理**
  - 新增、编辑、删除任务
  - 启用/禁用任务
  - 手动立即执行任务
  - 查看下次执行时间

- **执行历史**
  - 记录每次执行的详细信息
  - 捕获 stdout 和 stderr
  - 显示退出码和执行耗时
  - 输出截断防止存储过大

## 项目结构

```
utools-scheduled-task/
├── plugin.json       # uTools 插件配置
├── preload.js        # 预加载脚本（核心逻辑）
├── index.html        # 主页面
├── app.js            # 前端脚本
├── package.json      # NPM 依赖配置
└── README.md         # 项目文档
```

## 安装依赖

```bash
npm install
```

### 主要依赖

- **cron-parser** (可选): Cron 表达式解析库

```bash
npm install cron-parser
```

## 数据结构

### Task（任务）

```javascript
{
  id: "task_1234567890_abc123",
  name: "备份任务",
  type: "interval",  // "interval" | "daily" | "cron"
  intervalValue: "1h",  // type=interval 时使用
  dailyTime: "09:00",   // type=daily 时使用
  cronExpression: "0 9 * * *",  // type=cron 时使用
  command: "rsync -av /data /backup",
  enabled: true,
  createdAt: 1704067200000,
  updatedAt: 1704067200000,
  lastExecutedAt: 1704067200000,
  nextExecutionAt: 1704070800000
}
```

### HistoryItem（执行历史）

```javascript
{
  id: "task_1234567890_def456",
  taskId: "task_1234567890_abc123",
  taskName: "备份任务",
  command: "rsync -av /data /backup",
  executedAt: 1704067200000,
  status: "success",  // "success" | "failure"
  exitCode: 0,
  stdout: "sending incremental file list...",
  stderr: "",
  duration: 2345,
  outputTruncated: false
}
```

### dbStorage Key 设计

- `scheduled_tasks_tasks`: 存储任务列表 `Array<Task>`
- `scheduled_tasks_history`: 存储执行历史 `Array<HistoryItem>`
- `scheduled_tasks_config`: 存储全局配置 `Config`

## 架构设计

### 整体流程

```
用户配置 UI → 保存到 dbStorage → Scheduler 读取并调度
                                ↓
                         CommandRunner 执行
                                ↓
                      捕获结果并保存历史 → 通知 UI 更新
```

### 核心模块

#### 1. Storage 模块

负责数据持久化，使用 uTools 的 `dbStorage` API。

- `getTasks()`: 获取所有任务
- `addTask(task)`: 添加新任务
- `updateTask(taskId, updates)`: 更新任务
- `deleteTask(taskId)`: 删除任务
- `getHistory()`: 获取执行历史
- `addHistoryItem(item)`: 添加历史记录

#### 2. CommandRunner 模块

负责跨平台命令执行。

- 平台检测：`utools.isWindows()` / `isLinux()` / `isMacOS()`
- Shell 选择：
  - Windows: `cmd.exe /c "command"`
  - Linux/Mac: `bash -c "command"`
- 输出截断：防止历史记录过大

#### 3. Scheduler 模块

负责任务调度管理。

- **interval 类型**: 使用递归 `setTimeout` 实现固定间隔
- **daily 类型**: 计算时间差，每日定时执行
- **cron 类型**: 解析 cron 表达式，计算下次执行时间
- **恢复机制**: uTools 重启后自动恢复启用的任务

## 跨平台 Shell 说明

| 平台 | Shell 命令 | 说明 |
|------|-----------|------|
| Windows | `cmd.exe /c "command"` | 使用 Windows 命令提示符 |
| Linux | `bash -c "command"` | 使用 Bash shell |
| macOS | `bash -c "command"` | 使用 Bash shell |

### 命令示例

**Windows:**
```bash
dir C:\
ipconfig /all
tasklist
```

**Linux/Mac:**
```bash
ls -la /home
ps aux
df -h
```

## 使用示例

### 1. 添加间隔任务

每 15 分钟执行一次健康检查：

```javascript
{
  name: "服务健康检查",
  type: "interval",
  intervalValue: "15m",
  command: "curl -f http://localhost:3000/health || echo 'Service down'",
  enabled: true
}
```

### 2. 添加每日任务

每天早上 9 点备份数据库：

```javascript
{
  name: "数据库备份",
  type: "daily",
  dailyTime: "09:00",
  command: "mysqldump -u root -p123456 mydb > /backup/db_$(date +%Y%m%d).sql",
  enabled: true
}
```

### 3. 添加 Cron 任务

每周一凌晨 2 点执行清理：

```javascript
{
  name: "日志清理",
  type: "cron",
  cronExpression: "0 2 * * 1",
  command: "find /var/log -name '*.log' -mtime +30 -delete",
  enabled: true
}
```

## Cron 表达式格式

```
* * * * *
│ │ │ │ │
│ │ │ │ └─ 周几 (0-6, 0=周日)
│ │ │ └─── 月份 (1-12)
│ │ └───── 日期 (1-31)
│ └─────── 小时 (0-23)
└───────── 分钟 (0-59)
```

### 示例

- `0 9 * * *` - 每天 9:00
- `0 */2 * * *` - 每 2 小时
- `0 0 * * 0` - 每周日 00:00
- `0 0 1 * *` - 每月 1 号 00:00

## 注意事项

### 1. 命令安全

- **不要**执行未经验证的第三方命令
- 小心处理路径中的空格和特殊字符
- 避免在命令中明文存储敏感信息（密码、密钥等）

### 2. 输出截断

为了防止历史记录过大，已实现以下机制：

- 默认最大输出长度：10,000 字符
- 超出部分会被截断并标记 `outputTruncated: true`
- 可在全局配置中调整最大长度

### 3. 定时恢复

- uTools 启动时自动恢复启用的任务
- 调度器使用递归 `setTimeout`，不会产生漂移
- 任务更新后会重新计算调度时间

### 4. 错误处理

- 所有命令执行都有错误捕获
- 退出码 ≠ 0 会被记录为失败状态
- stderr 会被单独记录便于排查问题

## 开发和调试

### 启用 uTools 开发者模式

1. 打开 uTools
2. 设置 → 开发者模式 → 开启
3. 点击"安装插件" → 选择本项目的 `plugin.json`

### 调试日志

打开浏览器开发者工具（F12）查看控制台日志：

```
[ScheduledTask] Plugin entered
[Scheduler] Starting scheduler...
[Scheduler] Started, 2 tasks scheduled
```

### 调试配置

在 `preload.js` 中修改 `DEFAULT_CONFIG`：

```javascript
const DEFAULT_CONFIG = {
  maxHistoryItems: 500,        // 历史记录最大数量
  maxOutputLength: 10000,      // 单次输出最大字符数
  enableLogging: true,         // 是否启用日志
};
```

## 已知问题

1. **Cron 解析**: 当前使用简化版 cron 解析，生产环境建议使用 `cron-parser` 库
2. **长时间执行**: 命令执行超时设置为 5 分钟，可能不适用于所有场景
3. **并发限制**: 没有限制并发任务数量，大量任务同时执行可能影响性能

## 后续改进

- [ ] 集成完整的 `cron-parser` 库
- [ ] 支持任务执行失败后的重试机制
- [ ] 添加任务执行通知（桌面通知）
- [ ] 支持任务执行前的确认提示
- [ ] 添加任务导入/导出功能
- [ ] 支持环境变量配置
- [ ] 添加执行统计图表

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
