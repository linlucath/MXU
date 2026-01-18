import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Monitor, Play, Pause, Circle } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/stores/appStore';
import { maaService } from '@/services/maaService';

interface InstanceCardProps {
  instanceId: string;
  instanceName: string;
  isActive: boolean;
  onSelect: () => void;
}

function InstanceCard({ instanceId, instanceName, isActive, onSelect }: InstanceCardProps) {
  const { t } = useTranslation();
  const {
    instanceConnectionStatus,
    instanceTaskStatus,
    instanceScreenshotStreaming,
    setInstanceScreenshotStreaming,
  } = useAppStore();

  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const streamingRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const frameIntervalRef = useRef(1000 / 3); // 中控台使用更低的帧率节省资源

  const connectionStatus = instanceConnectionStatus[instanceId];
  const taskStatus = instanceTaskStatus[instanceId];
  const isStreaming = instanceScreenshotStreaming[instanceId] ?? false;
  const isConnected = connectionStatus === 'Connected';

  // 获取截图
  const captureFrame = useCallback(async (): Promise<string | null> => {
    if (!instanceId) return null;

    try {
      const isRunning = await maaService.isRunning(instanceId);

      if (isRunning) {
        const imageData = await maaService.getCachedImage(instanceId);
        return imageData || null;
      } else {
        const screencapId = await maaService.postScreencap(instanceId);
        if (screencapId < 0) return null;

        const success = await maaService.screencapWait(instanceId, screencapId);
        if (!success) return null;

        const imageData = await maaService.getCachedImage(instanceId);
        return imageData || null;
      }
    } catch {
      return null;
    }
  }, [instanceId]);

  // 截图流循环
  const streamLoop = useCallback(async () => {
    const loopInstanceId = instanceId;

    while (streamingRef.current) {
      const now = Date.now();
      const elapsed = now - lastFrameTimeRef.current;

      if (elapsed < frameIntervalRef.current) {
        await new Promise((resolve) => setTimeout(resolve, frameIntervalRef.current - elapsed));
        continue;
      }

      lastFrameTimeRef.current = Date.now();

      try {
        const imageData = await captureFrame();
        if (imageData && streamingRef.current) {
          setScreenshotUrl(imageData);
        }
      } catch {
        // 静默处理
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }, [instanceId, captureFrame]);

  // 切换截图流
  const toggleStreaming = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      if (!instanceId || !isConnected) return;

      if (isStreaming) {
        streamingRef.current = false;
        setInstanceScreenshotStreaming(instanceId, false);
      } else {
        streamingRef.current = true;
        setInstanceScreenshotStreaming(instanceId, true);
        streamLoop();
      }
    },
    [instanceId, isConnected, isStreaming, setInstanceScreenshotStreaming, streamLoop]
  );

  // 组件卸载时停止流
  useEffect(() => {
    return () => {
      streamingRef.current = false;
    };
  }, []);

  // 响应 store 中 isStreaming 状态变化
  useEffect(() => {
    // 同步 ref 与 store 状态
    streamingRef.current = isStreaming;
    
    // 如果状态变为开启且已连接，启动流
    if (isStreaming && isConnected) {
      streamLoop();
    }
  }, [isStreaming, isConnected, streamLoop]);

  // 连接后自动开始截图流（仅首次连接时）
  const prevConnectedRef = useRef(false);
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;
    
    // 仅在从未连接变为已连接时自动开始
    if (isConnected && !wasConnected && !isStreaming) {
      streamingRef.current = true;
      setInstanceScreenshotStreaming(instanceId, true);
      streamLoop();
    }
  }, [isConnected, isStreaming, instanceId, setInstanceScreenshotStreaming, streamLoop]);

  // 获取状态颜色
  const getStatusColor = () => {
    if (taskStatus === 'Running') return 'text-green-500';
    if (taskStatus === 'Failed') return 'text-red-500';
    if (isConnected) return 'text-blue-500';
    return 'text-gray-400';
  };

  const getStatusText = () => {
    if (taskStatus === 'Running') return t('dashboard.running');
    if (taskStatus === 'Succeeded') return t('dashboard.succeeded');
    if (taskStatus === 'Failed') return t('dashboard.failed');
    if (connectionStatus === 'Connecting') return t('controller.connecting');
    if (isConnected) return t('controller.connected');
    return t('controller.disconnected');
  };

  return (
    <div
      onClick={onSelect}
      className={clsx(
        'group relative bg-bg-secondary rounded-xl border-2 overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg',
        isActive ? 'border-accent shadow-md' : 'border-border hover:border-accent/50'
      )}
    >
      {/* 截图区域 */}
      <div className="aspect-video bg-bg-tertiary relative overflow-hidden">
        {screenshotUrl ? (
          <>
            <img
              src={screenshotUrl}
              alt="Screenshot"
              className="w-full h-full object-contain"
            />
            {/* 流状态指示器 */}
            {isStreaming && (
              <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-green-500/80 rounded text-white text-xs">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                LIVE
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
            <Monitor className="w-8 h-8 opacity-30 mb-1" />
            <span className="text-xs">
              {isConnected ? t('screenshot.noScreenshot') : t('screenshot.connectFirst')}
            </span>
          </div>
        )}

        {/* 流控制按钮 */}
        {isConnected && (
          <button
            onClick={toggleStreaming}
            className={clsx(
              'absolute bottom-2 right-2 p-1.5 rounded-md transition-all',
              'bg-black/50 hover:bg-black/70 text-white',
              'opacity-0 group-hover:opacity-100'
            )}
            title={isStreaming ? t('screenshot.stopStream') : t('screenshot.startStream')}
          >
            {isStreaming ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* 实例信息栏 */}
      <div className="px-3 py-2 border-t border-border">
        <div className="flex items-center justify-between">
          <span
            className={clsx(
              'font-medium truncate',
              isActive ? 'text-accent' : 'text-text-primary'
            )}
          >
            {instanceName}
          </span>
          <div className="flex items-center gap-1.5">
            <Circle className={clsx('w-2 h-2 fill-current', getStatusColor())} />
            <span className={clsx('text-xs', getStatusColor())}>{getStatusText()}</span>
          </div>
        </div>
      </div>

      {/* 运行中动画边框 */}
      {taskStatus === 'Running' && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 rounded-xl border-2 border-green-500/50 animate-pulse" />
        </div>
      )}
    </div>
  );
}

export function DashboardView() {
  const { t } = useTranslation();
  const { instances, activeInstanceId, setActiveInstance, toggleDashboardView } = useAppStore();

  const handleSelectInstance = (instanceId: string) => {
    setActiveInstance(instanceId);
    toggleDashboardView();
  };

  return (
    <div className="h-full flex flex-col bg-bg-primary overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-secondary">
        <div className="flex items-center gap-3">
          <LayoutGrid className="w-5 h-5 text-accent" />
          <h1 className="text-lg font-semibold text-text-primary">{t('dashboard.title')}</h1>
          <span className="px-2 py-0.5 text-xs bg-accent/10 text-accent rounded-full">
            {instances.length} {t('dashboard.instances')}
          </span>
        </div>
        <button
          onClick={toggleDashboardView}
          className="px-3 py-1.5 text-sm bg-bg-hover hover:bg-bg-active text-text-secondary rounded-lg transition-colors"
        >
          {t('dashboard.exit')}
        </button>
      </div>

      {/* 实例网格 */}
      <div className="flex-1 overflow-auto p-6">
        {instances.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-muted">
            <p>{t('dashboard.noInstances')}</p>
          </div>
        ) : (
          <div
            className={clsx(
              'grid gap-4',
              instances.length === 1
                ? 'grid-cols-1 max-w-2xl mx-auto'
                : instances.length === 2
                ? 'grid-cols-2 max-w-4xl mx-auto'
                : instances.length <= 4
                ? 'grid-cols-2 lg:grid-cols-2 max-w-5xl mx-auto'
                : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
            )}
          >
            {instances.map((instance) => (
              <InstanceCard
                key={instance.id}
                instanceId={instance.id}
                instanceName={instance.name}
                isActive={instance.id === activeInstanceId}
                onSelect={() => handleSelectInstance(instance.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
