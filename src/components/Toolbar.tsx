import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckSquare,
  Square,
  ChevronsUpDown,
  ChevronsDownUp,
  Plus,
  Play,
  StopCircle,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { maaService } from '@/services/maaService';
import clsx from 'clsx';

interface ToolbarProps {
  showAddPanel: boolean;
  onToggleAddPanel: () => void;
}

export function Toolbar({ showAddPanel, onToggleAddPanel }: ToolbarProps) {
  const { t } = useTranslation();
  const {
    getActiveInstance,
    selectAllTasks,
    collapseAllTasks,
    updateInstance,
    projectInterface,
    instanceConnectionStatus,
    instanceResourceLoaded,
    setInstanceCurrentTaskId,
    setInstanceTaskStatus,
  } = useAppStore();

  const [isStarting, setIsStarting] = useState(false);

  const instance = getActiveInstance();
  const tasks = instance?.selectedTasks || [];
  const allEnabled = tasks.length > 0 && tasks.every((t) => t.enabled);
  const anyExpanded = tasks.some((t) => t.expanded);

  // 检查是否可以运行
  const instanceId = instance?.id || '';
  const isConnected = instanceConnectionStatus[instanceId] === 'Connected';
  const isResourceLoaded = instanceResourceLoaded[instanceId] || false;
  const canRun = isConnected && isResourceLoaded && tasks.some((t) => t.enabled);

  const handleSelectAll = () => {
    if (!instance) return;
    selectAllTasks(instance.id, !allEnabled);
  };

  const handleCollapseAll = () => {
    if (!instance) return;
    collapseAllTasks(instance.id, !anyExpanded);
  };

  // 生成 pipeline override JSON
  const generatePipelineOverride = () => {
    if (!instance || !projectInterface) return '{}';

    const enabledTasks = tasks.filter(t => t.enabled);
    const overrides: Record<string, unknown> = {};

    for (const selectedTask of enabledTasks) {
      const taskDef = projectInterface.task.find(t => t.name === selectedTask.taskName);
      if (!taskDef) continue;

      // 添加任务自身的 pipeline_override
      if (taskDef.pipeline_override) {
        Object.assign(overrides, taskDef.pipeline_override);
      }

      // 处理选项
      for (const [optionKey, optionValue] of Object.entries(selectedTask.optionValues)) {
        const optionDef = projectInterface.option?.[optionKey];
        if (!optionDef) continue;

        if (optionValue.type === 'select' || optionValue.type === 'switch') {
          const caseName = optionValue.type === 'switch' 
            ? (optionValue.value ? 'Yes' : 'No')
            : optionValue.caseName;
          
          const caseDef = optionDef.cases?.find(c => c.name === caseName);
          if (caseDef?.pipeline_override) {
            Object.assign(overrides, caseDef.pipeline_override);
          }
        } else if (optionValue.type === 'input' && 'pipeline_override' in optionDef) {
          // 处理输入类型选项
          let overrideStr = JSON.stringify(optionDef.pipeline_override || {});
          for (const [inputName, inputVal] of Object.entries(optionValue.values)) {
            const placeholder = `{${inputName}}`;
            overrideStr = overrideStr.replace(new RegExp(`"${placeholder}"`, 'g'), `"${inputVal}"`);
            overrideStr = overrideStr.replace(new RegExp(placeholder, 'g'), inputVal);
          }
          try {
            Object.assign(overrides, JSON.parse(overrideStr));
          } catch {
            console.warn('Failed to parse input option override:', overrideStr);
          }
        }
      }
    }

    return JSON.stringify(overrides);
  };

  const handleStartStop = async () => {
    if (!instance) return;

    if (instance.isRunning) {
      // 停止任务
      try {
        await maaService.stopTask(instance.id);
        updateInstance(instance.id, { isRunning: false });
        setInstanceTaskStatus(instance.id, null);
        setInstanceCurrentTaskId(instance.id, null);
      } catch (err) {
        console.error('停止任务失败:', err);
      }
    } else {
      // 启动任务
      if (!canRun) {
        console.warn('无法运行任务：未连接或资源未加载');
        return;
      }

      setIsStarting(true);

      try {
        const enabledTasks = tasks.filter(t => t.enabled);
        
        // 依次运行每个启用的任务
        for (const selectedTask of enabledTasks) {
          const taskDef = projectInterface?.task.find(t => t.name === selectedTask.taskName);
          if (!taskDef) continue;

          updateInstance(instance.id, { isRunning: true });
          
          // 生成当前任务的 pipeline override
          const pipelineOverride = generatePipelineOverride();
          
          // 运行任务
          const taskId = await maaService.runTask(instance.id, taskDef.entry, pipelineOverride);
          setInstanceCurrentTaskId(instance.id, taskId);
          setInstanceTaskStatus(instance.id, 'Running');

          // 等待任务完成
          const status = await maaService.waitTask(instance.id, taskId);
          setInstanceTaskStatus(instance.id, status);

          if (status === 'Failed') {
            console.error('任务执行失败:', taskDef.name);
            break;
          }
        }

        updateInstance(instance.id, { isRunning: false });
        setInstanceCurrentTaskId(instance.id, null);
      } catch (err) {
        console.error('任务执行失败:', err);
        updateInstance(instance.id, { isRunning: false });
        setInstanceTaskStatus(instance.id, 'Failed');
      } finally {
        setIsStarting(false);
      }
    }
  };

  const isDisabled = tasks.length === 0 || !tasks.some((t) => t.enabled) || (!canRun && !instance?.isRunning);

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary border-t border-border">
      {/* 左侧工具按钮 */}
      <div className="flex items-center gap-1">
        {/* 全选/取消全选 */}
        <button
          onClick={handleSelectAll}
          disabled={tasks.length === 0}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors',
            tasks.length === 0
              ? 'text-text-muted cursor-not-allowed'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          )}
          title={allEnabled ? t('taskList.deselectAll') : t('taskList.selectAll')}
        >
          {allEnabled ? (
            <CheckSquare className="w-4 h-4" />
          ) : (
            <Square className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">
            {allEnabled ? t('taskList.deselectAll') : t('taskList.selectAll')}
          </span>
        </button>

        {/* 展开/折叠 */}
        <button
          onClick={handleCollapseAll}
          disabled={tasks.length === 0}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors',
            tasks.length === 0
              ? 'text-text-muted cursor-not-allowed'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          )}
          title={anyExpanded ? t('taskList.collapseAll') : t('taskList.expandAll')}
        >
          {anyExpanded ? (
            <ChevronsDownUp className="w-4 h-4" />
          ) : (
            <ChevronsUpDown className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">
            {anyExpanded ? t('taskList.collapseAll') : t('taskList.expandAll')}
          </span>
        </button>

        {/* 添加任务 */}
        <button
          onClick={onToggleAddPanel}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors',
            showAddPanel
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          )}
          title={t('taskList.addTask')}
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">{t('taskList.addTask')}</span>
        </button>
      </div>

      {/* 右侧执行按钮 */}
      <button
        onClick={handleStartStop}
        disabled={isDisabled || isStarting}
        className={clsx(
          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
          instance?.isRunning
            ? 'bg-error hover:bg-error/90 text-white'
            : isDisabled || isStarting
            ? 'bg-bg-active text-text-muted cursor-not-allowed'
            : 'bg-accent hover:bg-accent-hover text-white'
        )}
        title={!canRun && !instance?.isRunning ? '请先连接设备并加载资源' : undefined}
      >
        {isStarting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>启动中...</span>
          </>
        ) : instance?.isRunning ? (
          <>
            <StopCircle className="w-4 h-4" />
            <span>{t('taskList.stopTasks')}</span>
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            <span>{t('taskList.startTasks')}</span>
          </>
        )}
      </button>
    </div>
  );
}
