import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FolderOpen,
  Check,
  ChevronDown,
  Loader2,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { maaService } from '@/services/maaService';
import { useAppStore } from '@/stores/appStore';
import { resolveI18nText } from '@/services/contentResolver';
import type { ResourceItem } from '@/types/interface';

interface ResourceSelectorProps {
  instanceId: string;
  resources: ResourceItem[];
  selectedResourceName?: string;
  onResourceChange?: (resourceName: string) => void;
  onLoadStatusChange?: (loaded: boolean) => void;
}

export function ResourceSelector({
  instanceId,
  resources,
  selectedResourceName,
  onResourceChange,
  onLoadStatusChange,
}: ResourceSelectorProps) {
  const { t } = useTranslation();
  const { basePath, language, interfaceTranslations } = useAppStore();

  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  const langKey = language === 'zh-CN' ? 'zh_cn' : 'en_us';
  const translations = interfaceTranslations[langKey];

  // 当前选中的资源
  const selectedResource = resources.find(r => r.name === selectedResourceName) || resources[0];

  // 加载资源
  const handleLoad = async () => {
    if (!selectedResource) {
      setError('请先选择资源包');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 确保实例已创建
      await maaService.createInstance(instanceId).catch(() => {});

      // 构建完整资源路径
      const resourcePaths = selectedResource.path.map(p => `${basePath}/${p}`);

      await maaService.loadResource(instanceId, resourcePaths);
      setIsLoaded(true);
      onLoadStatusChange?.(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '资源加载失败');
      setIsLoaded(false);
      onLoadStatusChange?.(false);
    } finally {
      setIsLoading(false);
    }
  };

  // 获取资源显示名称
  const getResourceDisplayName = (resource: ResourceItem) => {
    return resolveI18nText(resource.label, translations) || resource.name;
  };

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <FolderOpen className="w-4 h-4" />
        <span>{t('resource.title')}</span>
        {isLoaded && (
          <span className="flex items-center gap-1 text-green-500 text-xs">
            <CheckCircle className="w-3 h-3" />
            {t('resource.loaded')}
          </span>
        )}
      </div>

      {/* 资源选择下拉框 */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={isLoading || isLoaded}
          className={clsx(
            'w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors',
            'bg-bg-tertiary border-border',
            isLoaded
              ? 'opacity-60 cursor-not-allowed'
              : 'hover:border-accent cursor-pointer'
          )}
        >
          <span className={clsx(
            'truncate',
            selectedResource ? 'text-text-primary' : 'text-text-muted'
          )}>
            {selectedResource
              ? getResourceDisplayName(selectedResource)
              : t('resource.selectResource')}
          </span>
          <ChevronDown className={clsx(
            'w-4 h-4 text-text-muted transition-transform',
            showDropdown && 'rotate-180'
          )} />
        </button>

        {/* 下拉菜单 */}
        {showDropdown && (
          <div className="absolute z-50 w-full mt-1 bg-bg-secondary border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {resources.map(resource => (
              <button
                key={resource.name}
                onClick={() => {
                  onResourceChange?.(resource.name);
                  setShowDropdown(false);
                  setIsLoaded(false);
                }}
                className={clsx(
                  'w-full flex items-center justify-between px-3 py-2 text-left transition-colors',
                  'hover:bg-bg-hover',
                  selectedResource?.name === resource.name && 'bg-accent/10'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary truncate">
                    {getResourceDisplayName(resource)}
                  </div>
                  {resource.description && (
                    <div className="text-xs text-text-muted truncate">
                      {resolveI18nText(resource.description, translations)}
                    </div>
                  )}
                </div>
                {selectedResource?.name === resource.name && (
                  <Check className="w-4 h-4 text-accent flex-shrink-0 ml-2" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 加载按钮 */}
      <button
        onClick={handleLoad}
        disabled={isLoading || isLoaded || !selectedResource}
        className={clsx(
          'w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
          isLoading || isLoaded || !selectedResource
            ? 'bg-accent/50 text-white/70 cursor-not-allowed'
            : 'bg-accent text-white hover:bg-accent-hover'
        )}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('resource.loading')}
          </>
        ) : isLoaded ? (
          <>
            <CheckCircle className="w-4 h-4" />
            {t('resource.loaded')}
          </>
        ) : (
          <>
            <FolderOpen className="w-4 h-4" />
            加载资源
          </>
        )}
      </button>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-red-500 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
