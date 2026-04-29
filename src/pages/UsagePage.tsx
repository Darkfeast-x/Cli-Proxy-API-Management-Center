import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { authFilesApi, providersApi } from '@/services/api';
import { useThemeStore, useConfigStore } from '@/stores';
import type { OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import {
  StatCards,
  UsageChart,
  ChartLineSelector,
  ApiDetailsCard,
  ModelStatsCard,
  PriceSettingsCard,
  CredentialStatsCard,
  RequestEventsDetailsCard,
  TokenBreakdownChart,
  CostTrendChart,
  ServiceHealthCard,
  useUsageData,
  useSparklines,
  useChartData
} from '@/components/usage';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import {
  collectUsageDetails,
  filterUsageByDetail,
  filterUsageByTimeRange,
  getApiStats,
  getModelNamesFromUsage,
  getModelStats,
  normalizeAuthIndex,
  type UsageTimeRange
} from '@/utils/usage';
import styles from './UsagePage.module.scss';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const CHART_LINES_STORAGE_KEY = 'cli-proxy-usage-chart-lines-v1';
const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v1';
const DEFAULT_CHART_LINES = ['all'];
const DEFAULT_TIME_RANGE: UsageTimeRange = '24h';
const MAX_CHART_LINES = 9;
const ALL_FILTER = '__all__';

const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; labelKey: string }> = [
  { value: 'all', labelKey: 'usage_stats.range_all' },
  { value: '7h', labelKey: 'usage_stats.range_7h' },
  { value: '12h', labelKey: 'usage_stats.range_12h' },
  { value: '24h', labelKey: 'usage_stats.range_24h' },
  { value: '7d', labelKey: 'usage_stats.range_7d' }
];

const HOUR_WINDOW_BY_TIME_RANGE: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  '7h': 7,
  '12h': 12,
  '24h': 24,
  '7d': 7 * 24
};

const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === '7h' || value === '12h' || value === '24h' || value === '7d' || value === 'all';

const normalizeChartLines = (value: unknown, maxLines = MAX_CHART_LINES): string[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_CHART_LINES;
  }

  const filtered = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxLines);

  return filtered.length ? filtered : DEFAULT_CHART_LINES;
};

const loadChartLines = (): string[] => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_CHART_LINES;
    }
    const raw = localStorage.getItem(CHART_LINES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CHART_LINES;
    }
    return normalizeChartLines(JSON.parse(raw));
  } catch {
    return DEFAULT_CHART_LINES;
  }
};

const loadTimeRange = (): UsageTimeRange => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_TIME_RANGE;
    }
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    return isUsageTimeRange(raw) ? raw : DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

const normalizeSearchText = (value: string) => value.trim().toLowerCase();

const getProviderFilterInfo = (sourceInfo: {
  displayName: string;
  type: string;
  identityKey?: string;
}) => {
  const displayName = sourceInfo.displayName.trim();
  const type = sourceInfo.type.trim().toLowerCase();
  const identityKey = sourceInfo.identityKey?.trim() || '';

  if (identityKey.startsWith('openai:')) {
    return {
      key: identityKey,
      label: displayName || type || 'openai'
    };
  }

  if (type) {
    return {
      key: `type:${type}`,
      label: type
    };
  }

  return {
    key: identityKey || displayName || '-',
    label: displayName || '-'
  };
};

