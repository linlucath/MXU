import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ProjectInterface, Instance, SelectedTask, OptionValue, TaskItem, OptionDefinition } from '@/types/interface';
import type { MxuConfig } from '@/types/config';
import type { ConnectionStatus, TaskStatus } from '@/types/maa';
import { saveConfig } from '@/services/configService';

export type Theme = 'light' | 'dark';
export type Language = 'zh-CN' | 'en-US';
export type PageView = 'main' | 'settings';

interface AppState {
  // 主题和语言
  theme: Theme;
  language: Language;
  setTheme: (theme: Theme) => void;
  setLanguage: (lang: Language) => void;
  
  // 当前页面
  currentPage: PageView;
  setCurrentPage: (page: PageView) => void;
  
  // Interface 数据
  projectInterface: ProjectInterface | null;
  interfaceTranslations: Record<string, Record<string, string>>;
  basePath: string;  // 资源基础路径，用于保存配置
  setProjectInterface: (pi: ProjectInterface) => void;
  setInterfaceTranslations: (lang: string, translations: Record<string, string>) => void;
  setBasePath: (path: string) => void;
  
  // 多开实例
  instances: Instance[];
  activeInstanceId: string | null;
  createInstance: (name?: string) => string;
  removeInstance: (id: string) => void;
  setActiveInstance: (id: string) => void;
  updateInstance: (id: string, updates: Partial<Instance>) => void;
  renameInstance: (id: string, newName: string) => void;
  
  // 获取活动实例
  getActiveInstance: () => Instance | null;
  
  // 任务操作
  addTaskToInstance: (instanceId: string, task: TaskItem) => void;
  removeTaskFromInstance: (instanceId: string, taskId: string) => void;
  reorderTasks: (instanceId: string, oldIndex: number, newIndex: number) => void;
  toggleTaskEnabled: (instanceId: string, taskId: string) => void;
  toggleTaskExpanded: (instanceId: string, taskId: string) => void;
  setTaskOptionValue: (instanceId: string, taskId: string, optionKey: string, value: OptionValue) => void;
  selectAllTasks: (instanceId: string, enabled: boolean) => void;
  collapseAllTasks: (instanceId: string, expanded: boolean) => void;
  renameTask: (instanceId: string, taskId: string, newName: string) => void;
  
  // 全局 UI 状态
  showAddTaskPanel: boolean;
  setShowAddTaskPanel: (show: boolean) => void;
  
  // 国际化文本解析
  resolveI18nText: (text: string | undefined, lang: string) => string;
  
  // 配置导入
  importConfig: (config: MxuConfig) => void;

  // MaaFramework 状态
  maaInitialized: boolean;
  maaVersion: string | null;
  setMaaInitialized: (initialized: boolean, version?: string) => void;
  
  // 实例运行时状态
  instanceConnectionStatus: Record<string, ConnectionStatus>;
  instanceResourceLoaded: Record<string, boolean>;
  instanceCurrentTaskId: Record<string, number | null>;
  instanceTaskStatus: Record<string, TaskStatus | null>;
  
  setInstanceConnectionStatus: (instanceId: string, status: ConnectionStatus) => void;
  setInstanceResourceLoaded: (instanceId: string, loaded: boolean) => void;
  setInstanceCurrentTaskId: (instanceId: string, taskId: number | null) => void;
  setInstanceTaskStatus: (instanceId: string, status: TaskStatus | null) => void;
  
  // 选中的控制器和资源
  selectedController: Record<string, string>;
  selectedResource: Record<string, string>;
  setSelectedController: (instanceId: string, controllerId: string) => void;
  setSelectedResource: (instanceId: string, resourceId: string) => void;
}

// 生成唯一 ID
const generateId = () => Math.random().toString(36).substring(2, 9);

// 创建默认选项值
const createDefaultOptionValue = (optionDef: OptionDefinition): OptionValue => {
  if (optionDef.type === 'input') {
    const values: Record<string, string> = {};
    optionDef.inputs.forEach(input => {
      values[input.name] = input.default || '';
    });
    return { type: 'input', values };
  }
  
  if (optionDef.type === 'switch') {
    const defaultCase = optionDef.default_case || optionDef.cases[1]?.name || 'No';
    const isYes = ['Yes', 'yes', 'Y', 'y'].includes(defaultCase);
    return { type: 'switch', value: isYes };
  }
  
  // select type (default)
  const defaultCase = optionDef.default_case || optionDef.cases[0]?.name || '';
  return { type: 'select', caseName: defaultCase };
};

