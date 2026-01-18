import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  TabBar,
  TaskList,
  AddTaskPanel,
  Toolbar,
  ScreenshotPanel,
  LogsPanel,
  SettingsPage,
  WelcomeDialog,
  ConnectionPanel,
  DashboardView,
} from '@/components';
import { autoLoadInterface, loadConfig, loadConfigFromStorage, resolveI18nText } from '@/services';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { loggers } from '@/utils/logger';

const log = loggers.app;

type LoadingState = 'loading' | 'success' | 'error';

// 检测是否在 Tauri 环境中
const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

/**
 * 设置窗口标题
 */
async function setWindowTitle(title: string) {
  // 同时设置 document.title（对浏览器和 Tauri 都有效）
  document.title = title;
  
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();
      await currentWindow.setTitle(title);
    } catch (err) {
      log.warn('设置窗口标题失败:', err);
    }
  }
}

function App() {
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const { t } = useTranslation();

  const {
    setProjectInterface,
    setInterfaceTranslations,
    setBasePath,
    importConfig,
    createInstance,
    theme,
    currentPage,
    projectInterface,
    interfaceTranslations,
    language,
    sidePanelExpanded,
    dashboardView,
  } = useAppStore();

  const initialized = useRef(false);

  // 设置窗口标题
  useEffect(() => {
    if (!projectInterface) return;
    
    const langKey = language === 'zh-CN' ? 'zh_cn' : 'en_us';
    const translations = interfaceTranslations[langKey];
    
    // 优先使用 title 字段，否则使用 name + version
    let title: string;
    if (projectInterface.title) {
      title = resolveI18nText(projectInterface.title, translations);
    } else {
      const name = resolveI18nText(projectInterface.label, translations) || projectInterface.name;
      const version = projectInterface.version;
      title = version ? `${name} v${version}` : name;
    }
    
    setWindowTitle(title);
  }, [projectInterface, language, interfaceTranslations]);

  // 加载 interface.json 和配置文件
  const loadInterface = async () => {
    setLoadingState('loading');
    setErrorMessage('');

    try {
      log.info('加载 interface.json...');
      const result = await autoLoadInterface();
      setProjectInterface(result.interface);
      setBasePath(result.basePath);

      // 设置翻译
      for (const [lang, trans] of Object.entries(result.translations)) {
        setInterfaceTranslations(lang, trans);
      }

      // 加载用户配置（mxu.json）
      let config = await loadConfig(result.basePath);
      
      // 浏览器环境下，如果没有从 public 目录加载到配置，尝试从 localStorage 加载
      if (config.instances.length === 0) {
        const storageConfig = loadConfigFromStorage();
        if (storageConfig && storageConfig.instances.length > 0) {
          config = storageConfig;
        }
      }

      // 应用配置
      if (config.instances.length > 0) {
        importConfig(config);
      }

      log.info('加载完成, 项目:', result.interface.name);
      setLoadingState('success');

      // 如果没有实例，创建一个默认实例
      setTimeout(() => {
        const currentInstances = useAppStore.getState().instances;
        if (currentInstances.length === 0) {
          createInstance(t('instance.defaultName', '多开 1'));
        }
      }, 0);
    } catch (err) {
      log.error('加载 interface.json 失败:', err);
      setErrorMessage(err instanceof Error ? err.message : '加载失败');
      setLoadingState('error');
    }
  };

  // 初始化
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // 设置主题
    document.documentElement.classList.toggle('dark', theme === 'dark');

    // 自动加载 interface
    loadInterface();
  }, []);

  // 主题变化时更新 DOM
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // 设置页面
  if (currentPage === 'settings') {
    return <SettingsPage />;
  }

  // 计算显示标题
  const getDisplayTitle = () => {
    if (!projectInterface) return { title: 'MXU', subtitle: 'MaaFramework 下一代通用 GUI' };
    
    const langKey = language === 'zh-CN' ? 'zh_cn' : 'en_us';
    const translations = interfaceTranslations[langKey];
    
    // 优先使用 title 字段，否则使用 label/name + version
    let title: string;
    if (projectInterface.title) {
      title = resolveI18nText(projectInterface.title, translations);
    } else {
      const name = resolveI18nText(projectInterface.label, translations) || projectInterface.name;
      const version = projectInterface.version;
      title = version ? `${name} v${version}` : name;
    }
    
    // 副标题：使用 description 或默认
    const subtitle = projectInterface.description 
      ? resolveI18nText(projectInterface.description, translations)
      : 'MaaFramework 下一代通用 GUI';
    
    return { title, subtitle };
  };

  // 加载中或错误状态
  if (loadingState !== 'success' || !projectInterface) {
    const { title: displayTitle, subtitle: displaySubtitle } = getDisplayTitle();
    
    return (
      <div className="h-full flex flex-col items-center justify-center bg-bg-primary p-8">
        <div className="max-w-md w-full space-y-6 text-center">
          {/* Logo/标题 */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-text-primary">{displayTitle}</h1>
            <p className="text-text-secondary">{displaySubtitle}</p>
          </div>

          {/* 加载状态 */}
          {loadingState === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-accent" />
              <p className="text-text-secondary">正在加载 interface.json...</p>
            </div>
          )}

          {/* 错误状态 */}
          {loadingState === 'error' && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">加载失败</span>
              </div>
              <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
              <button
                onClick={loadInterface}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 主页面
  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* 欢迎弹窗 */}
      <WelcomeDialog />

      {/* 顶部标签栏 */}
      <TabBar />

      {/* 中控台视图 */}
      {dashboardView ? (
        <DashboardView />
      ) : (
        /* 主内容区 */
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧任务列表区 */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-border">
            {/* 任务列表 */}
            <TaskList />

            {/* 添加任务面板 */}
            {showAddPanel && <AddTaskPanel />}

            {/* 底部工具栏 */}
            <Toolbar
              showAddPanel={showAddPanel}
              onToggleAddPanel={() => setShowAddPanel(!showAddPanel)}
            />
          </div>

          {/* 右侧信息面板 */}
          <div className="w-80 flex flex-col gap-3 p-3 bg-bg-primary overflow-y-auto">
            {/* 连接设置和实时截图（可折叠） */}
            {sidePanelExpanded && (
              <>
                {/* 连接设置（设备/资源选择） */}
                <ConnectionPanel />

                {/* 实时截图 */}
                <ScreenshotPanel />
              </>
            )}

            {/* 运行日志 */}
            <LogsPanel />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
