import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, FolderOpen, X, Play, Flag } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import type { ActionConfig } from '@/types/interface';
import clsx from 'clsx';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from '@tauri-apps/api/core';

interface ActionItemProps {
  instanceId: string;
  type: 'pre' | 'post';
  action: ActionConfig | undefined;
  disabled?: boolean;
}

// 默认动作配置
const defaultAction: ActionConfig = {
  enabled: false,
  program: '',
  args: '',
};

export function ActionItem({ instanceId, type, action, disabled }: ActionItemProps) {
  const { t } = useTranslation();
  const { setInstancePreAction, setInstancePostAction } = useAppStore();
  const [expanded, setExpanded] = useState(false);

  // 当前动作配置（使用默认值填充缺失字段）
  const currentAction = useMemo<ActionConfig>(() => ({
    ...defaultAction,
    ...action,
  }), [action]);

  const setAction = type === 'pre' ? setInstancePreAction : setInstancePostAction;

  // 标题和图标
  const title = type === 'pre' ? t('action.preAction') : t('action.postAction');
  const Icon = type === 'pre' ? Play : Flag;
  const iconColor = type === 'pre' ? 'text-success' : 'text-warning';

  // 删除动作
  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    setAction(instanceId, undefined);
  };

  // 更新动作配置
  const updateAction = (updates: Partial<ActionConfig>) => {
    setAction(instanceId, {
      ...currentAction,
      ...updates,
    });
  };

  // 切换启用状态
  const handleToggleEnabled = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    updateAction({ enabled: !currentAction.enabled });
  };

  // 选择程序文件
  const handleSelectProgram = async () => {
    if (!isTauri()) return;
    
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: 'Executable', extensions: ['exe', 'bat', 'cmd', 'ps1', 'sh'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      
      if (selected && typeof selected === 'string') {
        updateAction({ program: selected });
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  };

  // 判断是否有有效配置（有程序路径）
  const hasConfig = currentAction.program.trim().length > 0;

  return (
    <div
      className={clsx(
        'group rounded-lg border overflow-hidden transition-shadow flex-shrink-0',
        currentAction.enabled
          ? 'bg-bg-secondary border-border'
          : 'bg-bg-secondary/50 border-border/50',
        disabled && 'opacity-50',
      )}
    >
      {/* 头部 */}
      <div className="flex items-center gap-2 p-3">
        {/* 启用复选框 */}
        <label
          className={clsx(
            'flex items-center',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
          onClick={handleToggleEnabled}
        >
          <input
            type="checkbox"
            checked={currentAction.enabled}
            onChange={() => {}}
            disabled={disabled}
            className="w-4 h-4 rounded border-border-strong accent-accent disabled:cursor-not-allowed"
          />
        </label>

        {/* 动作名称 + 展开区域 */}
        <div
          className="flex-1 flex items-center min-w-0 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {/* 图标 */}
          <Icon className={clsx('w-4 h-4 mr-1.5 flex-shrink-0', iconColor)} />

          <span
            className={clsx(
              'text-sm font-medium truncate',
              currentAction.enabled ? 'text-text-primary' : 'text-text-muted',
            )}
          >
            {title}
          </span>

          {/* 预览：未展开时显示程序名称 */}
          {!expanded && hasConfig && (
            <span className="ml-2 text-xs text-text-tertiary truncate max-w-[200px]">
              {currentAction.program.split(/[/\\]/).pop()}
            </span>
          )}

          {/* 展开/折叠箭头 */}
          <div className="flex items-center justify-end pl-2 ml-auto">
            <ChevronRight
              className={clsx(
                'w-4 h-4 text-text-secondary transition-transform duration-150 ease-out',
                expanded && 'rotate-90',
              )}
            />
          </div>
        </div>

        {/* 删除按钮 */}
        {!disabled && (
          <button
            onClick={handleRemove}
            className={clsx(
              'p-1 rounded opacity-0 group-hover:opacity-100 transition-all',
              'text-text-muted hover:bg-error/10 hover:text-error',
            )}
            title={t('common.delete')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 展开面板 */}
      <div
        className="grid transition-[grid-template-rows] duration-150 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden min-h-0">
          <div className="border-t border-border bg-bg-tertiary p-3 space-y-3">
            {/* 程序路径 */}
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">{t('action.program')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={currentAction.program}
                  onChange={(e) => updateAction({ program: e.target.value })}
                  placeholder={t('action.programPlaceholder')}
                  disabled={disabled}
                  className={clsx(
                    'flex-1 px-2.5 py-1.5 text-sm rounded-md border',
                    'bg-bg-primary text-text-primary border-border',
                    'focus:outline-none focus:ring-1 focus:ring-accent/20 focus:border-accent',
                    'placeholder:text-text-muted',
                    disabled && 'cursor-not-allowed opacity-50',
                  )}
                />
                {isTauri() && (
                  <button
                    onClick={handleSelectProgram}
                    disabled={disabled}
                    className={clsx(
                      'px-2.5 py-1.5 rounded-md border border-border',
                      'bg-bg-secondary hover:bg-bg-hover text-text-secondary',
                      'transition-colors',
                      disabled && 'cursor-not-allowed opacity-50',
                    )}
                    title={t('action.browse')}
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* 附加参数 */}
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">{t('action.args')}</label>
              <input
                type="text"
                value={currentAction.args}
                onChange={(e) => updateAction({ args: e.target.value })}
                placeholder={t('action.argsPlaceholder')}
                disabled={disabled}
                className={clsx(
                  'w-full px-2.5 py-1.5 text-sm rounded-md border',
                  'bg-bg-primary text-text-primary border-border',
                  'focus:outline-none focus:ring-1 focus:ring-accent/20 focus:border-accent',
                  'placeholder:text-text-muted',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              />
              <p className="text-[10px] text-text-muted">{t('action.argsHint')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
