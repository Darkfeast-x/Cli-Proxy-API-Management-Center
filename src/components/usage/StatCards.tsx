import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Line } from 'react-chartjs-2';
import {
  IconDiamond,
  IconDollarSign,
  IconSatellite,
  IconTimer,
  IconTrendingUp,
} from '@/components/ui/icons';
import {
  LATENCY_SOURCE_FIELD,
  calculateLatencyStatsFromDetails,
  calculateCost,
  collectUsageDetails,
  extractTotalTokens,
  formatCompactNumber,
  formatDurationMs,
  formatPerMinuteValue,
  formatUsd,
  type ModelPrice,
} from '@/utils/usage';
import { sparklineOptions } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import type { SparklineBundle } from './hooks/useSparklines';
import styles from '@/pages/UsagePage.module.scss';

interface StatCardComparison {
  summary: string;
  detail: string;
  tone: 'up' | 'down' | 'flat' | 'new';
}

interface StatCardData {
  key: string;
  label: string;
  icon: ReactNode;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  value: string;
  comparison?: StatCardComparison | null;
  meta?: ReactNode;
  trend: SparklineBundle | null;
}

interface UsageOverview {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  tokenBreakdown: {
    cachedTokens: number;
    reasoningTokens: number;
  };
  rateStats: {
    rpm: number;
    tpm: number;
    windowMinutes: number;
    requestCount: number;
    tokenCount: number;
  };
  totalCost: number;
  latencyStats: {
    averageMs: number | null;
    totalMs: number | null;
    sampleCount: number;
  };
}

export interface StatCardsProps {
  usage: UsagePayload | null;
  previousUsage: UsagePayload | null;
  loading: boolean;
  modelPrices: Record<string, ModelPrice>;
  nowMs: number;
  previousNowMs: number;
  comparisonEnabled: boolean;
  sparklines: {
    requests: SparklineBundle | null;
    tokens: SparklineBundle | null;
    rpm: SparklineBundle | null;
    tpm: SparklineBundle | null;
    cost: SparklineBundle | null;
  };
}

const buildUsageOverview = (
  usage: UsagePayload | null,
  modelPrices: Record<string, ModelPrice>,
  nowMs: number
): UsageOverview => {
  const empty: UsageOverview = {
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    totalTokens: 0,
    tokenBreakdown: { cachedTokens: 0, reasoningTokens: 0 },
    rateStats: { rpm: 0, tpm: 0, windowMinutes: 30, requestCount: 0, tokenCount: 0 },
    totalCost: 0,
    latencyStats: {
      averageMs: null,
      totalMs: null,
      sampleCount: 0,
    },
  };

  if (!usage) {
    return empty;
  }

  const details = collectUsageDetails(usage);
  if (!details.length) {
    return {
      ...empty,
      totalRequests: Number(usage.total_requests) || 0,
      successCount: Number(usage.success_count) || 0,
      failureCount: Number(usage.failure_count) || 0,
      totalTokens: Number(usage.total_tokens) || 0,
    };
  }

  const hasPrices = Object.keys(modelPrices).length > 0;
  const latencyStats = calculateLatencyStatsFromDetails(details);
  const windowMinutes = 30;
  const hasValidNow = Number.isFinite(nowMs) && nowMs > 0;
  const windowStart = hasValidNow ? nowMs - windowMinutes * 60 * 1000 : 0;

  let totalRequests = 0;
  let successCount = 0;
  let failureCount = 0;
  let totalTokens = 0;
  let cachedTokens = 0;
  let reasoningTokens = 0;
  let totalCost = 0;
  let requestCount = 0;
  let tokenCount = 0;

  details.forEach((detail) => {
    totalRequests += 1;
    if (detail.failed) {
      failureCount += 1;
    } else {
      successCount += 1;
    }

    const detailTotalTokens = extractTotalTokens(detail);
    totalTokens += detailTotalTokens;

    const tokens = detail.tokens;
    cachedTokens += Math.max(
      typeof tokens.cached_tokens === 'number' ? Math.max(tokens.cached_tokens, 0) : 0,
      typeof tokens.cache_tokens === 'number' ? Math.max(tokens.cache_tokens, 0) : 0
    );
    if (typeof tokens.reasoning_tokens === 'number') {
      reasoningTokens += tokens.reasoning_tokens;
    }

    const timestamp = detail.__timestampMs ?? 0;
    if (hasValidNow && Number.isFinite(timestamp) && timestamp >= windowStart && timestamp <= nowMs) {
      requestCount += 1;
      tokenCount += detailTotalTokens;
    }

    if (hasPrices) {
      totalCost += calculateCost(detail, modelPrices);
    }
  });

  return {
    totalRequests,
    successCount,
    failureCount,
    totalTokens,
    tokenBreakdown: { cachedTokens, reasoningTokens },
    rateStats: {
      rpm: requestCount / windowMinutes,
      tpm: tokenCount / windowMinutes,
      windowMinutes,
      requestCount,
      tokenCount,
    },
    totalCost,
    latencyStats,
  };
};