export const useAppStore = create<AppState>()(
  subscribeWithSelector(
    (set, get) => ({
      // 主题和语言
      theme: 'light',
      language: 'zh-CN',
      setTheme: (theme) => {
        set({ theme });
        document.documentElement.classList.toggle('dark', theme === 'dark');
      },
      setLanguage: (lang) => {
        set({ language: lang });
        localStorage.setItem('mxu-language', lang);
      },
      
      // 当前页面
      currentPage: 'main',
      setCurrentPage: (page) => set({ currentPage: page }),
      
      // Interface 数据
      projectInterface: null,
      interfaceTranslations: {},
      basePath: '.',
      setProjectInterface: (pi) => set({ projectInterface: pi }),
      setInterfaceTranslations: (lang, translations) => set((state) => ({
        interfaceTranslations: {
          ...state.interfaceTranslations,
          [lang]: translations,
        },
      })),
      setBasePath: (path) => set({ basePath: path }),
      
      // 多开实例
      instances: [],
      activeInstanceId: null,
      
      createInstance: (name) => {
        const id = generateId();
        const instanceCount = get().instances.length;
        const pi = get().projectInterface;
        
        // 初始化默认选中的任务
        const defaultTasks: SelectedTask[] = [];
        if (pi) {
          pi.task.filter(t => t.default_check).forEach(task => {
            const optionValues: Record<string, OptionValue> = {};
            task.option?.forEach(optKey => {
              const optDef = pi.option?.[optKey];
              if (optDef) {
                optionValues[optKey] = createDefaultOptionValue(optDef);
              }
            });
            defaultTasks.push({
              id: generateId(),
              taskName: task.name,
              enabled: true,
              optionValues,
              expanded: false,
            });
          });
        }
        
        const newInstance: Instance = {
          id,
          name: name || `多开 ${instanceCount + 1}`,
          selectedTasks: defaultTasks,
          isRunning: false,
        };
        
        set((state) => ({
          instances: [...state.instances, newInstance],
          activeInstanceId: state.activeInstanceId || id,
        }));
        
        return id;
      },
      
      removeInstance: (id) => set((state) => {
        const newInstances = state.instances.filter(i => i.id !== id);
        let newActiveId = state.activeInstanceId;
        
        if (state.activeInstanceId === id) {
          newActiveId = newInstances.length > 0 ? newInstances[0].id : null;
        }
        
        return {
          instances: newInstances,
          activeInstanceId: newActiveId,
        };
      }),
      
      setActiveInstance: (id) => set({ activeInstanceId: id }),
      
      updateInstance: (id, updates) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === id ? { ...i, ...updates } : i
        ),
      })),
      
      renameInstance: (id, newName) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === id ? { ...i, name: newName } : i
        ),
      })),
      
      getActiveInstance: () => {
        const state = get();
        return state.instances.find(i => i.id === state.activeInstanceId) || null;
      },
      
      // 任务操作
      addTaskToInstance: (instanceId, task) => {
        const pi = get().projectInterface;
        if (!pi) return;
        
        const optionValues: Record<string, OptionValue> = {};
        task.option?.forEach(optKey => {
          const optDef = pi.option?.[optKey];
          if (optDef) {
            optionValues[optKey] = createDefaultOptionValue(optDef);
          }
        });
        
        const newTask: SelectedTask = {
          id: generateId(),
          taskName: task.name,
          enabled: true,
          optionValues,
          expanded: false,
        };
        
        set((state) => ({
          instances: state.instances.map(i => 
            i.id === instanceId 
              ? { ...i, selectedTasks: [...i.selectedTasks, newTask] }
              : i
          ),
        }));
      },
      
      removeTaskFromInstance: (instanceId, taskId) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? { ...i, selectedTasks: i.selectedTasks.filter(t => t.id !== taskId) }
            : i
        ),
      })),
      
      reorderTasks: (instanceId, oldIndex, newIndex) => set((state) => ({
        instances: state.instances.map(i => {
          if (i.id !== instanceId) return i;
          
          const tasks = [...i.selectedTasks];
          const [removed] = tasks.splice(oldIndex, 1);
          tasks.splice(newIndex, 0, removed);
          
          return { ...i, selectedTasks: tasks };
        }),
      })),
      
      toggleTaskEnabled: (instanceId, taskId) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map(t => 
                  t.id === taskId ? { ...t, enabled: !t.enabled } : t
                ),
              }
            : i
        ),
      })),
      
      toggleTaskExpanded: (instanceId, taskId) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map(t => 
                  t.id === taskId ? { ...t, expanded: !t.expanded } : t
                ),
              }
            : i
        ),
      })),
      
      setTaskOptionValue: (instanceId, taskId, optionKey, value) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map(t => 
                  t.id === taskId 
                    ? { ...t, optionValues: { ...t.optionValues, [optionKey]: value } }
                    : t
                ),
              }
            : i
        ),
      })),
      
      selectAllTasks: (instanceId, enabled) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map(t => ({ ...t, enabled })),
              }
            : i
        ),
      })),
      
      collapseAllTasks: (instanceId, expanded) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map(t => ({ ...t, expanded })),
              }
            : i
        ),
      })),
      
      renameTask: (instanceId, taskId, newName) => set((state) => ({
        instances: state.instances.map(i => 
          i.id === instanceId 
            ? {
                ...i,
                selectedTasks: i.selectedTasks.map(t => 
                  t.id === taskId ? { ...t, customName: newName || undefined } : t
                ),
              }
            : i
        ),
      })),
      
      // 全局 UI 状态
      showAddTaskPanel: false,
      setShowAddTaskPanel: (show) => set({ showAddTaskPanel: show }),
      
      // 国际化文本解析
      resolveI18nText: (text, lang) => {
        if (!text) return '';
        if (!text.startsWith('$')) return text;
        
        const key = text.slice(1);
        const translations = get().interfaceTranslations[lang];
        return translations?.[key] || key;
      },
      
      // 配置导入
      importConfig: (config) => {
        const instances: Instance[] = config.instances.map(inst => ({
          id: inst.id,
          name: inst.name,
          controllerId: inst.controllerId,
          resourceId: inst.resourceId,
          selectedTasks: inst.tasks.map(t => ({
            id: t.id,
            taskName: t.taskName,
            customName: t.customName,
            enabled: t.enabled,
            optionValues: t.optionValues,
            expanded: false,
          })),
          isRunning: false,
        }));
        
        set({
          instances,
          activeInstanceId: instances.length > 0 ? instances[0].id : null,
          theme: config.settings.theme,
          language: config.settings.language,
        });
        
        document.documentElement.classList.toggle('dark', config.settings.theme === 'dark');
        localStorage.setItem('mxu-language', config.settings.language);
      },

      // MaaFramework 状态
      maaInitialized: false,
      maaVersion: null,
      setMaaInitialized: (initialized, version) => set({
        maaInitialized: initialized,
        maaVersion: version || null,
      }),

      // 实例运行时状态
      instanceConnectionStatus: {},
      instanceResourceLoaded: {},
      instanceCurrentTaskId: {},
      instanceTaskStatus: {},

      setInstanceConnectionStatus: (instanceId, status) => set((state) => ({
        instanceConnectionStatus: {
          ...state.instanceConnectionStatus,
          [instanceId]: status,
        },
      })),

      setInstanceResourceLoaded: (instanceId, loaded) => set((state) => ({
        instanceResourceLoaded: {
          ...state.instanceResourceLoaded,
          [instanceId]: loaded,
        },
      })),

      setInstanceCurrentTaskId: (instanceId, taskId) => set((state) => ({
        instanceCurrentTaskId: {
          ...state.instanceCurrentTaskId,
          [instanceId]: taskId,
        },
      })),

      setInstanceTaskStatus: (instanceId, status) => set((state) => ({
        instanceTaskStatus: {
          ...state.instanceTaskStatus,
          [instanceId]: status,
        },
      })),

      // 选中的控制器和资源
      selectedController: {},
      selectedResource: {},

      setSelectedController: (instanceId, controllerId) => set((state) => ({
        selectedController: {
          ...state.selectedController,
          [instanceId]: controllerId,
        },
      })),

      setSelectedResource: (instanceId, resourceId) => set((state) => ({
        selectedResource: {
          ...state.selectedResource,
          [instanceId]: resourceId,
        },
      })),
    })
  )
);

// 生成配置用于保存
function generateConfig(): MxuConfig {
  const state = useAppStore.getState();
  return {
    version: '1.0',
    instances: state.instances.map(inst => ({
      id: inst.id,
      name: inst.name,
      controllerId: inst.controllerId,
      resourceId: inst.resourceId,
      tasks: inst.selectedTasks.map(t => ({
        id: t.id,
        taskName: t.taskName,
        customName: t.customName,
        enabled: t.enabled,
        optionValues: t.optionValues,
      })),
    })),
    settings: {
      theme: state.theme,
      language: state.language,
    },
  };
}

// 防抖保存配置
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedSaveConfig() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    const state = useAppStore.getState();
    const config = generateConfig();
    saveConfig(state.basePath, config);
  }, 500);
}

// 订阅需要保存的状态变化
useAppStore.subscribe(
  (state) => ({
    instances: state.instances,
    activeInstanceId: state.activeInstanceId,
    theme: state.theme,
    language: state.language,
  }),
  () => {
    debouncedSaveConfig();
  },
  { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
);