export function UsagePage() {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';
  const config = useConfigStore((state) => state.config);
  const openaiCompatibilityConfig = config?.openaiCompatibility;
  const geminiKeys = config?.geminiApiKeys || [];
  const claudeConfigs = config?.claudeApiKeys || [];
  const codexConfigs = config?.codexApiKeys || [];
  const vertexConfigs = config?.vertexApiKeys || [];
  const [openaiProvidersWithAuthIndex, setOpenaiProvidersWithAuthIndex] = useState<{
    source: OpenAIProviderConfig[] | undefined;
    providers: OpenAIProviderConfig[];
  } | null>(null);
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());
  const [selectedAuth, setSelectedAuth] = useState(ALL_FILTER);
  const [selectedProvider, setSelectedProvider] = useState(ALL_FILTER);
  const [searchText, setSearchText] = useState('');

  const {
    usage,
    loading,
    error,
    lastRefreshedAt,
    modelPrices,
    setModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing
  } = useUsageData();

  useHeaderRefresh(loadUsage);

  const [chartLines, setChartLines] = useState<string[]>(loadChartLines);
  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);

  useEffect(() => {
    let cancelled = false;
    const source = openaiCompatibilityConfig;

    providersApi
      .getOpenAIProviders()
      .then((providers) => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex({ source, providers: providers || [] });
      })
      .catch(() => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex(null);
      });

    return () => {
      cancelled = true;
    };
  }, [openaiCompatibilityConfig]);

  useEffect(() => {
    let cancelled = false;

    authFilesApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
        if (!Array.isArray(files)) return;

        const map = new Map<string, CredentialInfo>();
        files.forEach((file) => {
          const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
          if (!key) return;
          map.set(key, {
            name: file.name || key,
            type: (file.type || file.provider || '').toString()
          });
        });
        setAuthFileMap(map);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const openaiProviderState = openaiProvidersWithAuthIndex;
  const openaiProvidersForUsage =
    openaiProviderState && openaiProviderState.source === openaiCompatibilityConfig
      ? openaiProviderState.providers
      : openaiCompatibilityConfig ?? [];

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProvidersForUsage
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProvidersForUsage, vertexConfigs]
  );

  const timeRangeOptions = useMemo(
    () =>
      TIME_RANGE_OPTIONS.map((opt) => ({
        value: opt.value,
        label: t(opt.labelKey)
      })),
    [t]
  );

  const baseUsage = useMemo(
    () => (usage ? filterUsageByTimeRange(usage, timeRange) : null),
    [usage, timeRange]
  );

  const authOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    collectUsageDetails(baseUsage).forEach((detail) => {
      const authKey = normalizeAuthIndex(detail.auth_index);
      if (!authKey) {
        return;
      }
      optionMap.set(authKey, authFileMap.get(authKey)?.name || authKey);
    });

    if (!optionMap.size) {
      authFileMap.forEach((info, key) => {
        optionMap.set(key, info.name || key);
      });
    }

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(optionMap.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label))
    ];
  }, [authFileMap, baseUsage, t]);

  const providerOptions = useMemo(() => {
    const optionMap = new Map<string, string>();

    collectUsageDetails(baseUsage).forEach((detail) => {
      const sourceInfo = resolveSourceDisplay(detail.source ?? '', detail.auth_index, sourceInfoMap, authFileMap);
      const providerInfo = getProviderFilterInfo(sourceInfo);
      optionMap.set(providerInfo.key, providerInfo.label);
    });

    if (!optionMap.size) {
      if (geminiKeys.length) optionMap.set('type:gemini', 'gemini');
      if (claudeConfigs.length) optionMap.set('type:claude', 'claude');
      if (codexConfigs.length) optionMap.set('type:codex', 'codex');
      if (vertexConfigs.length) optionMap.set('type:vertex', 'vertex');
      openaiProvidersForUsage.forEach((provider, index) => {
        optionMap.set(
          `openai:${index}`,
          provider.prefix?.trim() || provider.name?.trim() || `openai-${index + 1}`
        );
      });
    }

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(optionMap.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label))
    ];
  }, [
    authFileMap,
    baseUsage,
    claudeConfigs.length,
    codexConfigs.length,
    geminiKeys.length,
    openaiProvidersForUsage,
    sourceInfoMap,
    t,
    vertexConfigs.length
  ]);

  const authOptionSet = useMemo(() => new Set(authOptions.map((item) => item.value)), [authOptions]);
  const providerOptionSet = useMemo(
    () => new Set(providerOptions.map((item) => item.value)),
    [providerOptions]
  );
  const effectiveSelectedAuth = authOptionSet.has(selectedAuth) ? selectedAuth : ALL_FILTER;
  const effectiveSelectedProvider = providerOptionSet.has(selectedProvider)
    ? selectedProvider
    : ALL_FILTER;
  const normalizedSearch = normalizeSearchText(searchText);

  useEffect(() => {
    if (selectedAuth !== effectiveSelectedAuth) {
      setSelectedAuth(effectiveSelectedAuth);
    }
  }, [effectiveSelectedAuth, selectedAuth]);

  useEffect(() => {
    if (selectedProvider !== effectiveSelectedProvider) {
      setSelectedProvider(effectiveSelectedProvider);
    }
  }, [effectiveSelectedProvider, selectedProvider]);

  const filteredUsage = useMemo(() => {
    if (!baseUsage) {
      return null;
    }

    if (
      effectiveSelectedAuth === ALL_FILTER &&
      effectiveSelectedProvider === ALL_FILTER &&
      !normalizedSearch
    ) {
      return baseUsage;
    }

    return filterUsageByDetail(baseUsage, (detail, context) => {
      const sourceInfo = resolveSourceDisplay(detail.source ?? '', detail.auth_index, sourceInfoMap, authFileMap);
      const providerInfo = getProviderFilterInfo(sourceInfo);
      const authKey = normalizeAuthIndex(detail.auth_index);
      const authInfo = authKey ? authFileMap.get(authKey) : null;

      if (effectiveSelectedAuth !== ALL_FILTER && authKey !== effectiveSelectedAuth) {
        return false;
      }

      if (effectiveSelectedProvider !== ALL_FILTER && providerInfo.key !== effectiveSelectedProvider) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [
        context.modelName,
        context.apiName,
        sourceInfo.displayName,
        sourceInfo.type,
        sourceInfo.identityKey || '',
        providerInfo.label,
        providerInfo.key,
        detail.source || '',
        authKey || '',
        authInfo?.name || '',
        authInfo?.type || ''
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
    });
  }, [
    authFileMap,
    baseUsage,
    effectiveSelectedAuth,
    effectiveSelectedProvider,
    normalizedSearch,
    sourceInfoMap
  ]);

  const filteredModelNames = useMemo(() => getModelNamesFromUsage(filteredUsage), [filteredUsage]);
  const hourWindowHours = timeRange === 'all' ? undefined : HOUR_WINDOW_BY_TIME_RANGE[timeRange];

  const handleChartLinesChange = useCallback((lines: string[]) => {
    setChartLines(normalizeChartLines(lines));
  }, []);

  useEffect(() => {
    const allowed = new Set(['all', ...filteredModelNames]);
    const next = normalizeChartLines(chartLines.filter((line) => allowed.has(line)), MAX_CHART_LINES);
    const changed =
      next.length !== chartLines.length || next.some((line, index) => line !== chartLines[index]);
    if (changed) {
      setChartLines(next);
    }
  }, [chartLines, filteredModelNames]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(CHART_LINES_STORAGE_KEY, JSON.stringify(chartLines));
    } catch {
      // Ignore storage errors.
    }
  }, [chartLines]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, timeRange);
    } catch {
      // Ignore storage errors.
    }
  }, [timeRange]);

  const nowMs = lastRefreshedAt?.getTime() ?? 0;

  const {
    requestsSparkline,
    tokensSparkline,
    rpmSparkline,
    tpmSparkline,
    costSparkline
  } = useSparklines({ usage: filteredUsage, loading, nowMs });

  const {
    requestsPeriod,
    setRequestsPeriod,
    tokensPeriod,
    setTokensPeriod,
    requestsChartData,
    tokensChartData,
    requestsChartOptions,
    tokensChartOptions
  } = useChartData({ usage: filteredUsage, chartLines, isDark, isMobile, hourWindowHours });

  const modelNames = useMemo(() => getModelNamesFromUsage(usage), [usage]);
  const apiStats = useMemo(() => getApiStats(filteredUsage, modelPrices), [filteredUsage, modelPrices]);
  const modelStats = useMemo(() => getModelStats(filteredUsage, modelPrices), [filteredUsage, modelPrices]);
  const hasPrices = Object.keys(modelPrices).length > 0;

  return (
    <div className={styles.container}>
      {loading && !usage && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
        <div className={styles.headerActions}>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.range_filter')}</span>
            <Select
              value={timeRange}
              options={timeRangeOptions}
              onChange={(value) => setTimeRange(value as UsageTimeRange)}
              className={styles.timeRangeSelectControl}
              ariaLabel={t('usage_stats.range_filter')}
              fullWidth={false}
            />
          </div>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.auth_filter')}</span>
            <Select
              value={effectiveSelectedAuth}
              options={authOptions}
              onChange={setSelectedAuth}
              className={styles.headerFilterSelect}
              ariaLabel={t('usage_stats.auth_filter')}
              fullWidth={false}
            />
          </div>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.provider_filter')}</span>
            <Select
              value={effectiveSelectedProvider}
              options={providerOptions}
              onChange={setSelectedProvider}
              className={styles.headerFilterSelect}
              ariaLabel={t('usage_stats.provider_filter')}
              fullWidth={false}
            />
          </div>
          <div className={styles.searchGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.search_filter')}</span>
            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={t('usage_stats.search_placeholder')}
              aria-label={t('usage_stats.search_filter')}
              className={`input ${styles.searchInput}`}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            disabled={loading || importing}
          >
            {t('usage_stats.export')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImport}
            loading={importing}
            disabled={loading || exporting}
          >
            {t('usage_stats.import')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadUsage().catch(() => {})}
            disabled={loading || exporting || importing}
          >
            {loading ? t('common.loading') : t('usage_stats.refresh')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportChange}
          />
          {lastRefreshedAt && (
            <span className={styles.lastRefreshed}>
              {t('usage_stats.last_updated')}: {lastRefreshedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <StatCards
        usage={filteredUsage}
        loading={loading}
        modelPrices={modelPrices}
        nowMs={nowMs}
        sparklines={{
          requests: requestsSparkline,
          tokens: tokensSparkline,
          rpm: rpmSparkline,
          tpm: tpmSparkline,
          cost: costSparkline
        }}
      />

      <ChartLineSelector
        chartLines={chartLines}
        modelNames={filteredModelNames}
        maxLines={MAX_CHART_LINES}
        onChange={handleChartLinesChange}
      />

      <ServiceHealthCard usage={usage} loading={loading} />

      <div className={styles.chartsGrid}>
        <UsageChart
          title={t('usage_stats.requests_trend')}
          period={requestsPeriod}
          onPeriodChange={setRequestsPeriod}
          chartData={requestsChartData}
          chartOptions={requestsChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
        <UsageChart
          title={t('usage_stats.tokens_trend')}
          period={tokensPeriod}
          onPeriodChange={setTokensPeriod}
          chartData={tokensChartData}
          chartOptions={tokensChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
      </div>

      <TokenBreakdownChart
        usage={filteredUsage}
        loading={loading}
        isDark={isDark}
        isMobile={isMobile}
        hourWindowHours={hourWindowHours}
      />

      <CostTrendChart
        usage={filteredUsage}
        loading={loading}
        isDark={isDark}
        isMobile={isMobile}
        modelPrices={modelPrices}
        hourWindowHours={hourWindowHours}
      />

      <div className={styles.detailsGrid}>
        <ApiDetailsCard apiStats={apiStats} loading={loading} hasPrices={hasPrices} />
        <ModelStatsCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />
      </div>

      <RequestEventsDetailsCard
        usage={filteredUsage}
        loading={loading}
        geminiKeys={geminiKeys}
        claudeConfigs={claudeConfigs}
        codexConfigs={codexConfigs}
        vertexConfigs={vertexConfigs}
        openaiProviders={openaiProvidersForUsage}
        modelPrices={modelPrices}
      />

      <CredentialStatsCard
        usage={filteredUsage}
        loading={loading}
        geminiKeys={geminiKeys}
        claudeConfigs={claudeConfigs}
        codexConfigs={codexConfigs}
        vertexConfigs={vertexConfigs}
        openaiProviders={openaiProvidersForUsage}
      />

      <PriceSettingsCard
        modelNames={modelNames}
        modelPrices={modelPrices}
        onPricesChange={setModelPrices}
      />
    </div>
  );
}
