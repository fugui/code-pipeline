import React from 'react'
import { AUTH_TOKEN_KEY } from '@code/common'
import { Trash2, CheckCircle2, XCircle, Loader2, Copy, Check, ClipboardPaste, HelpCircle, FileCode, GitBranch, GitMerge, Clock, RefreshCw, Lock } from 'lucide-react'

interface ExecutionSchemeModalProps {
  isAdmin?: boolean
  visible: boolean
  activeScheme: any | null
  onChange: (scheme: any) => void
  onSave: (e: React.FormEvent) => void
  onClose: () => void
  apiBase: string
  repos: any[]
  pipelines: any[]
  saving?: boolean
  saveError?: string | null
  saveSuccess?: boolean
  onSuccessClose?: () => void
}

const isReservedAttrKey = (keyName: string) => {
  const k = (keyName || '').trim().toLowerCase();
  return k === 'code_checker_task_id' || 
         k === 'repository' || 
         k === 'branch' || 
         k === 'selectedbranchs' || 
         k === 'languages' || 
         k === 'codehubtargetrepohttpurl' || 
         k === 'build_type';
};

const getRandomDailyBuildTime = () => {
  const totalMinutes = Math.floor(Math.random() * 480);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hour)}:${pad(minute)}`;
};

const generateDefaultSchemeName = (repoName: string) => {
  const lastPart = (repoName || 'scheme').split('/').pop() || repoName || 'scheme';
  const cleanRepo = lastPart
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  
  const randomSuffix = Math.random().toString(16).substring(2, 6);
  let res = `${cleanRepo || 'scheme'}_${randomSuffix}`;
  if (!/^[a-zA-Z]/.test(res)) {
    res = `s_${res}`;
  }
  return res;
};

export const ExecutionSchemeModal: React.FC<ExecutionSchemeModalProps> = ({
  isAdmin = true,
  visible,
  activeScheme,
  onChange,
  onSave,
  onClose,
  apiBase,
  repos,
  pipelines = [],
  saving = false,
  saveError = null,
  saveSuccess = false,
  onSuccessClose
}) => {
  const isView = !!activeScheme?.id
  const [filterQuery, setFilterQuery] = React.useState('')
  const [branches, setBranches] = React.useState<string[]>([])
  const [loadingBranches, setLoadingBranches] = React.useState(false)
  const [customAttrs, setCustomAttrs] = React.useState<{ key: string; value: string }[]>([]);
  const [animateVisible, setAnimateVisible] = React.useState(false);
  const [orderedBranches, setOrderedBranches] = React.useState<string[]>([]);
  const [showPasteModal, setShowPasteModal] = React.useState(false);
  const [pasteContent, setPasteContent] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [isManualBranchMode, setIsManualBranchMode] = React.useState(false);
  const [manualBranchText, setManualBranchText] = React.useState('');

  const [mrTrigger, setMrTrigger] = React.useState(true);
  const [dailyBuild, setDailyBuild] = React.useState(true);
  const [dailyBuildTime, setDailyBuildTime] = React.useState(getRandomDailyBuildTime);
  const [buildTypes, setBuildTypes] = React.useState<string[]>(['SCH']);
  const lastCustomAttrsRef = React.useRef('');  const [searchedRepos, setSearchedRepos] = React.useState<any[]>(repos)
  // 打开弹窗时记录的原始编程语言，用于区分"清空已有语言"与"旧方案原本就没有语言"
  const originalLanguagesRef = React.useRef('')

  React.useEffect(() => {
    if (visible) {
      setSearchedRepos(repos);
      setLocalError(null);
    }
  }, [visible, repos]);

  React.useEffect(() => {
    if (visible && activeScheme) {
      originalLanguagesRef.current = activeScheme.languages || '';
      const currentBranchStr = activeScheme.branchs || '';
      setManualBranchText(currentBranchStr);
      // 如果现有生效分支字符串包含 * 或 ? 通配符，自动切至手动录入模式
      if (/[*?]/.test(currentBranchStr)) {
        setIsManualBranchMode(true);
      }

      const hasMrTrigger = activeScheme.hasOwnProperty('mr_trigger') && activeScheme.mr_trigger !== null ? (String(activeScheme.mr_trigger) === 'true') : true;
      const hasDailyBuild = activeScheme.hasOwnProperty('daily_build') && activeScheme.daily_build !== null ? (String(activeScheme.daily_build) === 'true') : true;
      const hasDailyBuildTime = activeScheme.daily_build_time || getRandomDailyBuildTime();

      setMrTrigger(hasMrTrigger);
      setDailyBuild(hasDailyBuild);
      setDailyBuildTime(hasDailyBuildTime);

      let parsedAttrs = activeScheme.custom_attributes;
      if (parsedAttrs !== lastCustomAttrsRef.current) {
        lastCustomAttrsRef.current = parsedAttrs || '';
        try {
          let parsed: any = JSON.parse(parsedAttrs || '{}');
          if (typeof parsed === 'string') {
            try {
              parsed = JSON.parse(parsed);
            } catch (_) {}
          }
          const buildParams = Array.isArray(parsed?.buildParameters) ? parsed.buildParameters : [];
          
          const buildTypeParam = buildParams.find((item: any) => item.name && String(item.name).trim().toLowerCase() === 'build_type');
          if (buildTypeParam && buildTypeParam.value !== undefined && buildTypeParam.value !== null) {
            const codes = String(buildTypeParam.value).split(',').map((s: string) => s.trim()).filter(Boolean);
            setBuildTypes(codes.length > 0 ? codes : ['SCH']);
          } else {
            setBuildTypes(['SCH']);
          }

          const list = buildParams
            .filter((item: any) => item.name && !isReservedAttrKey(String(item.name)))
            .map((item: any) => ({
              key: String(item.name || '').trim(),
              value: String(item.value !== undefined && item.value !== null ? item.value : '')
            }));
          setCustomAttrs(list);
        } catch (e) {
          setCustomAttrs([]);
        }
      }

      // 原子补齐初始化缺少的基础字段，防止并发 onChange 互相覆盖
      let updatedScheme = { ...activeScheme };
      let needsUpdate = false;

      if (!updatedScheme.id && !updatedScheme.name) {
        const repoObj = repos.find(r => r.id === updatedScheme.repository_id) || searchedRepos.find(r => r.id === updatedScheme.repository_id) || updatedScheme.repository;
        const repoName = repoObj ? repoObj.name : (filterQuery || 'scheme');
        updatedScheme.name = generateDefaultSchemeName(repoName);
        needsUpdate = true;
      }

      if (updatedScheme.mr_trigger === undefined || updatedScheme.daily_build === undefined || updatedScheme.daily_build_time === undefined) {
        updatedScheme.mr_trigger = hasMrTrigger;
        updatedScheme.daily_build = hasDailyBuild;
        updatedScheme.daily_build_time = hasDailyBuildTime;
        needsUpdate = true;
      }

      if (!updatedScheme.id && !updatedScheme.languages) {
        const repoObj = repos.find(r => r.id === updatedScheme.repository_id) || searchedRepos.find(r => r.id === updatedScheme.repository_id) || updatedScheme.repository;
        const existingSchemes = (repoObj?.schemes || []).filter((s: any) => s.id);
        const existingWithLangs = existingSchemes.find((s: any) => (s.languages || '').trim());
        const inheritLangs = existingWithLangs?.languages || repoObj?.schemes?.[0]?.languages || '';
        if (inheritLangs) {
          updatedScheme.languages = inheritLangs;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        onChange(updatedScheme);
      }
    }
  }, [visible, activeScheme?.id, activeScheme?.repository_id, activeScheme?.custom_attributes]);

  React.useEffect(() => {
    if (activeScheme && activeScheme.repository_id) {
      const found = repos.find(r => r.id === activeScheme.repository_id) || activeScheme.repository
      if (found) {
        setFilterQuery(found.name)
      }
    } else if (!activeScheme) {
      setFilterQuery('')
    }
  }, [activeScheme, repos])

  React.useEffect(() => {
    if (activeScheme && activeScheme.repository_id) {
      setLoadingBranches(true);
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      fetch(`${apiBase}/repos/${activeScheme.repository_id}/branches`, {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      })
      .then(res => {
        if (!res.ok) {
          throw new Error('Failed to fetch branches');
        }
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          setBranches(data);
        } else {
          setBranches([]);
        }
      })
      .catch(err => {
        console.error('Failed to fetch branches', err);
        setBranches([]);
      })
      .finally(() => {
        setLoadingBranches(false);
      });
      } else {
        setBranches([]);
      }
    }, [activeScheme?.repository_id, apiBase])

  const [repoExistingSchemes, setRepoExistingSchemes] = React.useState<any[]>([])

  React.useEffect(() => {
    if (visible && activeScheme && activeScheme.repository_id) {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      fetch(`${apiBase}/execution-schemes?repository_id=${activeScheme.repository_id}`, {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      })
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          setRepoExistingSchemes(data);
          // 如果是新建方案模式，且当前方案尚未填入语言，且已有方案中存在语言配置，自动继承
          if (!activeScheme.id) {
            const otherSchemes = data.filter((s: any) => s.id !== activeScheme.id);
            const schemeWithLangs = otherSchemes.find((s: any) => (s.languages || '').trim());
            const inheritLangs = schemeWithLangs?.languages || otherSchemes[0]?.languages || '';
            if (inheritLangs && (!activeScheme.languages || activeScheme.languages !== inheritLangs)) {
              onChange({
                ...activeScheme,
                languages: inheritLangs
              });
            }
          }
        }
      })
      .catch(err => {
        console.error('Failed to fetch repo existing schemes', err);
      });
    } else if (!visible) {
      setRepoExistingSchemes([]);
    }
  }, [visible, activeScheme?.repository_id, activeScheme?.id, apiBase]);

  React.useEffect(() => {
    if (activeScheme) {
      const activeBranches = activeScheme.branchs ? activeScheme.branchs.split(',').filter(Boolean) : [];
      const allOpts = Array.from(new Set([...branches, ...activeBranches])).filter(Boolean);

      const sortBranches = (a: string, b: string) => {
        const aChecked = activeBranches.includes(a);
        const bChecked = activeBranches.includes(b);
        if (aChecked && !bChecked) return -1;
        if (!aChecked && bChecked) return 1;

        const isMasterOrMain = (name: string) => name === 'master' || name === 'main';
        const aMasterOrMain = isMasterOrMain(a);
        const bMasterOrMain = isMasterOrMain(b);
        if (aMasterOrMain && !bMasterOrMain) return -1;
        if (!aMasterOrMain && bMasterOrMain) return 1;
        if (aMasterOrMain && bMasterOrMain) return a.localeCompare(b);

        const aDevelop = a === 'develop';
        const bDevelop = b === 'develop';
        if (aDevelop && !bDevelop) return -1;
        if (!aDevelop && bDevelop) return 1;
        if (aDevelop && bDevelop) return 0;

        const isFea = (name: string) => name.toLowerCase().startsWith('fea');
        const aFea = isFea(a);
        const bFea = isFea(b);
        if (aFea && !bFea) return -1;
        if (!aFea && bFea) return 1;
        if (aFea && bFea) return a.localeCompare(b);

        return a.localeCompare(b);
      };

      setOrderedBranches(allOpts.sort(sortBranches));
    } else {
      setOrderedBranches([]);
    }
  }, [branches, visible, activeScheme?.id]);

  React.useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        setAnimateVisible(true);
      }, 30);
      return () => clearTimeout(timer);
    } else {
      setAnimateVisible(false);
    }
  }, [visible]);

  if (!visible || !activeScheme) return null

  const handleCloseWithAnimation = () => {
    setAnimateVisible(false);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const selectedRepo = searchedRepos.find(r => r.id === activeScheme.repository_id) || activeScheme.repository
  const existingRepoSchemes = (selectedRepo?.schemes || []).filter((s: any) => s.id && s.id !== activeScheme?.id)
  const allExistingSchemes = repoExistingSchemes.length > 0 
    ? repoExistingSchemes.filter((s: any) => s.id && s.id !== activeScheme?.id) 
    : existingRepoSchemes
  const existingSchemeWithLangs = allExistingSchemes.find((s: any) => (s.languages || '').trim())
  const existingCheckerTaskId = selectedRepo?.code_checker_task_id || allExistingSchemes.find((s: any) => s.code_checker_task_id)?.code_checker_task_id
  const hasExistingChecker = Boolean(existingCheckerTaskId || existingSchemeWithLangs || allExistingSchemes.length > 0)
  const isInheritedMode = !isView ? hasExistingChecker : false

  const updateCustomAttrs = (newList: { key: string; value: string }[], types: string[] = buildTypes) => {
    const cleanList = newList.filter(item => !isReservedAttrKey(item.key));
    setCustomAttrs(cleanList);
    let parsed: Record<string, any> = {};
    try {
      let raw = JSON.parse(activeScheme.custom_attributes || '{}');
      if (typeof raw === 'string') raw = JSON.parse(raw);
      parsed = raw || {};
    } catch (e) {
      parsed = {};
    }

    const buildParameters = cleanList
      .filter(item => item.key.trim())
      .map(item => ({
        name: item.key.trim(),
        value: item.value
      }));
    // 追加 build_type（多选，逗号分隔 code）
    buildParameters.push({ name: 'build_type', value: types.join(',') });

    parsed.buildParameters = buildParameters;

    const serialized = JSON.stringify(parsed);
    lastCustomAttrsRef.current = serialized;
    onChange({
      ...activeScheme,
      custom_attributes: serialized,
      mr_trigger: mrTrigger,
      daily_build: dailyBuild,
      daily_build_time: dailyBuildTime
    });
  };

  const handleBuildTypeChange = (code: string, checked: boolean) => {
    const newTypes = checked
      ? [...buildTypes, code]
      : buildTypes.filter(t => t !== code);
    setBuildTypes(newTypes);
    if (localError) setLocalError(null);
    updateCustomAttrs(customAttrs, newTypes);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    // 0. 校验执行方案名称必填
    if (!activeScheme.name || !activeScheme.name.trim()) {
      setLocalError('保存失败：执行方案名称 (name) 为必填项，不能为空');
      return;
    }

    // 0.5 校验 MR 触发分支：仅当开启 MR 触发时要求分支必填
    if (mrTrigger && (!activeScheme.branchs || !activeScheme.branchs.trim())) {
      setLocalError('保存失败：已开启“MR触发”，请至少选择或手动录入一个生效触发分支 (branchs)');
      return;
    }

    // 1. 校验构建类型是否为空
    if (buildTypes.length === 0) {
      setLocalError('保存失败：请至少选择一种构建类型 (build_type)');
      return;
    }

    // 2. 校验每日构建时间（开启每日构建时时间必填，避免清空后静默无效）
    if (dailyBuild && !dailyBuildTime) {
      setLocalError('保存失败：开启每日构建时，请选择每日构建时间');
      return;
    }

    // 2.5 校验编程语言：禁止清空原本已有的语言（与后端一致）；
    // 语言为空的旧方案（历史上未配置语言）允许保存其他修改
    const originalLangs = originalLanguagesRef.current || '';
    if (originalLangs.trim() && !(activeScheme.languages || '').trim()) {
      setLocalError('保存失败：请至少选择一种编程语言');
      return;
    }

    // 3. 校验参数名重复 (系统相同名字的参数只能存在一份)
    const nameCounts = new Map<string, number>();
    for (const item of customAttrs) {
      const keyName = item.key.trim();
      if (!keyName) continue;

      if (isReservedAttrKey(keyName)) {
        setLocalError(`保存失败：构建参数 "${keyName}" 为系统保留字段，请通过顶层设置选项进行配置`);
        return;
      }

      const count = (nameCounts.get(keyName) || 0) + 1;
      if (count > 1) {
        setLocalError(`保存失败：构建参数中存在重复的参数名 "${keyName}"，系统只允许存在一份`);
        return;
      }
      nameCounts.set(keyName, count);
    }

    onSave(e);
  };

  const handleTriggerOrTimeChange = (newMrTrigger: boolean, newDailyBuild: boolean, newTime: string) => {
    setMrTrigger(newMrTrigger);
    setDailyBuild(newDailyBuild);
    setDailyBuildTime(newTime);
    if (localError) setLocalError(null);
    
    onChange({
      ...activeScheme,
      mr_trigger: newMrTrigger,
      daily_build: newDailyBuild,
      daily_build_time: newTime
    });
  };

  const handlePasteAttrs = () => {
    const lines = pasteContent.split('\n');
    const parsedAttrs: { key: string; value: string }[] = [];
    let pastedBuildTypes: string[] | null = null;
    
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      
      let key = '';
      let value = '';
      
      const eqIdx = trimmed.indexOf('=');
      const colonIdx = trimmed.indexOf(':');
      
      if (eqIdx !== -1 && (colonIdx === -1 || eqIdx < colonIdx)) {
        key = trimmed.substring(0, eqIdx).trim();
        value = trimmed.substring(eqIdx + 1).trim();
      } else if (colonIdx !== -1) {
        key = trimmed.substring(0, colonIdx).trim();
        value = trimmed.substring(colonIdx + 1).trim();
      } else {
        key = trimmed;
        value = '';
      }
      
      if (key) {
        if (isReservedAttrKey(key)) {
          if (key.trim().toLowerCase() === 'build_type') {
            pastedBuildTypes = value.split(',').map((s: string) => s.trim()).filter(Boolean);
          }
        } else {
          parsedAttrs.push({ key, value });
        }
      }
    });

    let currentBuildTypes = buildTypes;
    if (pastedBuildTypes !== null) {
      currentBuildTypes = pastedBuildTypes;
      setBuildTypes(pastedBuildTypes);
      if (localError) setLocalError(null);
    }

    const updatedAttrs = [...customAttrs];
    parsedAttrs.forEach(newAttr => {
      const idx = updatedAttrs.findIndex(item => item.key.trim() === newAttr.key);
      if (idx !== -1) {
        updatedAttrs[idx] = newAttr;
      } else {
        updatedAttrs.push(newAttr);
      }
    });

    updateCustomAttrs(updatedAttrs, currentBuildTypes);
    
    setPasteContent('');
    setShowPasteModal(false);
  };

  const isSensitiveParamKey = (key: string): boolean => {
    if (!key) return false;
    const lower = key.toLowerCase();
    return lower.includes('password') || lower.includes('passwd') || lower.includes('pwd') || lower.includes('secret');
  };

  const handleCopyAttrs = () => {
    const textToCopy = customAttrs
      .filter(item => item.key.trim() !== '' || item.value.trim() !== '')
      .map(item => {
        const val = (!isAdmin && isSensitiveParamKey(item.key)) ? (item.value.trim() ? '******' : '') : item.value.trim();
        return `${item.key.trim()}=${val}`;
      })
      .join('\n');

    const copyToClipboard = (text: string) => {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        return new Promise<void>((resolve, reject) => {
          const successful = document.execCommand('copy');
          textArea.remove();
          if (successful) {
            resolve();
          } else {
            reject(new Error('Copy failed'));
          }
        });
      }
    };

    copyToClipboard(textToCopy)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => {
        console.error('复制参数失败:', err);
      });
  };

  return (
    <div 
      style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        right: 0, 
        bottom: 0, 
        background: 'rgba(0,0,0,0.4)', 
        backdropFilter: 'blur(4px)', 
        zIndex: 1000,
        opacity: animateVisible ? 1 : 0,
        transition: 'opacity 300ms ease-out',
        pointerEvents: animateVisible ? 'auto' : 'none'
      }}
      onClick={saving ? undefined : handleCloseWithAnimation}
    >
      <div 
        style={{ 
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          maxWidth: 640,
          background: 'var(--bg-secondary, #111827)',
          borderLeft: '1px solid var(--border-color, rgba(255,255,255,0.08))',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.4)',
          zIndex: 1001,
          transform: animateVisible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '20px 24px', 
          borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))' 
        }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            {activeScheme?.id ? '查看/修改仓库执行方案' : '新增仓库执行方案'}
          </h3>
          <button 
            type="button" 
            disabled={saving}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'var(--text-secondary)', 
              fontSize: 24, 
              cursor: saving ? 'not-allowed' : 'pointer', 
              padding: '4px 8px',
              lineHeight: 1,
              opacity: saving ? 0.3 : 1
            }} 
            onClick={saving ? undefined : handleCloseWithAnimation}
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          {saving && <SyncProgressOverlay isEdit={isView} />}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>关联流水线</label>
              {activeScheme.id ? (
                <input 
                  type="text" 
                  value={(() => {
                    const matched = pipelines.find(p => p.id === activeScheme.pipeline_id);
                    if (matched) {
                      return `${matched.name} (ID: ${matched.pipeline_id}) - 负责人: ${matched.owner || '未分配'}`;
                    }
                    return `流水线 ID: ${activeScheme.pipeline_id}`;
                  })()}
                  disabled 
                />
              ) : (
                <select
                  value={activeScheme.pipeline_id || ''}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : 0;
                    onChange({
                      ...activeScheme,
                      pipeline_id: val
                    });
                  }}
                  required
                >
                  <option value="" disabled>-- 请选择关联的流水线 --</option>
                  {pipelines.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} (ID: {p.pipeline_id}) - 负责人: {p.owner || '未分配'}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  执行方案名称 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {activeScheme.id ? '方案唯一标识名称' : '新建时系统已预生成默认名称，可按需修改'}
                </span>
              </div>
              <input 
                type="text" 
                value={activeScheme.name || ''}
                disabled={!isAdmin}
                placeholder="请输入执行方案名称 (例如: demo_service_a1b2)"
                required
                onChange={(e) => {
                  onChange({
                    ...activeScheme,
                    name: e.target.value
                  });
                }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>代码仓</label>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>构建类型 (多选)</label>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <input 
                    type="text" 
                    value={activeScheme.id ? (selectedRepo ? `${selectedRepo.name} (${selectedRepo.url})` : '未绑定仓库') : (selectedRepo ? selectedRepo.name : (filterQuery || '未绑定仓库'))}
                    disabled
                    style={{ width: '100%', cursor: 'not-allowed' }}
                  />
                </div>
                <div style={{
                  flex: 1,
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  padding: '0 12px',
                  background: 'rgba(255,255,255,0.01)',
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 20,
                  height: 36
                }}>
                  {([{ code: 'SCH', label: '上位机' }, { code: 'LCH', label: '下位机' }, { code: 'DHH', label: '数据机' }] as { code: string; label: string }[]).map(({ code, label }) => (
                    <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-main)', userSelect: 'none', margin: 0, whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={buildTypes.includes(code)}
                        style={{ width: 'auto', margin: 0 }}
                        onChange={(e) => handleBuildTypeChange(code, e.target.checked)}
                      />
                      {label} ({code})
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>MR触发生效分支</span>
                    {mrTrigger ? (
                      <span style={{ fontSize: 11, color: '#f87171', fontWeight: 600 }}>* (必选)</span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(可选)</span>
                    )}
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none', margin: 0 }}>
                    <input 
                      type="checkbox" 
                      checked={isManualBranchMode}
                      disabled={!isAdmin}
                      style={{ width: 'auto', margin: 0 }}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsManualBranchMode(checked);
                        if (checked) {
                          setManualBranchText(activeScheme?.branchs || '');
                        }
                      }}
                    />
                    手动录入 (支持通配符)
                  </label>
                </div>

                {isManualBranchMode ? (
                  <div>
                    <textarea
                      value={manualBranchText}
                      disabled={!isAdmin}
                      placeholder={mrTrigger ? "请输入MR触发生效分支或通配符规则，如: master, develop, feature/* (必填)" : "可选输入生效分支或通配符规则，如: master, develop (可选)"}
                      style={{
                        width: '100%',
                        height: 110,
                        padding: '8px 10px',
                        fontSize: 13,
                        fontFamily: 'monospace, sans-serif',
                        background: 'rgba(255,255,255,0.01)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 6,
                        color: 'var(--text-main)',
                        resize: 'none',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                      onChange={(e) => {
                        const val = e.target.value;
                        setManualBranchText(val);
                        const cleanBranchs = val
                          .split(/[\r\n,\uFF0C]+/)
                          .map(s => s.trim())
                          .filter(Boolean)
                          .join(',');
                        
                        let parsed: Record<string, any> = {};
                        try {
                          parsed = JSON.parse(activeScheme.custom_attributes || '{}');
                        } catch (err) {
                          parsed = {};
                        }
                        let buildParameters = Array.isArray(parsed.buildParameters) ? parsed.buildParameters : [];
                        let found = false;
                        buildParameters = buildParameters.map((item: any) => {
                          if (item.name === 'selectedBranchs') {
                            found = true;
                            return { ...item, value: cleanBranchs };
                          }
                          return item;
                        });
                        if (!found) {
                          buildParameters.push({ name: 'selectedBranchs', value: cleanBranchs });
                        }
                        parsed.buildParameters = buildParameters;
                        const serialized = JSON.stringify(parsed);
                        lastCustomAttrsRef.current = serialized;

                        onChange({ 
                          ...activeScheme, 
                          branchs: cleanBranchs,
                          custom_attributes: serialized
                        });
                      }}
                    />
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>💡 提示：支持精确名称（如 master）或通配符规则（如 feature/*）。{mrTrigger ? '开启 MR 触发时必须指定生效分支。' : '当前未开启 MR 触发，分支为可选配置。'}</span>
                    </div>
                  </div>
                ) : (
                  loadingBranches ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', borderRadius: 6, background: 'rgba(255,255,255,0.01)' }}>正在加载分支...</div>
                  ) : (
                    <div style={{ 
                      border: '1px solid var(--border-color)', 
                      borderRadius: 6, 
                      padding: '10px 12px', 
                      height: 168, 
                      overflowY: 'auto',
                      background: 'rgba(255,255,255,0.01)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      direction: 'rtl'
                    }}>
                      <div style={{ direction: 'ltr', display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                        {(() => {
                          const activeBranches = activeScheme.branchs ? activeScheme.branchs.split(',').filter(Boolean) : [];
                          if (orderedBranches.length === 0) {
                            return <span style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 32, display: 'block', width: '100%' }}>暂无分支，请先选择代码仓或勾选“手动录入”</span>;
                          }
                          return orderedBranches.map(branch => {
                            const checked = activeBranches.includes(branch);
                            return (
                              <label key={branch} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-main)', userSelect: 'none' }}>
                                <input 
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!isAdmin}
                                  style={{ width: 'auto', margin: 0 }}
                                  onChange={(e) => {
                                    let current = activeScheme.branchs ? activeScheme.branchs.split(',').filter(Boolean) : [];
                                    if (e.target.checked) {
                                      if (!current.includes(branch)) {
                                        current.push(branch);
                                      }
                                    } else {
                                      current = current.filter((x: string) => x !== branch);
                                    }
                                    const updatedBranchs = current.join(',');
                                    setManualBranchText(updatedBranchs);
                                    
                                    let parsed: Record<string, any> = {};
                                    try {
                                      parsed = JSON.parse(activeScheme.custom_attributes || '{}');
                                    } catch (err) {
                                      parsed = {};
                                    }
                                    let buildParameters = Array.isArray(parsed.buildParameters) ? parsed.buildParameters : [];
                                    let found = false;
                                    buildParameters = buildParameters.map((item: any) => {
                                      if (item.name === 'selectedBranchs') {
                                        found = true;
                                        return { ...item, value: updatedBranchs };
                                      }
                                      return item;
                                    });
                                    if (!found) {
                                      buildParameters.push({ name: 'selectedBranchs', value: updatedBranchs });
                                    }
                                    parsed.buildParameters = buildParameters;
                                    const serialized = JSON.stringify(parsed);
                                    lastCustomAttrsRef.current = serialized;

                                    onChange({ 
                                      ...activeScheme, 
                                      branchs: updatedBranchs,
                                      custom_attributes: serialized
                                    });
                                  }}
                                />
                                {branch}
                              </label>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )
                )}
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>支持的编程语言</span>
                    {isInheritedMode ? (
                      <span style={{ fontSize: 11, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.25)', padding: '1px 6px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Lock size={10} /> 已继承代码仓配置
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(多选)</span>
                    )}
                  </label>
                </div>
                <div style={{ 
                  border: isInheritedMode ? '1px dashed rgba(56, 189, 248, 0.35)' : '1px solid var(--border-color)', 
                  borderRadius: 6, 
                  padding: '10px 12px', 
                  height: 168, 
                  background: isInheritedMode ? 'rgba(56, 189, 248, 0.02)' : 'rgba(255,255,255,0.01)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  justifyContent: 'center',
                  position: 'relative'
                }}>
                  {['C', 'C++', 'Python', 'Java', 'JavaScript'].map((lang) => {
                    const activeLangs = (activeScheme.languages || (isInheritedMode ? (existingSchemeWithLangs?.languages || '') : '')).split(',').filter(Boolean);
                    const checked = activeLangs.includes(lang);
                    return (
                      <label 
                        key={lang} 
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 8, 
                          cursor: isInheritedMode || !isAdmin ? 'not-allowed' : 'pointer', 
                          fontSize: 13, 
                          color: checked ? 'var(--text-main)' : 'var(--text-muted)', 
                          opacity: isInheritedMode && !checked ? 0.4 : 1,
                          userSelect: 'none' 
                        }}
                      >
                        <input 
                          type="checkbox" 
                          checked={checked}
                          disabled={isInheritedMode || !isAdmin}
                          style={{ width: 'auto', margin: 0, cursor: isInheritedMode || !isAdmin ? 'not-allowed' : 'pointer' }}
                          onChange={(e) => {
                            if (isInheritedMode) return;
                            let current = activeScheme.languages ? activeScheme.languages.split(',') : [];
                            if (e.target.checked) {
                              if (!current.includes(lang)) current.push(lang);
                            } else {
                              current = current.filter((x: string) => x !== lang);
                            }
                            onChange({ ...activeScheme, languages: current.filter(Boolean).join(',') });
                          }}
                        />
                        {lang}
                      </label>
                    );
                  })}
                </div>
                {isInheritedMode && (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>💡 该代码仓已建立静态检查任务，所有方案共享相同扫描语言基线</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>触发配置</label>
              <div style={{ 
                border: '1px solid var(--border-color)', 
                borderRadius: 6, 
                padding: '14px 16px', 
                background: 'rgba(255,255,255,0.01)', 
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                alignItems: 'center',
                gap: 16
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-main)', userSelect: 'none', margin: 0 }}>
                  <input 
                    type="checkbox" 
                    checked={mrTrigger}
                    disabled={!isAdmin}
                    style={{ width: 'auto', margin: 0 }}
                    onChange={(e) => handleTriggerOrTimeChange(e.target.checked, dailyBuild, dailyBuildTime)}
                  />
                  MR触发
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-main)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', margin: 0 }}>
                    <input 
                      type="checkbox" 
                      checked={dailyBuild}
                      disabled={!isAdmin}
                      style={{ width: 'auto', margin: 0 }}
                      onChange={(e) => handleTriggerOrTimeChange(mrTrigger, e.target.checked, dailyBuildTime)}
                    />
                    <span>每日构建</span>
                  </label>
                  <input 
                    type="time" 
                    value={dailyBuildTime}
                    disabled={!dailyBuild || !isAdmin}
                    style={{ 
                      width: 100, 
                      padding: '4px 8px', 
                      fontSize: 13, 
                      height: 32, 
                      background: 'var(--bg-secondary, #111827)', 
                      border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
                      borderRadius: 4,
                      color: 'var(--text-main)',
                      marginLeft: 4,
                      opacity: dailyBuild ? 1 : 0.4,
                      cursor: dailyBuild ? 'text' : 'not-allowed',
                      transition: 'opacity 0.2s ease, border-color 0.2s ease'
                    }}
                    onChange={(e) => handleTriggerOrTimeChange(mrTrigger, dailyBuild, e.target.value)}
                  />
                  <span 
                    style={{ 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      color: '#0284c7', 
                      cursor: 'help',
                      marginLeft: 2
                    }} 
                    title="提示：建议将每日构建时间尽量分散错峰设置，避免高峰期并发集中导致资源争抢和流水线概率性构建失败。"
                  >
                    <HelpCircle size={14} />
                  </span>
                </div>
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 200 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>构建参数</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '4px 10px', fontSize: 12, height: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    onClick={handleCopyAttrs}
                    title="复制全部参数到剪贴板"
                  >
                    {copied ? (
                      <>
                        <Check size={13} style={{ color: '#34d399' }} />
                        <span style={{ color: '#34d399' }}>已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} />
                        复制参数
                      </>
                    )}
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: 12, height: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        onClick={() => setShowPasteModal(true)}
                      >
                        <ClipboardPaste size={13} />
                        粘贴参数
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: 12, height: 'auto' }}
                        onClick={() => {
                          const newList = [...customAttrs, { key: '', value: '' }];
                          updateCustomAttrs(newList);
                        }}
                      >
                        + 添加参数
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div style={{ 
                border: '1px solid var(--border-color)', 
                borderRadius: 6, 
                background: 'rgba(255,255,255,0.01)', 
                flex: 1,
                overflowY: 'auto',
                direction: 'rtl'
              }}>
                <div style={{ direction: 'ltr', width: '100%' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px', width: '45%' }}>参数名 (Name)</th>
                        <th style={{ padding: '8px 12px', width: '45%' }}>参数值 (Value)</th>
                        <th style={{ padding: '8px 12px', width: '10%', textAlign: 'center' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customAttrs.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                            暂无构建参数{isAdmin ? '，点击右上角“添加参数”新增' : ''}
                          </td>
                        </tr>
                      ) : (
                        customAttrs.map((item, index) => {
                          const isSensitive = !isAdmin && isSensitiveParamKey(item.key);
                          const displayValue = isSensitive ? (item.value ? '******' : '') : item.value;

                          return (
                            <tr key={index} style={{ borderBottom: index === customAttrs.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)' }}>
                              <td style={{ padding: '4px 8px' }}>
                                <input
                                  type="text"
                                  placeholder="例如: TIMEOUT"
                                  value={item.key}
                                  disabled={!isAdmin}
                                  style={{ width: '100%', padding: '6px 10px', fontSize: 13, height: 32 }}
                                  onChange={(e) => {
                                    const newList = [...customAttrs];
                                    newList[index] = { ...newList[index], key: e.target.value };
                                    updateCustomAttrs(newList);
                                  }}
                                />
                              </td>
                              <td style={{ padding: '4px 8px' }}>
                                <input
                                  type={isSensitive ? "password" : "text"}
                                  placeholder="例如: 300"
                                  value={displayValue}
                                  disabled={!isAdmin}
                                  style={{ width: '100%', padding: '6px 10px', fontSize: 13, height: 32 }}
                                  onChange={(e) => {
                                    const newList = [...customAttrs];
                                    newList[index] = { ...newList[index], value: e.target.value };
                                    updateCustomAttrs(newList);
                                  }}
                                />
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                                {isAdmin && (
                                  <button
                                    type="button"
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: '#fda4af',
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      padding: '6px',
                                      borderRadius: '4px',
                                      transition: 'all 0.2s'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.color = '#fb7185';
                                      e.currentTarget.style.background = 'rgba(244, 63, 94, 0.1)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.color = '#fda4af';
                                      e.currentTarget.style.background = 'none';
                                    }}
                                    onClick={() => {
                                      const newList = customAttrs.filter((_, i) => i !== index);
                                      updateCustomAttrs(newList);
                                    }}
                                    title="删除"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* 错误提示条 */}
          {(localError || saveError) && (
            <div style={{
              margin: '0 24px 0 24px',
              padding: '12px 16px',
              borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              animation: 'fadeSlideIn 0.25s ease-out'
            }}>
              <XCircle size={16} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fca5a5', marginBottom: 2 }}>保存失败</div>
                <div style={{ fontSize: 12, color: '#fca5a5', opacity: 0.85, lineHeight: 1.5 }}>{localError || saveError}</div>
              </div>
            </div>
          )}

          <div style={{ 
            display: 'flex', 
            justifyContent: 'flex-end', 
            gap: 12, 
            padding: '16px 24px', 
            borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))',
            background: 'rgba(255, 255, 255, 0.01)'
          }}>
            <button type="button" className="btn btn-secondary" onClick={handleCloseWithAnimation} disabled={saving}>
              {isAdmin ? '取消' : '关闭'}
            </button>
            {isAdmin && (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  opacity: saving ? 0.75 : 1,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  transition: 'opacity 0.2s'
                }}
              >
                {saving ? (
                  <>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    {isView ? '保存中...' : '创建中...'}
                  </>
                ) : (isView ? '保存修改' : '创建方案')}
              </button>
            )}
          </div>

          {/* 成功浮层横幅 */}
          {saveSuccess && (
            <SuccessBanner
              isNew={!activeScheme?.id}
              onDone={onSuccessClose}
            />
          )}

          {/* 粘贴参数弹窗 */}
          {showPasteModal && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(8px)',
              zIndex: 1002,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              animation: 'fadeIn 0.25s ease-out'
            }}>
              <div style={{
                background: 'var(--bg-secondary, #1f2937)',
                border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
                borderRadius: 12,
                width: '100%',
                maxWidth: 480,
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5), 0 10px 10px -5px rgba(0,0,0,0.4)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))'
                }}>
                  <h4 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>粘贴参数</h4>
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      fontSize: 20,
                      cursor: 'pointer',
                      padding: '2px 6px',
                      lineHeight: 1
                    }}
                    onClick={() => {
                      setPasteContent('');
                      setShowPasteModal(false);
                    }}
                  >
                    &times;
                  </button>
                </div>
                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    支持解析以等号 <code>=</code> 或冒号 <code>:</code> 分割的键值对，每行一个参数。例如：
                    <pre style={{ 
                      background: 'rgba(0,0,0,0.2)', 
                      padding: '8px 12px', 
                      borderRadius: 6, 
                      fontSize: 12, 
                      color: '#a7f3d0', 
                      margin: '8px 0 0 0',
                      fontFamily: 'monospace'
                    }}>
                      TIMEOUT=300{"\n"}
                      ENV: production{"\n"}
                      DEBUG=true
                    </pre>
                  </div>
                  <textarea
                    placeholder="在此粘贴您的参数..."
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                    style={{
                      width: '100%',
                      height: 160,
                      padding: '10px 12px',
                      fontSize: 13,
                      background: 'var(--bg-secondary, #111827)',
                      border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
                      borderRadius: 6,
                      color: 'var(--text-main)',
                      resize: 'none',
                      fontFamily: 'monospace',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    autoFocus
                  />
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                  padding: '12px 20px',
                  borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))',
                  background: 'rgba(255, 255, 255, 0.01)'
                }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: 12, height: 'auto' }}
                    onClick={() => {
                      setPasteContent('');
                      setShowPasteModal(false);
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', fontSize: 12, height: 'auto' }}
                    onClick={handlePasteAttrs}
                  >
                    导入
                  </button>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

// 三方多步骤同步加载沉浸式浮层组件
const SyncProgressOverlay: React.FC<{ isEdit: boolean }> = ({ isEdit }) => {
  const [seconds, setSeconds] = React.useState(0)

  React.useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(s => s + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // 根据耗时动态流转 3 个阶段
  let currentStep = 1
  if (seconds >= 4 && seconds < 12) {
    currentStep = 2
  } else if (seconds >= 12) {
    currentStep = 3
  }

  let statusDescription = '正在与三方代码检查平台建立关联，初始化代码扫描任务...'
  if (seconds >= 4 && seconds < 12) {
    statusDescription = '正在向远程流水线系统下发方案实体配置与环境变量...'
  } else if (seconds >= 12 && seconds < 20) {
    statusDescription = '正在三方平台同步配置 MR 触发规则与门禁策略...'
  } else if (seconds >= 20) {
    statusDescription = '三方系统正在深度编排处理中，请勿关闭或刷新页面...'
  }

  const steps = [
    {
      step: 1,
      title: '代码检查任务初始化',
      desc: '创建或关联远程多语言代码静态分析任务',
      icon: FileCode
    },
    {
      step: 2,
      title: isEdit ? '更新远程流水线方案' : '注册远程流水线方案',
      desc: '下发分支规则、构建参数及调度策略',
      icon: GitBranch
    },
    {
      step: 3,
      title: 'MR 门禁与触发规则绑定',
      desc: '配置代码合并实时卡口与自动化触发联动',
      icon: GitMerge
    }
  ]

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(8px)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '32px 24px',
        animation: 'fadeIn 0.25s ease-out'
      }}
    >
      {/* 顶部动态流光渐变进度条 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899, #6366f1)',
          backgroundSize: '200% 100%',
          animation: 'pipeline-streamer 2s linear infinite'
        }}
      />

      <div
        style={{
          width: '100%',
          maxWidth: 460,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20
        }}
      >
        {/* 中心旋转光环 Icon */}
        <div
          style={{
            position: 'relative',
            width: 60,
            height: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: '2px solid rgba(99, 102, 241, 0.2)',
              borderTopColor: '#6366f1',
              animation: 'pipeline-spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite'
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 6,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(99, 102, 241, 0.25) 0%, transparent 70%)'
            }}
          />
          <RefreshCw size={24} color="#818cf8" style={{ animation: 'pipeline-spin 3s linear infinite' }} />
        </div>

        {/* 标题与计时 */}
        <div style={{ textAlign: 'center', width: '100%' }}>
          <h4 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main, #f8fafc)', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span>{isEdit ? '正在同步更新执行方案' : '正在同步创建执行方案'}</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#818cf8',
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                padding: '2px 8px',
                borderRadius: 12
              }}
            >
              {seconds}s
            </span>
          </h4>
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-secondary, #94a3b8)',
              marginTop: 8,
              minHeight: 38,
              lineHeight: 1.5,
              transition: 'all 0.3s ease'
            }}
          >
            {statusDescription}
          </p>
        </div>

        {/* 步骤条卡片 */}
        <div
          style={{
            width: '100%',
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 12,
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}
        >
          {steps.map(item => {
            const isDone = currentStep > item.step
            const isCurrent = currentStep === item.step
            return (
              <div
                key={item.step}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  opacity: isDone || isCurrent ? 1 : 0.45,
                  transition: 'opacity 0.3s ease'
                }}
              >
                {/* 状态指示球 */}
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: isDone
                      ? 'rgba(16, 185, 129, 0.18)'
                      : isCurrent
                      ? 'rgba(99, 102, 241, 0.25)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: `1.5px solid ${
                      isDone
                        ? '#10b981'
                        : isCurrent
                        ? '#6366f1'
                        : 'rgba(255, 255, 255, 0.15)'
                    }`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.3s'
                  }}
                >
                  {isDone ? (
                    <Check size={14} color="#10b981" />
                  ) : isCurrent ? (
                    <Loader2 size={14} color="#818cf8" style={{ animation: 'pipeline-spin 1s linear infinite' }} />
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>{item.step}</span>
                  )}
                </div>

                {/* 步骤文本 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: isCurrent ? 600 : 500,
                      color: isDone ? '#34d399' : isCurrent ? '#f8fafc' : '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    <span>{item.title}</span>
                    {isCurrent && (
                      <span style={{ fontSize: 11, color: '#818cf8', fontWeight: 400 }}>(进行中...)</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{item.desc}</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* 底部安全防重提示 */}
        <div
          style={{
            fontSize: 12,
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '6px 14px',
            borderRadius: 20
          }}
        >
          <Clock size={13} color="#94a3b8" />
          <span>三方平台多步骤通信中，请耐心等待，勿刷新窗口</span>
        </div>
      </div>
    </div>
  )
}

// 成功提示横幅组件
const SuccessBanner: React.FC<{ isNew: boolean; onDone?: () => void }> = ({ isNew, onDone }) => {
  const [progress, setProgress] = React.useState(100)
  const [visible, setVisible] = React.useState(true)
  const duration = 2200

  React.useEffect(() => {
    const startTime = performance.now()
    let rafId: number

    const tick = (now: number) => {
      const elapsed = now - startTime
      const pct = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(pct)
      if (elapsed < duration) {
        rafId = requestAnimationFrame(tick)
      } else {
        setVisible(false)
        setTimeout(() => onDone?.(), 350)
      }
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(5, 150, 105, 0.12) 100%)',
      backdropFilter: 'blur(8px)',
      borderTop: '1px solid rgba(16, 185, 129, 0.35)',
      padding: '20px 24px 22px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(8px)',
      transition: 'opacity 0.35s ease, transform 0.35s ease',
      animation: 'fadeSlideUp 0.3s ease-out'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'rgba(16, 185, 129, 0.2)',
          border: '1.5px solid rgba(16, 185, 129, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          <CheckCircle2 size={18} style={{ color: '#34d399' }} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#6ee7b7' }}>
            {isNew ? '执行方案已成功创建 🎉' : '执行方案已更新'}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(110, 231, 183, 0.7)', marginTop: 2 }}>
            即将自动关闭...
          </div>
        </div>
      </div>
      {/* 进度条 */}
      <div style={{
        height: 3,
        borderRadius: 2,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden'
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'linear-gradient(90deg, #10b981, #34d399)',
          borderRadius: 2,
          transition: 'width 0.1s linear'
        }} />
      </div>
    </div>
  )
}
