import { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import type { CredentialInfo } from '@/types/sourceInfo';
import type { SourceInfoMap } from '@/utils/sourceResolver';
import { resolveSourceDisplay } from '@/utils/sourceResolver';
import {
  buildDailySeriesByGroup,
  buildHourlySeriesByGroup,
  formatCompactNumber,
  normalizeAuthIndex,
  type GroupTrendIdentity,
  type GroupTrendMetric,
  type UsageDetail,
} from '@/utils/usage';
import { buildChartOptions, getHourChartMinWidth } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

const SERIES_COLORS = [
  { border: '#8b8680', bg: 'rgba(139, 134, 128, 0.14)' },
  { border: '#22c55e', bg: 'rgba(34, 197, 94, 0.14)' },
  { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)' },
  { border: '#c65746', bg: 'rgba(198, 87, 70, 0.14)' },
  { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.14)' },
  { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.14)' },
  { border: '#ec4899', bg: 'rgba(236, 72, 153, 0.14)' },
  { border: '#84cc16', bg: 'rgba(132, 204, 22, 0.14)' },
  { border: '#f97316', bg: 'rgba(249, 115, 22, 0.14)' },
];

const normalizeSearch = (value: string) => value.trim().toLowerCase();

export interface CredentialTrendChartProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  sourceInfoMap: SourceInfoMap;
  authFileMap: Map<string, CredentialInfo>;
  hourWindowHours?: number;
}

