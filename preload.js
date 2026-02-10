/**
 * uTools 定时任务插件 - Preload 脚本
 *
 * 功能：
 * 1. Storage：数据持久化管理
 * 2. CommandRunner：跨平台命令执行
 * 3. Scheduler：任务调度管理
 */

// ==================== 依赖引入 ====================

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// cron-parser 用于解析 cron 表达式
// npm install cron-parser
let cronParser;
try {
  cronParser = require('cron-parser');
} catch (e) {
  console.warn('[ScheduledTask] cron-parser not installed, cron features limited');
}

// ==================== 常量定义 ====================

const DB_KEYS = {
  TASKS: 'scheduled_tasks_tasks',
  HISTORY: 'scheduled_tasks_history',
  CONFIG: 'scheduled_tasks_config',
};

const DEFAULT_CONFIG = {
  maxHistoryItems: 500,
  maxOutputLength: 10000, // 单个输出最大字符数
  enableLogging: true,
};

const INTERVAL_MAP = {
  '1m': 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

// ==================== Storage 模块 ====================

class Storage {
  /**
   * 获取所有任务
   */
  static async getTasks() {
    try {
      const data = await utools.dbStorage.getItem(DB_KEYS.TASKS);
      return data || [];
    } catch (error) {
      console.error('Failed to get tasks:', error);
      return [];
    }
  }

  /**
   * 保存所有任务
   */
  static async saveTasks(tasks) {
    try {
      await utools.dbStorage.setItem(DB_KEYS.TASKS, tasks);
      return true;
    } catch (error) {
      console.error('Failed to save tasks:', error);
      return false;
    }
  }

  /**
   * 获取单个任务
   */
  static async getTask(taskId) {
    const tasks = await this.getTasks();
    return tasks.find(t => t.id === taskId);
  }

  /**
   * 添加任务
   */
  static async addTask(task) {
    const tasks = await this.getTasks();
    const newTask = {
      id: this.generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      enabled: true,
      ...task,
    };
    tasks.push(newTask);
    await this.saveTasks(tasks);
    return newTask;
  }

  /**
   * 更新任务
   */
  static async updateTask(taskId, updates) {
    const tasks = await this.getTasks();
    const index = tasks.findIndex(t => t.id === taskId);
    if (index === -1) return null;

    tasks[index] = {
      ...tasks[index],
      ...updates,
      id: taskId, // 确保 ID 不被覆盖
      updatedAt: Date.now(),
    };

    await this.saveTasks(tasks);
    return tasks[index];
  }

  /**
   * 删除任务
   */
  static async deleteTask(taskId) {
    const tasks = await this.getTasks();
    const filtered = tasks.filter(t => t.id !== taskId);
    if (filtered.length === tasks.length) return false;
    await this.saveTasks(filtered);
    return true;
  }

  /**
   * 获取执行历史
   */
  static async getHistory() {
    try {
      const data = await utools.dbStorage.getItem(DB_KEYS.HISTORY);
      return data || [];
    } catch (error) {
      console.error('Failed to get history:', error);
      return [];
    }
  }

  /**
   * 添加历史记录
   */
  static async addHistoryItem(item) {
    const history = await this.getHistory();
    const newItem = {
      id: this.generateId(),
      ...item,
    };

    // 添加到开头
    history.unshift(newItem);

    // 限制历史记录数量
    const config = await this.getConfig();
    const maxItems = config?.maxHistoryItems || DEFAULT_CONFIG.maxHistoryItems;

    if (history.length > maxItems) {
      history.splice(maxItems);
    }

    await utools.dbStorage.setItem(DB_KEYS.HISTORY, history);
    return newItem;
  }

  /**
   * 清空历史
   */
  static async clearHistory() {
    await utools.dbStorage.setItem(DB_KEYS.HISTORY, []);
  }

  /**
   * 获取配置
   */
  static async getConfig() {
    try {
      const config = await utools.dbStorage.getItem(DB_KEYS.CONFIG);
      return { ...DEFAULT_CONFIG, ...config };
    } catch (error) {
      return DEFAULT_CONFIG;
    }
  }

  /**
   * 更新配置
   */
  static async updateConfig(updates) {
    const config = await this.getConfig();
    const newConfig = { ...config, ...updates };
    await utools.dbStorage.setItem(DB_KEYS.CONFIG, newConfig);
    return newConfig;
  }

  /**
   * 生成唯一 ID
   */
  static generateId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ==================== CommandRunner 模块 ====================

class CommandRunner {
  /**
   * 执行命令
   */
  static async execute(command) {
    const startTime = Date.now();
    let platform;
    let shellCommand;

    // 根据平台选择 shell
    if (utools.isWindows()) {
      platform = 'windows';
      shellCommand = `cmd.exe /c "${command.replace(/"/g, '\\"')}"`;
    } else if (utools.isLinux()) {
      platform = 'linux';
      shellCommand = `bash -c "${command.replace(/"/g, '\\"')}"`;
    } else if (utools.isMacOS()) {
      platform = 'macos';
      shellCommand = `bash -c "${command.replace(/"/g, '\\"')}"`;
    } else {
      throw new Error('Unsupported platform');
    }

    try {
      const { stdout, stderr } = await execAsync(shellCommand, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10, // 10MB
        timeout: 5 * 60 * 1000, // 5分钟超时
      });

      const duration = Date.now() - startTime;
      const config = await Storage.getConfig();
      const maxLength = config?.maxOutputLength || DEFAULT_CONFIG.maxOutputLength;

      return {
        success: true,
        exitCode: 0,
        stdout: this.truncateOutput(stdout, maxLength),
        stderr: this.truncateOutput(stderr, maxLength),
        duration,
        platform,
        truncated: stdout.length > maxLength || stderr.length > maxLength,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const config = await Storage.getConfig();
      const maxLength = config?.maxOutputLength || DEFAULT_CONFIG.maxOutputLength;

      return {
        success: false,
        exitCode: error.code || 1,
        stdout: this.truncateOutput(error.stdout || '', maxLength),
        stderr: this.truncateOutput(error.stderr || error.message || '', maxLength),
        duration,
        platform,
        truncated: (error.stdout?.length || 0) > maxLength || (error.stderr?.length || 0) > maxLength,
      };
    }
  }

  /**
   * 截断输出
   */
  static truncateOutput(output, maxLength) {
    if (!output || output.length <= maxLength) return output || '';
    return output.substring(0, maxLength) + '\n\n... (output truncated)';
  }
}

// ==================== Scheduler 模块 ====================

class Scheduler {
  constructor() {
    this.timers = new Map(); // taskId -> timer
    this.running = false;
  }

  /**
   * 启动调度器
   */
  async start() {
    if (this.running) return;

    this.running = true;
    console.log('[Scheduler] Starting scheduler...');

    // 恢复所有启用的任务
    const tasks = await Storage.getTasks();
    for (const task of tasks) {
      if (task.enabled) {
        this.scheduleTask(task);
      }
    }

    console.log(`[Scheduler] Started, ${this.timers.size} tasks scheduled`);
  }

  /**
   * 停止调度器
   */
  stop() {
    console.log('[Scheduler] Stopping scheduler...');

    // 清除所有定时器
    for (const [taskId, timer] of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }

    this.timers.clear();
    this.running = false;

    console.log('[Scheduler] Stopped');
  }

  /**
   * 调度单个任务
   */
  scheduleTask(task) {
    // 如果已有定时器，先清除
    if (this.timers.has(task.id)) {
      clearTimeout(this.timers.get(task.id));
      this.timers.delete(task.id);
    }

    if (!task.enabled) return;

    let delay;
    let timer;

    switch (task.type) {
      case 'interval':
        delay = this.calculateIntervalDelay(task.intervalValue);
        // 使用递归 setTimeout 实现间隔执行
        timer = setTimeout(() => {
          this.executeTask(task);
          // 执行完成后重新调度
          if (task.enabled) {
            this.scheduleTask(task);
          }
        }, delay);
        break;

      case 'daily':
        delay = this.calculateDailyDelay(task.dailyTime);
        timer = setTimeout(() => {
          this.executeTask(task);
          // 执行完成后调度明天
          if (task.enabled) {
            this.scheduleTask(task);
          }
        }, delay);
        break;

      case 'cron':
        delay = this.calculateCronDelay(task.cronExpression);
        if (delay === null) {
          console.error(`[Scheduler] Invalid cron expression: ${task.cronExpression}`);
          return;
        }
        timer = setTimeout(() => {
          this.executeTask(task);
          // 执行完成后重新计算下次执行时间
          if (task.enabled) {
            this.scheduleTask(task);
          }
        }, delay);
        break;
    }

    if (timer) {
      this.timers.set(task.id, timer);

      // 记录下次执行时间
      const nextExecutionAt = Date.now() + delay;
      Storage.updateTask(task.id, { nextExecutionAt });
    }
  }

  /**
   * 取消任务调度
   */
  unscheduleTask(taskId) {
    if (this.timers.has(taskId)) {
      clearTimeout(this.timers.get(taskId));
      this.timers.delete(taskId);
      console.log(`[Scheduler] Unscheduled task: ${taskId}`);
    }
  }

  /**
   * 立即执行任务
   */
  async executeTask(task) {
    console.log(`[Scheduler] Executing task: ${task.id}`);

    const startTime = Date.now();

    try {
      const result = await CommandRunner.execute(task.command);

      // 保存历史记录
      const historyItem = {
        taskId: task.id,
        taskName: task.name,
        command: task.command,
        executedAt: startTime,
        status: result.success ? 'success' : 'failure',
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: result.duration,
        outputTruncated: result.truncated,
      };

      await Storage.addHistoryItem(historyItem);

      // 更新任务的最后执行时间
      await Storage.updateTask(task.id, {
        lastExecutedAt: startTime,
      });

      // 通知 UI 更新
      this.notifyUI('taskExecuted', { taskId: task.id, result });

      console.log(`[Scheduler] Task executed: ${task.id}, status: ${result.success ? 'success' : 'failure'}`);
    } catch (error) {
      console.error(`[Scheduler] Task execution error: ${task.id}`, error);

      // 记录错误历史
      await Storage.addHistoryItem({
        taskId: task.id,
        taskName: task.name,
        command: task.command,
        executedAt: startTime,
        status: 'failure',
        exitCode: -1,
        stdout: '',
        stderr: error.message,
        duration: Date.now() - startTime,
        outputTruncated: false,
      });
    }
  }

  /**
   * 重新加载所有任务
   */
  async reload() {
    this.stop();
    await this.start();
  }

  /**
   * 计算 interval 延迟
   */
  calculateIntervalDelay(intervalValue) {
    return INTERVAL_MAP[intervalValue] || INTERVAL_MAP['1m'];
  }

  /**
   * 计算 daily 延迟
   */
  calculateDailyDelay(dailyTime) {
    if (!dailyTime || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(dailyTime)) {
      console.error(`[Scheduler] Invalid daily time format: ${dailyTime}`);
      return 24 * 60 * 60 * 1000; // 默认 24 小时
    }

    const [hours, minutes] = dailyTime.split(':').map(Number);
    const now = new Date();
    const target = new Date();

    target.setHours(hours, minutes, 0, 0);

    // 如果今天的时间已过，设置为明天
    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    return target.getTime() - now.getTime();
  }

  /**
   * 计算 cron 延迟
   * 使用 cron-parser 库解析完整的 cron 表达式
   */
  calculateCronDelay(cronExpression) {
    if (!cronParser) {
      console.error('[Scheduler] cron-parser not installed, cannot parse cron expression');
      return null;
    }

    try {
      const interval = cronParser.parseExpression(cronExpression, {
        currentDate: new Date(),
        tz: 'local',
      });

      // 获取下次执行时间
      const nextExecution = interval.next();
      const delay = nextExecution.getTime() - Date.now();

      console.log(`[Scheduler] Cron "${cronExpression}" next execution: ${nextExecution.toString()}`);

      return delay;
    } catch (error) {
      console.error(`[Scheduler] Invalid cron expression: ${cronExpression}`, error.message);
      return null;
    }
  }

  /**
   * 通知 UI 更新
   */
  notifyUI(event, data) {
    // 通过 uTools 的广播机制通知 UI
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('scheduler-update', { detail: { event, data } }));
    }
  }
}

