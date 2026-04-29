import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { authFilesApi } from '@/services/api/authFiles';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import { getAuthFileIndexValue } from '@/utils/authFiles';
import {
  calculateCost,
  collectUsageDetails,
  collectUsageDetailsWithEndpoint,
  extractTotalTokens,
  formatCompactNumber,
  formatDurationMs,
  formatUsd,
  normalizeAuthIndex,
  type ModelPrice
} from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface TopAnomaliesCardProps {
  usage: unknown;
  loading: boolean;
  modelPrices: Record<string, ModelPrice>;
  hasPrices: boolean;
}

interface SlowEndpointRow {
  endpoint: string;
  averageLatencyMs: number;
  maxLatencyMs: number;
  requestCount: number;
  failureCount: number;
}

interface FailingCredentialRow {
  key: string;
  label: string;
  failureCount: number;
  requestCount: number;
  failureRate: number;
}

interface CostlyModelRow {
  model: string;
  totalCost: number;
  totalTokens: number;
  requestCount: number;
}

const TOP_LIMIT_OPTIONS = [3, 5, 10];

export function TopAnomaliesCard({ usage, loading, modelPrices, hasPrices }: TopAnomaliesCardProps) {
  const { t } = useTranslation();
  const [topLimit, setTopLimit] = useState('5');
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());

  useEffect(() => {
    let cancelled = false;

    authFilesApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
        if (!Array.isArray(files)) return;

        const nextMap = new Map<string, CredentialInfo>();
        files.forEach((file) => {
          const key = normalizeAuthIndex(getAuthFileIndexValue(file));
          if (!key) return;
          nextMap.set(key, {
            name: file.name || key,
            type: (file.type || file.provider || '').toString()
          });
        });

        setAuthFileMap(nextMap);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const numericTopLimit = useMemo(() => {
    const parsed = Number.parseInt(topLimit, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  }, [topLimit]);

  const slowEndpoints = useMemo<SlowEndpointRow[]>(() => {
    const bucketMap = new Map<
      string,
      { endpoint: string; totalLatencyMs: number; maxLatencyMs: number; sampleCount: number; failureCount: number }
    >();

    collectUsageDetailsWithEndpoint(usage).forEach((detail) => {
      const latencyMs = typeof detail.latency_ms === 'number' ? detail.latency_ms : null;
      if (latencyMs === null) {
        return;
      }

      const endpoint = detail.__endpoint || detail.__endpointPath || '-';
      const bucket =
        bucketMap.get(endpoint) ??
        {
          endpoint,
          totalLatencyMs: 0,
          maxLatencyMs: 0,
          sampleCount: 0,
          failureCount: 0
        };

      const nextBucket = {
        ...bucket,
        totalLatencyMs: bucket.totalLatencyMs + latencyMs,
        maxLatencyMs: Math.max(bucket.maxLatencyMs, latencyMs),
        sampleCount: bucket.sampleCount + 1,
        failureCount: bucket.failureCount + (detail.failed ? 1 : 0)
      };

      bucketMap.set(endpoint, nextBucket);
    });

    return Array.from(bucketMap.values())
      .map((bucket) => ({
        endpoint: bucket.endpoint,
        averageLatencyMs: bucket.sampleCount > 0 ? bucket.totalLatencyMs / bucket.sampleCount : 0,
        maxLatencyMs: bucket.maxLatencyMs,
        requestCount: bucket.sampleCount,
        failureCount: bucket.failureCount
      }))
      .sort(
        (left, right) =>
          right.averageLatencyMs - left.averageLatencyMs ||
          right.maxLatencyMs - left.maxLatencyMs ||
          right.requestCount - left.requestCount
      )
      .slice(0, numericTopLimit);
  }, [numericTopLimit, usage]);

  const failingCredentials = useMemo<FailingCredentialRow[]>(() => {
    const bucketMap = new Map<string, { label: string; failureCount: number; requestCount: number }>();

    collectUsageDetails(usage).forEach((detail) => {
      const authKey = normalizeAuthIndex(detail.auth_index);
      if (!authKey) {
        return;
      }

      const credentialInfo = authFileMap.get(authKey);
      const label = credentialInfo?.name || authKey;
      const bucket = bucketMap.get(authKey) ?? { label, failureCount: 0, requestCount: 0 };
      bucket.requestCount += 1;
      if (detail.failed) {
        bucket.failureCount += 1;
      }
      bucketMap.set(authKey, bucket);
    });

    return Array.from(bucketMap.entries())
      .map(([key, bucket]) => ({
        key,
        label: bucket.label,
        failureCount: bucket.failureCount,
        requestCount: bucket.requestCount,
        failureRate: bucket.requestCount > 0 ? (bucket.failureCount / bucket.requestCount) * 100 : 0
      }))
      .filter((bucket) => bucket.failureCount > 0)
      .sort(
        (left, right) =>
          right.failureCount - left.failureCount ||
          right.failureRate - left.failureRate ||
          right.requestCount - left.requestCount
      )
      .slice(0, numericTopLimit);
  }, [authFileMap, numericTopLimit, usage]);

  const costlyModels = useMemo<CostlyModelRow[]>(() => {
    const bucketMap = new Map<string, { totalCost: number; totalTokens: number; requestCount: number }>();

    collectUsageDetails(usage).forEach((detail) => {
      const model = detail.__modelName?.trim() || '-';
      const totalCost = calculateCost(detail, modelPrices);
      const existing = bucketMap.get(model) ?? { totalCost: 0, totalTokens: 0, requestCount: 0 };

      bucketMap.set(model, {
        totalCost: existing.totalCost + totalCost,
        totalTokens: existing.totalTokens + extractTotalTokens(detail),
        requestCount: existing.requestCount + 1
      });
    });

    return Array.from(bucketMap.entries())
      .map(([model, bucket]) => ({
        model,
        totalCost: bucket.totalCost,
        totalTokens: bucket.totalTokens,
        requestCount: bucket.requestCount
      }))
      .filter((bucket) => bucket.totalCost > 0)
      .sort(
        (left, right) =>
          right.totalCost - left.totalCost ||
          right.totalTokens - left.totalTokens ||
          right.requestCount - left.requestCount
      )
      .slice(0, numericTopLimit);
  }, [modelPrices, numericTopLimit, usage]);

  const topLimitOptions = useMemo(
    () =>
      TOP_LIMIT_OPTIONS.map((value) => ({
        value: String(value),
        label: `Top ${value}`
      })),
    []
  );

  const renderEmpty = (message: string) => <div className={styles.anomalyEmpty}>{message}</div>;

  return (
    <Card
      title={t('usage_stats.top_anomalies_title')}
      extra={
        <div className={styles.anomalyCardExtra}>
          <span className={styles.anomalyCardExtraLabel}>{t('usage_stats.top_anomalies_limit')}</span>
          <Select
            value={topLimit}
            options={topLimitOptions}
            onChange={setTopLimit}
            className={styles.anomalySelect}
            ariaLabel={t('usage_stats.top_anomalies_limit')}
            fullWidth={false}
          />
        </div>
      }
    >
      {loading && !usage ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : (
        <div className={styles.anomalyGrid}>
          <section className={styles.anomalySection}>
            <div className={styles.anomalySectionHeader}>
              <h3 className={styles.anomalySectionTitle}>
                {t('usage_stats.top_anomalies_slowest_endpoints')}
              </h3>
              <span className={styles.anomalySectionHint}>
                {t('usage_stats.top_anomalies_slowest_endpoints_hint')}
              </span>
            </div>
            {slowEndpoints.length === 0 ? (
              renderEmpty(t('usage_stats.no_data'))
            ) : (
              <div className={styles.anomalyList}>
                {slowEndpoints.map((item, index) => (
                  <div key={item.endpoint} className={styles.anomalyItem}>
                    <span className={styles.anomalyRank}>#{index + 1}</span>
                    <div className={styles.anomalyMain}>
                      <div className={styles.anomalyName} title={item.endpoint}>
                        {item.endpoint}
                      </div>
                      <div className={styles.anomalyMeta}>
                        <span>
                          {t('usage_stats.top_anomalies_requests_meta', {
                            count: item.requestCount
                          })}
                        </span>
                        <span>
                          {t('usage_stats.top_anomalies_failure_meta', {
                            count: item.failureCount
                          })}
                        </span>
                        <span>
                          {t('usage_stats.top_anomalies_max_latency_meta', {
                            value: formatDurationMs(item.maxLatencyMs)
                          })}
                        </span>
                      </div>
                    </div>
                    <span className={styles.anomalyMetric}>{formatDurationMs(item.averageLatencyMs)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.anomalySection}>
            <div className={styles.anomalySectionHeader}>
              <h3 className={styles.anomalySectionTitle}>
                {t('usage_stats.top_anomalies_failing_credentials')}
              </h3>
              <span className={styles.anomalySectionHint}>
                {t('usage_stats.top_anomalies_failing_credentials_hint')}
              </span>
            </div>
            {failingCredentials.length === 0 ? (
              renderEmpty(t('usage_stats.no_data'))
            ) : (
              <div className={styles.anomalyList}>
                {failingCredentials.map((item, index) => (
                  <div key={item.key} className={styles.anomalyItem}>
                    <span className={styles.anomalyRank}>#{index + 1}</span>
                    <div className={styles.anomalyMain}>
                      <div className={styles.anomalyName} title={item.label}>
                        {item.label}
                      </div>
                      <div className={styles.anomalyMeta}>
                        <span>
                          {t('usage_stats.top_anomalies_requests_meta', {
                            count: item.requestCount
                          })}
                        </span>
                        <span>
                          {t('usage_stats.top_anomalies_failure_rate_meta', {
                            value: item.failureRate.toFixed(1)
                          })}
                        </span>
                      </div>
                    </div>
                    <span className={`${styles.anomalyMetric} ${styles.anomalyMetricDanger}`}>
                      {t('usage_stats.top_anomalies_failure_meta', {
                        count: item.failureCount
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.anomalySection}>
            <div className={styles.anomalySectionHeader}>
              <h3 className={styles.anomalySectionTitle}>{t('usage_stats.top_anomalies_costly_models')}</h3>
              <span className={styles.anomalySectionHint}>
                {t('usage_stats.top_anomalies_costly_models_hint')}
              </span>
            </div>
            {!hasPrices ? (
              renderEmpty(t('usage_stats.cost_need_price'))
            ) : costlyModels.length === 0 ? (
              renderEmpty(t('usage_stats.cost_no_data'))
            ) : (
              <div className={styles.anomalyList}>
                {costlyModels.map((item, index) => (
                  <div key={item.model} className={styles.anomalyItem}>
                    <span className={styles.anomalyRank}>#{index + 1}</span>
                    <div className={styles.anomalyMain}>
                      <div className={styles.anomalyName} title={item.model}>
                        {item.model}
                      </div>
                      <div className={styles.anomalyMeta}>
                        <span>
                          {t('usage_stats.top_anomalies_requests_meta', {
                            count: item.requestCount
                          })}
                        </span>
                        <span>
                          {t('usage_stats.top_anomalies_tokens_meta', {
                            value: formatCompactNumber(item.totalTokens)
                          })}
                        </span>
                      </div>
                    </div>
                    <span className={`${styles.anomalyMetric} ${styles.anomalyMetricCost}`}>
                      {formatUsd(item.totalCost)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Card>
  );
}
