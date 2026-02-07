/**
 * uTools 定时任务插件 - 前端脚本
 */

// ==================== API 封装 ====================

const API = window.ScheduledTaskAPI;

if (!API) {
  alert('插件初始化失败，请确保 preload.js 已正确加载');
  throw new Error('ScheduledTaskAPI not found');
}

// ==================== 状态管理 ====================

let state = {
  tasks: [],
  history: [],
  config: {},
};

// ==================== 工具函数 ====================

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

function getScheduleLabel(task) {
  switch (task.type) {
    case 'interval':
      const labels = { '1m': '1分钟', '15m': '15分钟', '30m': '30分钟', '1h': '1小时' };
      return labels[task.intervalValue] || task.intervalValue;
    case 'daily':
      return `每天 ${task.dailyTime}`;
    case 'cron':
      return `Cron: ${task.cronExpression}`;
    default:
      return '未知';
  }
}

function getTagClass(type) {
  return `tag-${type}`;
}

// ==================== 数据加载 ====================

async function loadData() {
  try {
    state.tasks = await API.getTasks();
    state.history = await API.getHistory();
    state.config = await API.getConfig();

    renderTasks();
    renderHistory();
  } catch (error) {
    console.error('Failed to load data:', error);
    showError('加载数据失败');
  }
}

// ==================== 渲染函数 ====================

function renderTasks() {
  const container = document.getElementById('taskList');
  const countEl = document.getElementById('taskCount');

  countEl.textContent = `${state.tasks.length} 个任务`;

  if (state.tasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p>暂无任务，点击上方"新增任务"按钮添加</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.tasks.map(task => `
    <li class="task-item ${!task.enabled ? 'disabled' : ''}">
      <div class="task-status ${task.enabled ? 'enabled' : 'disabled'}"></div>
      <div class="task-info">
        <div class="task-name">
          ${task.name || '未命名任务'}
          <span class="tag ${getTagClass(task.type)}">${getScheduleLabel(task)}</span>
        </div>
        <div class="task-detail">
          命令: ${escapeHtml(task.command)}
          ${task.nextExecutionAt ? ` | 下次执行: ${formatTimestamp(task.nextExecutionAt)}` : ''}
          ${task.lastExecutedAt ? ` | 上次执行: ${formatTimestamp(task.lastExecutedAt)}` : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="btn btn-default btn-sm" onclick="executeTaskNow('${task.id}')" title="立即执行">
          ▶
        </button>
        <button class="btn btn-default btn-sm" onclick="editTask('${task.id}')" title="编辑">
          ✎
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')" title="删除">
          ✕
        </button>
      </div>
    </li>
  `).join('');
}

function renderHistory() {
  const container = document.getElementById('historyList');

  if (state.history.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📜</div>
        <p>暂无执行历史</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.history.map(item => `
    <li class="history-item" onclick="showHistoryDetail('${item.id}')">
      <div class="history-header">
        <div>
          <span class="history-status ${item.status}">${item.status === 'success' ? '成功' : '失败'}</span>
          <span style="font-size: 12px; color: #666;">${item.taskName || '未知任务'}</span>
        </div>
        <div class="history-time">${formatTimestamp(item.executedAt)}</div>
      </div>
      <div class="history-command">${escapeHtml(item.command)}</div>
      <div style="font-size: 12px; color: #999; margin-top: 4px;">
        退出码: ${item.exitCode} | 耗时: ${formatDuration(item.duration)}
        ${item.outputTruncated ? ' | 输出已截断' : ''}
      </div>
    </li>
  `).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// ==================== 任务管理 ====================

function showAddTaskModal() {
  document.getElementById('taskModalTitle').textContent = '新增任务';
  document.getElementById('taskForm').reset();
  document.getElementById('taskId').value = '';
  document.getElementById('taskEnabled').checked = true;
  document.getElementById('taskType').value = 'interval';
  document.getElementById('intervalValue').value = '1m';
  document.getElementById('dailyTime').value = '09:00';

  onTypeChange();
  document.getElementById('taskModal').classList.add('active');
}

function editTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) {
    showError('任务不存在');
    return;
  }

  document.getElementById('taskModalTitle').textContent = '编辑任务';
  document.getElementById('taskId').value = task.id;
  document.getElementById('taskName').value = task.name || '';
  document.getElementById('taskType').value = task.type;
  document.getElementById('taskCommand').value = task.command;
  document.getElementById('taskEnabled').checked = task.enabled;

  if (task.type === 'interval') {
    document.getElementById('intervalValue').value = task.intervalValue || '1m';
  } else if (task.type === 'daily') {
    document.getElementById('dailyTime').value = task.dailyTime || '09:00';
  } else if (task.type === 'cron') {
    document.getElementById('cronExpression').value = task.cronExpression || '';
  }

  onTypeChange();
  document.getElementById('taskModal').classList.add('active');
}

async function saveTask() {
  const taskId = document.getElementById('taskId').value;
  const type = document.getElementById('taskType').value;
  const command = document.getElementById('taskCommand').value.trim();

  // 验证
  if (!command) {
    showError('请输入执行命令');
    return;
  }

  const taskData = {
    name: document.getElementById('taskName').value.trim() || undefined,
    type,
    command,
    enabled: document.getElementById('taskEnabled').checked,
  };

  // 根据类型添加特定字段
  if (type === 'interval') {
    taskData.intervalValue = document.getElementById('intervalValue').value;
  } else if (type === 'daily') {
    const dailyTime = document.getElementById('dailyTime').value;
    if (!dailyTime) {
      showError('请选择执行时间');
      return;
    }
    taskData.dailyTime = dailyTime;
  } else if (type === 'cron') {
    const cronExpression = document.getElementById('cronExpression').value.trim();
    if (!cronExpression) {
      showError('请输入 Cron 表达式');
      return;
    }
    taskData.cronExpression = cronExpression;
  }

  try {
    if (taskId) {
      await API.updateTask(taskId, taskData);
      showSuccess('任务更新成功');
    } else {
      await API.addTask(taskData);
      showSuccess('任务添加成功');
    }

    closeTaskModal();
    await loadData();
    await API.reloadScheduler();
  } catch (error) {
    console.error('Failed to save task:', error);
    showError('保存任务失败');
  }
}

async function deleteTask(taskId) {
  try {
    await API.deleteTask(taskId);
    showToast('任务删除成功', 'success');
    await loadData();
    await API.reloadScheduler();
  } catch (error) {
    console.error('Failed to delete task:', error);
    showToast('删除任务失败', 'error');
  }
}

async function executeTaskNow(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) {
    showError('任务不存在');
    return;
  }

  try {
    await API.executeTaskNow(task);
    showSuccess('任务已发送执行请求');
  } catch (error) {
    console.error('Failed to execute task:', error);
    showError('执行任务失败');
  }
}