// ==================== 导出 API ====================

const scheduler = new Scheduler();

// 暴露给 UI 的 API
window.ScheduledTaskAPI = {
  // 任务管理
  getTasks: () => Storage.getTasks(),
  addTask: (task) => Storage.addTask(task),
  updateTask: (taskId, updates) => Storage.updateTask(taskId, updates),
  deleteTask: (taskId) => Storage.deleteTask(taskId),

  // 历史管理
  getHistory: () => Storage.getHistory(),
  clearHistory: () => Storage.clearHistory(),

  // 配置管理
  getConfig: () => Storage.getConfig(),
  updateConfig: (updates) => Storage.updateConfig(updates),

  // 调度器控制
  startScheduler: () => scheduler.start(),
  stopScheduler: () => scheduler.stop(),
  reloadScheduler: () => scheduler.reload(),
  executeTaskNow: (task) => scheduler.executeTask(task),

  // 工具方法
  isWindows: () => utools.isWindows(),
  isLinux: () => utools.isLinux(),
  isMacOS: () => utools.isMacOS(),
};

// ==================== 后台运行状态管理 ====================

const BG_STATE_KEY = 'scheduled_tasks_bg_state';

/**
 * 保存后台运行状态
 */
async function saveBgState(state) {
  try {
    await utools.dbStorage.setItem(BG_STATE_KEY, {
      ...state,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('[ScheduledTask] Failed to save bg state:', error);
  }
}

/**
 * 获取后台运行状态
 */
async function getBgState() {
  try {
    return await utools.dbStorage.getItem(BG_STATE_KEY);
  } catch (error) {
    console.error('[ScheduledTask] Failed to get bg state:', error);
    return null;
  }
}

// ==================== 生命周期钩子 ====================

// uTools 插件进入时启动调度器
utools.onPluginEnter(async ({ code }) => {
  console.log('[ScheduledTask] Plugin entered, feature code:', code);

  // 如果是后台服务启动，或者调度器还未运行，则启动
  if (!scheduler.running) {
    await scheduler.start();
    await saveBgState({ running: true, startedAt: Date.now() });
    console.log('[ScheduledTask] Scheduler started in background');
  } else {
    console.log('[ScheduledTask] Scheduler already running');
  }
});

// uTools 插件退出时不再停止调度器，让它在后台继续运行
utools.onPluginOut(async () => {
  console.log('[ScheduledTask] Plugin exiting, keeping scheduler running in background');

  // 保存状态，标记调度器仍在后台运行
  await saveBgState({
    running: scheduler.running,
    taskCount: scheduler.timers.size,
    backgroundMode: true,
  });

  // 不再调用 scheduler.stop()，让定时任务在后台继续执行
  // scheduler.stop(); // <-- 已移除
});

console.log('[ScheduledTask] Preload script loaded');