const formatSignedValue = (delta: number, formatter: (value: number) => string): string => {
  if (delta === 0) {
    return formatter(0);
  }

  const prefix = delta > 0 ? '+' : '-';
  return `${prefix}${formatter(Math.abs(delta))}`;
};

const buildComparison = (
  current: number,
  previous: number,
  formatter: (value: number) => string
): StatCardComparison => {
  const delta = current - previous;

  if (delta === 0) {
    return {
      summary: '0.0%',
      detail: formatSignedValue(0, formatter),
      tone: 'flat',
    };
  }

  if (previous === 0) {
    return {
      summary: 'NEW',
      detail: formatSignedValue(delta, formatter),
      tone: 'new',
    };
  }

  const percent = (delta / previous) * 100;
  return {
    summary: `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`,
    detail: formatSignedValue(delta, formatter),
    tone: delta > 0 ? 'up' : 'down',
  };
};

export function StatCards({
  usage,
  previousUsage,
  loading,
  modelPrices,
  nowMs,
  previousNowMs,
  comparisonEnabled,
  sparklines,
}: StatCardsProps) {
  const { t } = useTranslation();
  const latencyHint = t('usage_stats.latency_unit_hint', {
    field: LATENCY_SOURCE_FIELD,
    unit: t('usage_stats.duration_unit_ms'),
  });

  const hasPrices = Object.keys(modelPrices).length > 0;

  const currentOverview = useMemo(
    () => buildUsageOverview(usage, modelPrices, nowMs),
    [modelPrices, nowMs, usage]
  );

  const previousOverview = useMemo(
    () =>
      comparisonEnabled ? buildUsageOverview(previousUsage, modelPrices, previousNowMs) : null,
    [comparisonEnabled, modelPrices, previousNowMs, previousUsage]
  );

  const comparisons = useMemo(
    () =>
      previousOverview
        ? {
            requests: buildComparison(
              currentOverview.totalRequests,
              previousOverview.totalRequests,
              (value) => value.toLocaleString()
            ),
            tokens: buildComparison(
              currentOverview.totalTokens,
              previousOverview.totalTokens,
              formatCompactNumber
            ),
            rpm: buildComparison(
              currentOverview.rateStats.rpm,
              previousOverview.rateStats.rpm,
              formatPerMinuteValue
            ),
            tpm: buildComparison(
              currentOverview.rateStats.tpm,
              previousOverview.rateStats.tpm,
              formatPerMinuteValue
            ),
            cost: buildComparison(
              currentOverview.totalCost,
              previousOverview.totalCost,
              formatUsd
            ),
          }
        : null,
    [currentOverview, previousOverview]
  );

  const statsCards: StatCardData[] = [
    {
      key: 'requests',
      label: t('usage_stats.total_requests'),
      icon: <IconSatellite size={16} />,
      accent: '#8b8680',
      accentSoft: 'rgba(139, 134, 128, 0.18)',
      accentBorder: 'rgba(139, 134, 128, 0.35)',
      value: loading ? '-' : currentOverview.totalRequests.toLocaleString(),
      comparison: !loading && comparisons ? comparisons.requests : null,
      meta: (
        <>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#10b981' }} />
            {t('usage_stats.success_requests')}: {loading ? '-' : currentOverview.successCount}
          </span>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#c65746' }} />
            {t('usage_stats.failed_requests')}: {loading ? '-' : currentOverview.failureCount}
          </span>
          {currentOverview.latencyStats.sampleCount > 0 && (
            <span className={styles.statMetaItem} title={latencyHint}>
              {t('usage_stats.avg_time')}: {loading ? '-' : formatDurationMs(currentOverview.latencyStats.averageMs)}
            </span>
          )}
        </>
      ),
      trend: sparklines.requests,
    },
    {
      key: 'tokens',
      label: t('usage_stats.total_tokens'),
      icon: <IconDiamond size={16} />,
      accent: '#8b5cf6',
      accentSoft: 'rgba(139, 92, 246, 0.18)',
      accentBorder: 'rgba(139, 92, 246, 0.35)',
      value: loading ? '-' : formatCompactNumber(currentOverview.totalTokens),
      comparison: !loading && comparisons ? comparisons.tokens : null,
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.cached_tokens')}: {loading ? '-' : formatCompactNumber(currentOverview.tokenBreakdown.cachedTokens)}
          </span>
          <span className={styles.statMetaItem}>
            {t('usage_stats.reasoning_tokens')}: {loading ? '-' : formatCompactNumber(currentOverview.tokenBreakdown.reasoningTokens)}
          </span>
        </>
      ),
      trend: sparklines.tokens,
    },
    {
      key: 'rpm',
      label: t('usage_stats.rpm_30m'),
      icon: <IconTimer size={16} />,
      accent: '#22c55e',
      accentSoft: 'rgba(34, 197, 94, 0.18)',
      accentBorder: 'rgba(34, 197, 94, 0.32)',
      value: loading ? '-' : formatPerMinuteValue(currentOverview.rateStats.rpm),
      comparison: !loading && comparisons ? comparisons.rpm : null,
      meta: (
        <span className={styles.statMetaItem}>
          {t('usage_stats.total_requests')}: {loading ? '-' : currentOverview.rateStats.requestCount.toLocaleString()}
        </span>
      ),
      trend: sparklines.rpm,
    },
    {
      key: 'tpm',
      label: t('usage_stats.tpm_30m'),
      icon: <IconTrendingUp size={16} />,
      accent: '#f97316',
      accentSoft: 'rgba(249, 115, 22, 0.18)',
      accentBorder: 'rgba(249, 115, 22, 0.32)',
      value: loading ? '-' : formatPerMinuteValue(currentOverview.rateStats.tpm),
      comparison: !loading && comparisons ? comparisons.tpm : null,
      meta: (
        <span className={styles.statMetaItem}>
          {t('usage_stats.total_tokens')}: {loading ? '-' : formatCompactNumber(currentOverview.rateStats.tokenCount)}
        </span>
      ),
      trend: sparklines.tpm,
    },
    {
      key: 'cost',
      label: t('usage_stats.total_cost'),
      icon: <IconDollarSign size={16} />,
      accent: '#f59e0b',
      accentSoft: 'rgba(245, 158, 11, 0.18)',
      accentBorder: 'rgba(245, 158, 11, 0.32)',
      value: loading ? '-' : hasPrices ? formatUsd(currentOverview.totalCost) : '--',
      comparison: !loading && hasPrices && comparisons ? comparisons.cost : null,
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.total_tokens')}: {loading ? '-' : formatCompactNumber(currentOverview.totalTokens)}
          </span>
          {!hasPrices && (
            <span className={`${styles.statMetaItem} ${styles.statSubtle}`}>
              {t('usage_stats.cost_need_price')}
            </span>
          )}
        </>
      ),
      trend: hasPrices ? sparklines.cost : null,
    },
  ];

  return (
    <div className={styles.statsGrid}>
      {statsCards.map((card) => (
        <div
          key={card.key}
          className={styles.statCard}
          style={
            {
              '--accent': card.accent,
              '--accent-soft': card.accentSoft,
              '--accent-border': card.accentBorder,
            } as CSSProperties
          }
        >
          <div className={styles.statCardHeader}>
            <div className={styles.statLabelGroup}>
              <span className={styles.statLabel}>{card.label}</span>
            </div>
            <span className={styles.statIconBadge}>{card.icon}</span>
          </div>
          <div className={styles.statValue}>{card.value}</div>
          {card.comparison && (
            <div
              className={[
                styles.statComparison,
                card.comparison.tone === 'up'
                  ? styles.statComparisonUp
                  : card.comparison.tone === 'down'
                    ? styles.statComparisonDown
                    : card.comparison.tone === 'new'
                      ? styles.statComparisonNew
                      : styles.statComparisonFlat,
              ].join(' ')}
            >
              <span className={styles.statComparisonLabel}>
                {t('usage_stats.compare_previous_period')}
              </span>
              <span className={styles.statComparisonSummary}>{card.comparison.summary}</span>
              <span className={styles.statComparisonDetail}>{card.comparison.detail}</span>
            </div>
          )}
          {card.meta && <div className={styles.statMetaRow}>{card.meta}</div>}
          <div className={styles.statTrend}>
            {card.trend ? (
              <Line
                className={styles.sparkline}
                data={card.trend.data}
                options={sparklineOptions}
              />
            ) : (
              <div className={styles.statTrendPlaceholder}></div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