function closeTaskModal() {
  document.getElementById('taskModal').classList.remove('active');
}

function onTypeChange() {
  const type = document.getElementById('taskType').value;

  document.getElementById('intervalOptions').classList.add('hidden');
  document.getElementById('dailyOptions').classList.add('hidden');
  document.getElementById('cronOptions').classList.add('hidden');

  if (type === 'interval') {
    document.getElementById('intervalOptions').classList.remove('hidden');
  } else if (type === 'daily') {
    document.getElementById('dailyOptions').classList.remove('hidden');
  } else if (type === 'cron') {
    document.getElementById('cronOptions').classList.remove('hidden');
  }
}

// ==================== 历史管理 ====================

function showHistoryDetail(historyId) {
  const item = state.history.find(h => h.id === historyId);
  if (!item) return;

  const body = document.getElementById('historyModalBody');

  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">基本信息</label>
      <div style="padding: 8px; background: #f5f5f5; border-radius: 4px;">
        <div><strong>任务:</strong> ${escapeHtml(item.taskName || '未知')}</div>
        <div><strong>执行时间:</strong> ${formatTimestamp(item.executedAt)}</div>
        <div><strong>状态:</strong> ${item.status === 'success' ? '成功' : '失败'}</div>
        <div><strong>退出码:</strong> ${item.exitCode}</div>
        <div><strong>耗时:</strong> ${formatDuration(item.duration)}</div>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">执行命令</label>
      <div class="output-content">${escapeHtml(item.command)}</div>
    </div>

    <div class="output-section">
      <div class="output-title">标准输出 (stdout)</div>
      <div class="output-content ${!item.stdout ? 'empty' : ''}">${item.stdout ? escapeHtml(item.stdout) : '(空)'}</div>
    </div>

    <div class="output-section">
      <div class="output-title">错误输出 (stderr)</div>
      <div class="output-content ${!item.stderr ? 'empty' : ''}">${item.stderr ? escapeHtml(item.stderr) : '(空)'}</div>
    </div>
  `;

  document.getElementById('historyModal').classList.add('active');
}

function closeHistoryModal() {
  document.getElementById('historyModal').classList.remove('active');
}

async function clearHistory() {
  try {
    await API.clearHistory();
    showToast('历史已清空', 'success');
    await loadData();
  } catch (error) {
    console.error('Failed to clear history:', error);
    showToast('清空历史失败', 'error');
  }
}

// ==================== 通知函数 ====================

function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span class="toast-message">${message}</span>
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function showSuccess(message) {
  showToast(message, 'success');
}

function showError(message) {
  showToast(message, 'error');
}

// ==================== 事件监听 ====================

// 监听调度器更新事件
window.addEventListener('scheduler-update', (event) => {
  const { event: eventType, data } = event.detail;

  if (eventType === 'taskExecuted') {
    // 任务执行后刷新历史
    loadData();
  }
});

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => {
  console.log('[App] Initializing...');

  // 启动调度器
  API.startScheduler().then(() => {
    console.log('[App] Scheduler started');
  });

  // 加载数据
  loadData();

  // 定期刷新数据（每5秒）
  setInterval(() => {
    loadData();
  }, 5000);

  console.log('[App] Initialized');
});
