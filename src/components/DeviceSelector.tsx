import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Smartphone,
  Monitor,
  RefreshCw,
  Loader2,
  ChevronDown,
  Check,
  AlertCircle,
  Wifi,
  WifiOff,
  Apple,
  Gamepad2,
  Info,
} from 'lucide-react';
import clsx from 'clsx';
import { maaService } from '@/services/maaService';
import { useAppStore } from '@/stores/appStore';
import type { AdbDevice, Win32Window, ControllerConfig } from '@/types/maa';
import type { ControllerItem } from '@/types/interface';
import { parseWin32ScreencapMethod, parseWin32InputMethod } from '@/types/maa';

interface DeviceSelectorProps {
  instanceId: string;
  controllerDef: ControllerItem;
  onConnectionChange?: (connected: boolean) => void;
}

export function DeviceSelector({ instanceId, controllerDef, onConnectionChange }: DeviceSelectorProps) {
  const { t } = useTranslation();
  const { basePath } = useAppStore();

  const [isSearching, setIsSearching] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ADB 设备列表
  const [adbDevices, setAdbDevices] = useState<AdbDevice[]>([]);
  const [selectedAdbDevice, setSelectedAdbDevice] = useState<AdbDevice | null>(null);

  // Win32 窗口列表
  const [win32Windows, setWin32Windows] = useState<Win32Window[]>([]);
  const [selectedWindow, setSelectedWindow] = useState<Win32Window | null>(null);

  const [showDropdown, setShowDropdown] = useState(false);

  const controllerType = controllerDef.type;

  // PlayCover 地址输入
  const [playcoverAddress, setPlaycoverAddress] = useState('127.0.0.1:1717');

  // 判断是否需要搜索设备（PlayCover 不需要搜索）
  const needsDeviceSearch = controllerType === 'Adb' || controllerType === 'Win32' || controllerType === 'Gamepad';

  // 初始化 MaaFramework（如果还没初始化）
  const ensureMaaInitialized = async () => {
    console.log('[DeviceSelector] Ensuring MaaFramework is initialized, basePath:', basePath);
    
    // 尝试获取版本来检测是否已初始化
    try {
      const version = await maaService.getVersion();
      console.log('[DeviceSelector] MaaFramework already initialized, version:', version);
      return true;
    } catch {
      // 未初始化，需要初始化
      console.log('[DeviceSelector] MaaFramework not initialized, attempting to init...');
    }
    
    // 构建可能的库路径列表
    const possibleLibPaths: string[] = [];
    
    // 检测是否在 Tauri 环境
    const isTauriEnv = typeof window !== 'undefined' && '__TAURI__' in window;
    
    if (isTauriEnv) {
      try {
        // 在 Tauri 环境中，使用实际的文件系统路径
        const { resourceDir, appDataDir } = await import('@tauri-apps/api/path');
        
        // 尝试资源目录
        try {
          const resDir = await resourceDir();
          console.log('[DeviceSelector] Tauri resourceDir:', resDir);
          possibleLibPaths.push(resDir);
          possibleLibPaths.push(`${resDir}bin`);
        } catch (e) {
          console.log('[DeviceSelector] Failed to get resourceDir:', e);
        }
        
        // 尝试应用数据目录
        try {
          const dataDir = await appDataDir();
          console.log('[DeviceSelector] Tauri appDataDir:', dataDir);
          possibleLibPaths.push(dataDir);
        } catch (e) {
          console.log('[DeviceSelector] Failed to get appDataDir:', e);
        }
        
        // 开发环境：尝试当前工作目录
        // 注意：Windows 路径使用反斜杠
        possibleLibPaths.push('.');
        possibleLibPaths.push('./bin');
        
        // 如果有 basePath（实际文件系统路径），也尝试它
        if (basePath && !basePath.startsWith('/') && !basePath.startsWith('http')) {
          possibleLibPaths.push(basePath);
          possibleLibPaths.push(`${basePath}/bin`);
        }
      } catch (e) {
        console.log('[DeviceSelector] Failed to import Tauri path API:', e);
      }
    }
    
    // 兜底路径
    if (possibleLibPaths.length === 0) {
      possibleLibPaths.push('.');
      possibleLibPaths.push('./bin');
    }
    
    console.log('[DeviceSelector] Possible lib paths:', possibleLibPaths);
    
    for (const libPath of possibleLibPaths) {
      try {
        console.log('[DeviceSelector] Trying to init MaaFramework from:', libPath);
        const version = await maaService.init(libPath);
        console.log('[DeviceSelector] MaaFramework initialized successfully, version:', version);
        return true;
      } catch (err) {
        console.log('[DeviceSelector] Failed to init from', libPath, ':', err);
      }
    }
    
    return false;
  };

  // 搜索设备
  const handleSearch = async () => {
    setIsSearching(true);
    setError(null);

    try {
      console.log('[DeviceSelector] handleSearch called, controllerType:', controllerType);
      
      // 确保 MaaFramework 已初始化
      const initialized = await ensureMaaInitialized();
      if (!initialized) {
        throw new Error('无法初始化 MaaFramework，请确保 MaaFramework.dll 和 MaaToolkit.dll 在正确的位置');
      }
      
      if (controllerType === 'Adb') {
        console.log('[DeviceSelector] Calling maaService.findAdbDevices()...');
        const devices = await maaService.findAdbDevices();
        console.log('[DeviceSelector] findAdbDevices returned:', devices);
        setAdbDevices(devices);
        if (devices.length === 1) {
          setSelectedAdbDevice(devices[0]);
        }
      } else if (controllerType === 'Win32' || controllerType === 'Gamepad') {
        const classRegex = controllerDef.win32?.class_regex || controllerDef.gamepad?.class_regex;
        const windowRegex = controllerDef.win32?.window_regex || controllerDef.gamepad?.window_regex;
        console.log('[DeviceSelector] Calling maaService.findWin32Windows with classRegex:', classRegex, 'windowRegex:', windowRegex);
        const windows = await maaService.findWin32Windows(classRegex, windowRegex);
        console.log('[DeviceSelector] findWin32Windows returned:', windows);
        setWin32Windows(windows);
        if (windows.length === 1) {
          setSelectedWindow(windows[0]);
        }
      }
    } catch (err) {
      console.error('[DeviceSelector] Search error:', err);
      setError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setIsSearching(false);
    }
  };

  // 连接设备
  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      // 确保实例已创建
      await maaService.createInstance(instanceId).catch(() => {});

      let config: ControllerConfig;

      if (controllerType === 'Adb' && selectedAdbDevice) {
        config = {
          type: 'Adb',
          adb_path: selectedAdbDevice.adb_path,
          address: selectedAdbDevice.address,
          screencap_methods: selectedAdbDevice.screencap_methods,
          input_methods: selectedAdbDevice.input_methods,
          config: selectedAdbDevice.config,
        };
      } else if (controllerType === 'Win32' && selectedWindow) {
        config = {
          type: 'Win32',
          handle: selectedWindow.handle,
          screencap_method: parseWin32ScreencapMethod(controllerDef.win32?.screencap || ''),
          mouse_method: parseWin32InputMethod(controllerDef.win32?.mouse || ''),
          keyboard_method: parseWin32InputMethod(controllerDef.win32?.keyboard || ''),
        };
      } else if (controllerType === 'PlayCover') {
        config = {
          type: 'PlayCover',
          address: playcoverAddress,
        };
      } else if (controllerType === 'Gamepad' && selectedWindow) {
        config = {
          type: 'Gamepad',
          handle: selectedWindow.handle,
        };
      } else {
        throw new Error('请先选择设备');
      }

      // MaaAgentBinary 路径
      const agentPath = `${basePath}/MaaAgentBinary`;

      await maaService.connectController(instanceId, config, agentPath);
      setIsConnected(true);
      onConnectionChange?.(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败');
      setIsConnected(false);
      onConnectionChange?.(false);
    } finally {
      setIsConnecting(false);
    }
  };

  // 断开连接
  const handleDisconnect = async () => {
    try {
      await maaService.destroyInstance(instanceId);
      setIsConnected(false);
      onConnectionChange?.(false);
    } catch (err) {
      console.error('断开连接失败:', err);
    }
  };

  // 获取当前选中的显示文本
  const getSelectedText = () => {
    if (controllerType === 'Adb' && selectedAdbDevice) {
      return `${selectedAdbDevice.name} (${selectedAdbDevice.address})`;
    }
    if ((controllerType === 'Win32' || controllerType === 'Gamepad') && selectedWindow) {
      return selectedWindow.window_name || selectedWindow.class_name;
    }
    return t('controller.selectController');
  };

  // 获取设备列表
  const getDeviceList = () => {
    if (controllerType === 'Adb') {
      return adbDevices.map(device => ({
        id: `${device.adb_path}:${device.address}`,
        name: device.name,
        description: device.address,
        selected: selectedAdbDevice?.address === device.address,
        onClick: () => {
          setSelectedAdbDevice(device);
          setShowDropdown(false);
        },
      }));
    }
    if (controllerType === 'Win32' || controllerType === 'Gamepad') {
      return win32Windows.map(window => ({
        id: String(window.handle),
        name: window.window_name || '(无标题)',
        description: window.class_name,
        selected: selectedWindow?.handle === window.handle,
        onClick: () => {
          setSelectedWindow(window);
          setShowDropdown(false);
        },
      }));
    }
    return [];
  };

  // 判断是否可以连接
  const canConnect = () => {
    if (controllerType === 'Adb') return !!selectedAdbDevice;
    if (controllerType === 'Win32' || controllerType === 'Gamepad') return !!selectedWindow;
    if (controllerType === 'PlayCover') return playcoverAddress.trim().length > 0;
    return false;
  };

  const deviceList = getDeviceList();

  // 获取控制器图标
  const getControllerIcon = () => {
    switch (controllerType) {
      case 'Adb':
        return <Smartphone className="w-4 h-4" />;
      case 'Win32':
        return <Monitor className="w-4 h-4" />;
      case 'PlayCover':
        return <Apple className="w-4 h-4" />;
      case 'Gamepad':
        return <Gamepad2 className="w-4 h-4" />;
      default:
        return <Smartphone className="w-4 h-4" />;
    }
  };

  // 获取控制器类型名称
  const getControllerTypeName = () => {
    switch (controllerType) {
      case 'Adb':
        return t('controller.adb');
      case 'Win32':
        return t('controller.win32');
      case 'PlayCover':
        return t('controller.playcover');
      case 'Gamepad':
        return t('controller.gamepad');
      default:
        return controllerType;
    }
  };

  return (
    <div className="space-y-3">
      {/* 控制器类型标签 */}
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        {getControllerIcon()}
        <span>{getControllerTypeName()}</span>
        {isConnected && (
          <span className="flex items-center gap-1 text-green-500 text-xs">
            <Wifi className="w-3 h-3" />
            {t('controller.connected')}
          </span>
        )}
      </div>

      {/* PlayCover 地址输入 */}
      {controllerType === 'PlayCover' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Info className="w-3 h-3" />
            <span>{t('controller.playcoverHint')}</span>
          </div>
          <input
            type="text"
            value={playcoverAddress}
            onChange={(e) => setPlaycoverAddress(e.target.value)}
            placeholder="127.0.0.1:1717"
            disabled={isConnected || isConnecting}
            className={clsx(
              'w-full px-3 py-2.5 rounded-lg border bg-bg-tertiary border-border',
              'text-text-primary placeholder:text-text-muted',
              'focus:outline-none focus:border-accent transition-colors',
              isConnected && 'opacity-60 cursor-not-allowed'
            )}
          />
        </div>
      )}

      {/* 设备选择下拉框 - 仅对需要搜索设备的控制器显示 */}
      {needsDeviceSearch && (
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            disabled={isConnecting || isConnected}
            className={clsx(
              'w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors',
              'bg-bg-tertiary border-border',
              isConnected
                ? 'opacity-60 cursor-not-allowed'
                : 'hover:border-accent cursor-pointer'
            )}
          >
            <span className={clsx(
              'truncate',
              (controllerType === 'Adb' ? selectedAdbDevice : selectedWindow)
                ? 'text-text-primary'
                : 'text-text-muted'
            )}>
              {getSelectedText()}
            </span>
            <ChevronDown className={clsx(
              'w-4 h-4 text-text-muted transition-transform',
              showDropdown && 'rotate-180'
            )} />
          </button>

          {/* 下拉菜单 */}
          {showDropdown && (
            <div className="absolute z-50 w-full mt-1 bg-bg-secondary border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {deviceList.length > 0 ? (
                deviceList.map(item => (
                  <button
                    key={item.id}
                    onClick={item.onClick}
                    className={clsx(
                      'w-full flex items-center justify-between px-3 py-2 text-left transition-colors',
                      'hover:bg-bg-hover',
                      item.selected && 'bg-accent/10'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text-primary truncate">{item.name}</div>
                      <div className="text-xs text-text-muted truncate">{item.description}</div>
                    </div>
                    {item.selected && <Check className="w-4 h-4 text-accent flex-shrink-0 ml-2" />}
                  </button>
                ))
              ) : (
                <div className="px-3 py-4 text-center text-text-muted text-sm">
                  {isSearching ? t('common.loading') : '点击刷新按钮搜索设备'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-2">
        {/* 仅对需要搜索设备的控制器显示刷新按钮 */}
        {needsDeviceSearch && (
          <button
            onClick={handleSearch}
            disabled={isSearching || isConnecting || isConnected}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              'bg-bg-tertiary text-text-secondary',
              isSearching || isConnecting || isConnected
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-bg-hover'
            )}
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {isSearching ? t('common.loading') : t('controller.refresh')}
          </button>
        )}

        {isConnected ? (
          <button
            onClick={handleDisconnect}
            className={clsx(
              'flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
              'bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors',
              needsDeviceSearch ? 'flex-1' : 'w-full'
            )}
          >
            <WifiOff className="w-4 h-4" />
            {t('controller.disconnect')}
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={isConnecting || !canConnect()}
            className={clsx(
              'flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              isConnecting || !canConnect()
                ? 'bg-accent/50 text-white/70 cursor-not-allowed'
                : 'bg-accent text-white hover:bg-accent-hover',
              needsDeviceSearch ? 'flex-1' : 'w-full'
            )}
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('controller.connecting')}
              </>
            ) : (
              <>
                <Wifi className="w-4 h-4" />
                {t('controller.connect')}
              </>
            )}
          </button>
        )}
      </div>

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