export function CredentialTrendChart({
  usage,
  loading,
  isDark,
  isMobile,
  sourceInfoMap,
  authFileMap,
  hourWindowHours,
}: CredentialTrendChartProps) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<'hour' | 'day'>('hour');
  const [metric, setMetric] = useState<GroupTrendMetric>('requests');
  const [limit, setLimit] = useState('5');
  const [searchText, setSearchText] = useState('');
  const normalizedSearch = normalizeSearch(searchText);

  const resolveCredentialGroup = useMemo(
    () =>
      (detail: UsageDetail): GroupTrendIdentity | null => {
        const authKey = normalizeAuthIndex(detail.auth_index);
        if (authKey) {
          const authInfo = authFileMap.get(authKey);
          const sourceInfo = resolveSourceDisplay(
            detail.source ?? '',
            detail.auth_index,
            sourceInfoMap,
            authFileMap
          );
          return {
            key: `auth:${authKey}`,
            label: authInfo?.name || authKey,
            type: authInfo?.type || sourceInfo.type || '',
          };
        }

        const sourceInfo = resolveSourceDisplay(
          detail.source ?? '',
          detail.auth_index,
          sourceInfoMap,
          authFileMap
        );

        return {
          key: sourceInfo.identityKey || `source:${sourceInfo.displayName}`,
          label: sourceInfo.displayName || '-',
          type: sourceInfo.type || '',
        };
      },
    [authFileMap, sourceInfoMap]
  );

  const baseSeries = useMemo(
    () =>
      period === 'hour'
        ? buildHourlySeriesByGroup(usage, resolveCredentialGroup, metric, hourWindowHours)
        : buildDailySeriesByGroup(usage, resolveCredentialGroup, metric),
    [hourWindowHours, metric, period, resolveCredentialGroup, usage]
  );

  const visibleEntries = useMemo(() => {
    const filtered = normalizedSearch
      ? baseSeries.entries.filter((entry) =>
          [entry.label, entry.type, entry.key].some((value) =>
            String(value || '').toLowerCase().includes(normalizedSearch)
          )
        )
      : baseSeries.entries;

    const sorted = [...filtered].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    if (limit === 'all') {
      return sorted;
    }

    const count = Number(limit);
    if (!Number.isFinite(count) || count <= 0) {
      return sorted;
    }
    return sorted.slice(0, count);
  }, [baseSeries.entries, limit, normalizedSearch]);

  const { chartData, chartOptions, emptyText } = useMemo(() => {
    if (!baseSeries.hasData) {
      return {
        chartData: { labels: [], datasets: [] },
        chartOptions: {},
        emptyText: t('usage_stats.no_data'),
      };
    }

    if (!visibleEntries.length) {
      return {
        chartData: { labels: [], datasets: [] },
        chartOptions: {},
        emptyText: t('usage_stats.credential_trend_no_match'),
      };
    }

    const data = {
      labels: baseSeries.labels,
      datasets: visibleEntries.map((entry, index) => {
        const style = SERIES_COLORS[index % SERIES_COLORS.length];
        const shouldFill = visibleEntries.length === 1;
        return {
          label: entry.label,
          data: entry.data,
          borderColor: style.border,
          backgroundColor: style.bg,
          pointBackgroundColor: style.border,
          pointBorderColor: style.border,
          fill: shouldFill,
          tension: 0.35,
        };
      }),
    };

    const baseOptions = buildChartOptions({
      period,
      labels: baseSeries.labels,
      isDark,
      isMobile,
    });
    const options = {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          ticks: {
            ...(baseOptions.scales?.y && 'ticks' in baseOptions.scales.y ? baseOptions.scales.y.ticks : {}),
            callback: (value: string | number) => formatCompactNumber(Number(value)),
          },
        },
      },
    };

    return {
      chartData: data,
      chartOptions: options,
      emptyText: t('usage_stats.no_data'),
    };
  }, [baseSeries.hasData, baseSeries.labels, isDark, isMobile, period, t, visibleEntries]);

  const limitOptions = useMemo(
    () => [
      { value: '5', label: t('usage_stats.credential_trend_top5') },
      { value: '8', label: t('usage_stats.credential_trend_top8') },
      { value: '12', label: t('usage_stats.credential_trend_top12') },
      { value: 'all', label: t('usage_stats.credential_trend_all') },
    ],
    [t]
  );

  const metricOptions = useMemo(
    () => [
      { value: 'requests', label: t('usage_stats.requests_count') },
      { value: 'tokens', label: t('usage_stats.tokens_count') },
    ],
    [t]
  );

  return (
    <Card
      title={t('usage_stats.credential_trend')}
      extra={
        <div className={styles.periodButtons}>
          <Button
            variant={period === 'hour' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('hour')}
          >
            {t('usage_stats.by_hour')}
          </Button>
          <Button
            variant={period === 'day' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('day')}
          >
            {t('usage_stats.by_day')}
          </Button>
        </div>
      }
    >
      <div className={styles.requestEventsToolbar}>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.credential_trend_metric')}
          </span>
          <Select
            value={metric}
            options={metricOptions}
            onChange={(value) => setMetric(value as GroupTrendMetric)}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.credential_trend_metric')}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.credential_trend_topn')}
          </span>
          <Select
            value={limit}
            options={limitOptions}
            onChange={setLimit}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.credential_trend_topn')}
          />
        </div>
        <div className={styles.searchGroup}>
          <span className={styles.timeRangeLabel}>{t('usage_stats.credential_trend_search')}</span>
          <input
            type="text"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t('usage_stats.credential_trend_search_placeholder')}
            aria-label={t('usage_stats.credential_trend_search')}
            className={`input ${styles.searchInput}`}
          />
        </div>
      </div>

      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : chartData.labels.length > 0 ? (
        <div className={styles.chartWrapper}>
          <div className={styles.chartLegend} aria-label="Chart legend">
            {visibleEntries.map((entry, index) => {
              const style = SERIES_COLORS[index % SERIES_COLORS.length];
              const legendText = `${entry.label} · ${formatCompactNumber(entry.total)}`;
              return (
                <div key={entry.key} className={styles.legendItem} title={legendText}>
                  <span className={styles.legendDot} style={{ backgroundColor: style.border }} />
                  <span className={styles.legendLabel}>{legendText}</span>
                </div>
              );
            })}
          </div>
          <div className={styles.chartArea}>
            <div className={styles.chartScroller}>
              <div
                className={styles.chartCanvas}
                style={
                  period === 'hour'
                    ? { minWidth: getHourChartMinWidth(chartData.labels.length, isMobile) }
                    : undefined
                }
              >
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.hint}>{emptyText}</div>
      )}
    </Card>
  );
}
