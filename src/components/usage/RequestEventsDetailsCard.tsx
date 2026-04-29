import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { authFilesApi } from '@/services/api/authFiles';
import { buildUsageLogsJumpSearch } from '@/utils/logsJump';
import { isTraceableRequestPath } from '@/pages/hooks/useTraceResolver';
import { getAuthFileIndexValue } from '@/utils/authFiles';
import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import { parseTimestampMs } from '@/utils/timestamp';
import {
  calculateCost,
  collectUsageDetailsWithEndpoint,
  obfuscateUsageDisplayValue,
  extractLatencyMs,
  extractTotalTokens,
  formatDurationMs,
  LATENCY_SOURCE_FIELD,
  normalizeAuthIndex,
  type ModelPrice
} from '@/utils/usage';
import { downloadBlob } from '@/utils/download';
import styles from '@/pages/UsagePage.module.scss';

const ALL_FILTER = '__all__';
const RESULT_FILTER_SUCCESS = 'success';
const RESULT_FILTER_FAILURE = 'failure';
const MAX_RENDERED_EVENTS = 500;
const DETAIL_FIELD_NOT_AVAILABLE = '-';
const REQUEST_EVENT_COST_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 6,
  maximumFractionDigits: 6
});
const REQUEST_DETAIL_STATUS_PATHS: ReadonlyArray<readonly string[]> = [
  ['status'],
  ['request_status'],
  ['requestStatus'],
  ['state'],
  ['result'],
  ['response', 'statusText'],
  ['response', 'status_text'],
  ['response', 'state'],
  ['response', 'result']
];
const REQUEST_DETAIL_STATUS_CODE_PATHS: ReadonlyArray<readonly string[]> = [
  ['status_code'],
  ['statusCode'],
  ['http_status'],
  ['httpStatus'],
  ['response_status'],
  ['responseStatus'],
  ['response', 'status'],
  ['response', 'statusCode'],
  ['response', 'status_code'],
  ['response', 'httpStatus'],
  ['response', 'http_status'],
  ['response', 'code']
];
const REQUEST_DETAIL_REASONING_PATHS: ReadonlyArray<readonly string[]> = [
  ['reasoning_effort'],
  ['reasoningEffort'],
  ['effort'],
  ['reasoning', 'effort'],
  ['thinking', 'effort'],
  ['metadata', 'reasoning_effort'],
  ['metadata', 'reasoningEffort'],
  ['metadata', 'effort'],
  ['request', 'reasoning_effort'],
  ['request', 'reasoningEffort'],
  ['request', 'effort'],
  ['request', 'reasoning', 'effort'],
  ['request', 'thinking', 'effort'],
  ['request', 'body', 'reasoning_effort'],
  ['request', 'body', 'reasoningEffort'],
  ['request', 'body', 'effort'],
  ['request', 'body', 'reasoning', 'effort'],
  ['request', 'payload', 'reasoning_effort'],
  ['request', 'payload', 'reasoningEffort'],
  ['request', 'payload', 'effort'],
  ['request', 'payload', 'reasoning', 'effort'],
  ['body', 'reasoning_effort'],
  ['body', 'reasoningEffort'],
  ['body', 'effort'],
  ['body', 'reasoning', 'effort'],
  ['payload', 'reasoning_effort'],
  ['payload', 'reasoningEffort'],
  ['payload', 'effort'],
  ['payload', 'reasoning', 'effort'],
  ['response', 'reasoning_effort'],
  ['response', 'reasoningEffort'],
  ['response', 'effort'],
  ['response', 'reasoning', 'effort'],
  ['response', 'thinking', 'effort'],
  ['response', 'body', 'reasoning_effort'],
  ['response', 'body', 'reasoningEffort'],
  ['response', 'body', 'effort'],
  ['response', 'body', 'reasoning', 'effort']
];
const REQUEST_DETAIL_REQUEST_ID_PATHS: ReadonlyArray<readonly string[]> = [
  ['request_id'],
  ['requestId'],
  ['request', 'request_id'],
  ['request', 'requestId'],
  ['response', 'request_id'],
  ['response', 'requestId'],
  ['metadata', 'request_id'],
  ['metadata', 'requestId']
];
const REQUEST_DETAIL_SERVICE_TIER_PATHS: ReadonlyArray<readonly string[]> = [
  ['service_tier'],
  ['serviceTier'],
  ['tier'],
  ['metadata', 'service_tier'],
  ['metadata', 'serviceTier'],
  ['request', 'service_tier'],
  ['request', 'serviceTier'],
  ['request', 'body', 'service_tier'],
  ['request', 'body', 'serviceTier'],
  ['request', 'payload', 'service_tier'],
  ['request', 'payload', 'serviceTier'],
  ['body', 'service_tier'],
  ['body', 'serviceTier'],
  ['payload', 'service_tier'],
  ['payload', 'serviceTier'],
  ['response', 'service_tier'],
  ['response', 'serviceTier'],
  ['response', 'body', 'service_tier'],
  ['response', 'body', 'serviceTier']
];
const REQUEST_DETAIL_ENDPOINT_VALUE_PATHS: ReadonlyArray<readonly string[]> = [
  ['endpoint'],
  ['url'],
  ['request', 'endpoint'],
  ['request', 'url'],
  ['request', 'uri'],
  ['request', 'path'],
  ['request', 'pathname'],
  ['request', 'body', 'endpoint'],
  ['request', 'body', 'path'],
  ['request', 'payload', 'endpoint'],
  ['request', 'payload', 'path']
];
const REQUEST_DETAIL_REQUEST_PATH_PATHS: ReadonlyArray<readonly string[]> = [
  ['path'],
  ['request', 'path'],
  ['url'],
  ['request', 'url'],
  ['request', 'uri'],
  ['request', 'route'],
  ['request', 'pathname'],
  ['request', 'body', 'path'],
  ['request', 'payload', 'path']
];
const REQUEST_DETAIL_REQUEST_METHOD_PATHS: ReadonlyArray<readonly string[]> = [
  ['method'],
  ['request_method'],
  ['requestMethod'],
  ['request', 'method'],
  ['request', 'http_method'],
  ['request', 'httpMethod'],
  ['request', 'verb'],
  ['request', 'body', 'method'],
  ['request', 'payload', 'method']
];
const REQUEST_DETAIL_EXCLUDED_KEYS = new Set([
  'timestamp',
  'source',
  'auth_index',
  'authIndex',
  'AuthIndex',
  'failed',
  'tokens',
  'latency_ms',
  'latencyMs',
  'method',
  'request_method',
  'requestMethod',
  'status',
  'request_status',
  'requestStatus',
  'state',
  'result',
  'status_code',
  'statusCode',
  'http_status',
  'httpStatus',
  'response_status',
  'responseStatus',
  'reasoning_effort',
  'reasoningEffort',
  'effort',
  'service_tier',
  'serviceTier',
  'tier',
  'endpoint',
  'path',
  'url'
]);
const REQUEST_DETAIL_MAX_ADDITIONAL_DEPTH = 3;
const REQUEST_EVENT_ENDPOINT_METHOD_REGEX = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/i;

type RequestEventRow = {
  id: string;
  timestamp: string;
  timestampMs: number;
  timestampLabel: string;
  model: string;
  sourceKey: string;
  sourceRaw: string | null;
  sourceRawDisplay: string;
  source: string;
  sourceType: string;
  requestId: string | null;
  authIndex: string;
  failed: boolean;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  cost: number;
  endpoint: string | null;
  endpointDisplay: string;
  endpointMethod: string;
  endpointPath: string | null;
  endpointPathDisplay: string;
  rawStatus: string;
  statusCode: string;
  reasoningEffort: string;
  serviceTier: string;
  additionalFields: RequestEventDetailField[];
};

type RequestEventDetailField = {
  key: string;
  label: string;
  value: string;
};

export interface RequestEventsDetailsCardProps {
  usage: unknown;
  loading: boolean;
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
  modelPrices: Record<string, ModelPrice>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const normalizeOptionalDetailValue = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const withDetailFallback = (value: string | null | undefined) => value ?? DETAIL_FIELD_NOT_AVAILABLE;

const toDisplayValue = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => toDisplayValue(item))
      .filter((item): item is string => Boolean(item));
    return parts.length ? parts.join(', ') : null;
  }

  if (isRecord(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
};

const getValueAtPath = (record: Record<string, unknown>, path: readonly string[]): unknown => {
  let current: unknown = record;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const getFirstDisplayValue = (
  record: Record<string, unknown> | null,
  paths: ReadonlyArray<readonly string[]>
): string | null => {
  if (!record) {
    return null;
  }

  for (const path of paths) {
    const displayValue = toDisplayValue(getValueAtPath(record, path));
    if (displayValue) {
      return displayValue;
    }
  }

  return null;
};

const normalizeReasoningEffort = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'medim') {
    return 'medium';
  }

  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh') {
    return normalized;
  }

  return value;
};

const formatFieldLabel = (key: string) =>
  key
    .replace(/\./g, ' / ')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const SENSITIVE_REQUEST_DETAIL_KEY_REGEX = /(source|path|url|endpoint|token|authorization|secret|key|email)/i;

const maskDetailFieldValue = (pathKey: string, value: string) => {
  if (!SENSITIVE_REQUEST_DETAIL_KEY_REGEX.test(pathKey)) {
    return value;
  }

  const kind = /source|email/i.test(pathKey)
    ? 'source'
    : /path|url|endpoint/i.test(pathKey)
      ? 'path'
      : 'generic';

  return obfuscateUsageDisplayValue(value, { kind });
};

const resolveRequestPathFromEndpoint = (endpoint: string | null): string | null => {
  if (!endpoint) {
    return null;
  }

  const match = endpoint.match(REQUEST_EVENT_ENDPOINT_METHOD_REGEX);
  if (match?.[2]) {
    return match[2];
  }

  return endpoint;
};

const formatRequestEventCost = (value: number): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '$0.000000';
  }

  return `$${REQUEST_EVENT_COST_FORMATTER.format(num)}`;
};

const formatHistoryOptionLabel = (prefix: string, value: string) => `${prefix} · ${value}`;

const sortFilterOptions = (
  options: Array<{ value: string; label: string }>,
  historicalPrefix: string
) =>
  [...options].sort((a, b) => {
    const aHistorical = a.label.startsWith(`${historicalPrefix} · `);
    const bHistorical = b.label.startsWith(`${historicalPrefix} · `);

    if (aHistorical !== bHistorical) {
      return aHistorical ? 1 : -1;
    }

    return a.label.localeCompare(b.label);
  });

const buildAdditionalFields = (rawDetail: Record<string, unknown>): RequestEventDetailField[] => {
  const fields: RequestEventDetailField[] = [];
  const seen = new Set<string>();

  const addField = (pathKey: string, value: unknown) => {
    const leafKey = pathKey.split('.').pop() ?? pathKey;
    if (REQUEST_DETAIL_EXCLUDED_KEYS.has(pathKey) || REQUEST_DETAIL_EXCLUDED_KEYS.has(leafKey)) {
      return;
    }

    const displayValue = toDisplayValue(value);
    if (!displayValue) {
      return;
    }

    const normalizedKey = pathKey.toLowerCase();
    if (seen.has(normalizedKey)) {
      return;
    }
    seen.add(normalizedKey);

    fields.push({
      key: pathKey,
      label: formatFieldLabel(pathKey),
      value: maskDetailFieldValue(pathKey, displayValue)
    });
  };

  const collectFields = (pathKey: string, value: unknown, depth: number) => {
    const leafKey = pathKey.split('.').pop() ?? pathKey;
    if (REQUEST_DETAIL_EXCLUDED_KEYS.has(pathKey) || REQUEST_DETAIL_EXCLUDED_KEYS.has(leafKey)) {
      return;
    }

    if (isRecord(value) && depth < REQUEST_DETAIL_MAX_ADDITIONAL_DEPTH) {
      Object.entries(value).forEach(([nestedKey, nestedValue]) => {
        collectFields(`${pathKey}.${nestedKey}`, nestedValue, depth + 1);
      });
      return;
    }

    addField(pathKey, value);
  };

  Object.entries(rawDetail).forEach(([key, value]) => {
    if (REQUEST_DETAIL_EXCLUDED_KEYS.has(key)) {
      return;
    }

    if (isRecord(value)) {
      collectFields(key, value, 1);
      return;
    }

    addField(key, value);
  });

  return fields.sort((left, right) => left.label.localeCompare(right.label));
};

const encodeCsv = (value: string | number): string => {
  const text = String(value ?? '');
  const trimmedLeft = text.replace(/^\s+/, '');
  const safeText = trimmedLeft && /^[=+\-@]/.test(trimmedLeft) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
};

const sortStringValues = (values: string[]) => values.sort((left, right) => left.localeCompare(right));

const sortStatusCodeValues = (values: string[]) =>
  [...values].sort((left, right) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    const leftIsNumber = Number.isFinite(leftNumber);
    const rightIsNumber = Number.isFinite(rightNumber);

    if (leftIsNumber && rightIsNumber) {
      return leftNumber - rightNumber;
    }

    if (leftIsNumber) return -1;
    if (rightIsNumber) return 1;

    return left.localeCompare(right);
  });

const sortReasoningValues = (values: string[]) => {
  const order = new Map([
    ['low', 0],
    ['medium', 1],
    ['high', 2],
    ['xhigh', 3],
    [DETAIL_FIELD_NOT_AVAILABLE, 99]
  ]);

  return [...values].sort((left, right) => {
    const leftRank = order.get(left.toLowerCase());
    const rightRank = order.get(right.toLowerCase());

    if (leftRank !== undefined || rightRank !== undefined) {
      return (leftRank ?? 50) - (rightRank ?? 50);
    }

    return left.localeCompare(right);
  });
};

export function RequestEventsDetailsCard({
  usage,
  loading,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
  modelPrices
}: RequestEventsDetailsCardProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const historicalSourceLabel = t('usage_stats.historical_source_prefix');
  const historicalAuthIndexLabel = t('usage_stats.historical_auth_index_prefix');
  const latencyHint = t('usage_stats.latency_unit_hint', {
    field: LATENCY_SOURCE_FIELD,
    unit: t('usage_stats.duration_unit_ms')
  });

  const [modelFilter, setModelFilter] = useState(ALL_FILTER);
  const [sourceFilter, setSourceFilter] = useState(ALL_FILTER);
  const [authIndexFilter, setAuthIndexFilter] = useState(ALL_FILTER);
  const [resultFilter, setResultFilter] = useState(ALL_FILTER);
  const [statusCodeFilter, setStatusCodeFilter] = useState(ALL_FILTER);
  const [reasoningEffortFilter, setReasoningEffortFilter] = useState(ALL_FILTER);
  const [serviceTierFilter, setServiceTierFilter] = useState(ALL_FILTER);
  const [requestMethodFilter, setRequestMethodFilter] = useState(ALL_FILTER);
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());

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
          const key = normalizeAuthIndex(getAuthFileIndexValue(file));
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

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const rows = useMemo<RequestEventRow[]>(() => {
    const details = collectUsageDetailsWithEndpoint(usage);

    const baseRows = details.map((detail, index) => {
      const timestamp = detail.timestamp;
      const timestampMs =
        typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0
          ? detail.__timestampMs
          : parseTimestampMs(timestamp);
      const date = Number.isNaN(timestampMs) ? null : new Date(timestampMs);
      const normalizedSource = String(detail.source ?? '').trim();
      const authIndexRaw = detail.auth_index as unknown;
      const authIndex =
        authIndexRaw === null || authIndexRaw === undefined || authIndexRaw === ''
          ? '-'
          : String(authIndexRaw);
      const sourceInfo = resolveSourceDisplay(normalizedSource, authIndexRaw, sourceInfoMap, authFileMap);
      const source = sourceInfo.displayName;
      const sourceKey = sourceInfo.identityKey ?? `source:${normalizedSource || source}`;
      const sourceType = sourceInfo.type;
      const model = String(detail.__modelName ?? '').trim() || '-';
      const inputTokens = Math.max(toNumber(detail.tokens?.input_tokens), 0);
      const outputTokens = Math.max(toNumber(detail.tokens?.output_tokens), 0);
      const reasoningTokens = Math.max(toNumber(detail.tokens?.reasoning_tokens), 0);
      const cachedTokens = Math.max(
        Math.max(toNumber(detail.tokens?.cached_tokens), 0),
        Math.max(toNumber(detail.tokens?.cache_tokens), 0)
      );
      const totalTokens = Math.max(toNumber(detail.tokens?.total_tokens), extractTotalTokens(detail));
      const latencyMs = extractLatencyMs(detail);
      const cost = calculateCost(detail, modelPrices);
      const rawDetail = isRecord(detail.__rawDetail) ? detail.__rawDetail : null;
      const hasStructuredEndpoint = Boolean(detail.__endpointMethod?.trim() || detail.__endpointPath?.trim());
      const endpoint = normalizeOptionalDetailValue(
        getFirstDisplayValue(rawDetail, REQUEST_DETAIL_ENDPOINT_VALUE_PATHS) ||
          (hasStructuredEndpoint ? detail.__endpoint?.trim() : null)
      );
      const endpointDisplay = withDetailFallback(
        endpoint ? obfuscateUsageDisplayValue(endpoint, { kind: 'endpoint' }) : null
      );
      const endpointMethod = normalizeOptionalDetailValue(
        getFirstDisplayValue(rawDetail, REQUEST_DETAIL_REQUEST_METHOD_PATHS) || detail.__endpointMethod?.trim()
      )?.toUpperCase();
      const endpointPath = normalizeOptionalDetailValue(
        getFirstDisplayValue(rawDetail, REQUEST_DETAIL_REQUEST_PATH_PATHS) ||
          (hasStructuredEndpoint ? detail.__endpointPath?.trim() : null)
      );
      const endpointPathDisplay = withDetailFallback(
        endpointPath ? obfuscateUsageDisplayValue(endpointPath, { kind: 'path' }) : null
      );
      const rawStatus = withDetailFallback(
        normalizeOptionalDetailValue(getFirstDisplayValue(rawDetail, REQUEST_DETAIL_STATUS_PATHS))
      );
      const statusCode = withDetailFallback(
        normalizeOptionalDetailValue(getFirstDisplayValue(rawDetail, REQUEST_DETAIL_STATUS_CODE_PATHS))
      );
      const reasoningEffort = withDetailFallback(
        normalizeReasoningEffort(
          normalizeOptionalDetailValue(getFirstDisplayValue(rawDetail, REQUEST_DETAIL_REASONING_PATHS))
        )
      );
      const requestId = normalizeOptionalDetailValue(
        getFirstDisplayValue(rawDetail, REQUEST_DETAIL_REQUEST_ID_PATHS)
      );
      const serviceTier = withDetailFallback(
        normalizeOptionalDetailValue(getFirstDisplayValue(rawDetail, REQUEST_DETAIL_SERVICE_TIER_PATHS))
      );
      const additionalFields = rawDetail ? buildAdditionalFields(rawDetail) : [];
      const sourceRaw = normalizeOptionalDetailValue(toDisplayValue(rawDetail?.source));
      const sourceRawDisplay = withDetailFallback(
        sourceRaw ? obfuscateUsageDisplayValue(sourceRaw, { kind: 'source' }) : null
      );

      return {
        id: `${timestamp}-${model}-${sourceKey}-${authIndex}-${index}`,
        timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? date.toLocaleString(i18n.language) : timestamp || '-',
        model,
        sourceKey,
        sourceRaw,
        sourceRawDisplay,
        source,
        sourceType,
        requestId,
        authIndex,
        failed: detail.failed === true,
        latencyMs,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedTokens,
        totalTokens,
        cost,
        endpoint,
        endpointDisplay,
        endpointMethod: withDetailFallback(endpointMethod),
        endpointPath,
        endpointPathDisplay,
        rawStatus,
        statusCode,
        reasoningEffort,
        serviceTier,
        additionalFields
      };
    });

    const sourceLabelKeyMap = new Map<string, Set<string>>();
    baseRows.forEach((row) => {
      const keys = sourceLabelKeyMap.get(row.source) ?? new Set<string>();
      keys.add(row.sourceKey);
      sourceLabelKeyMap.set(row.source, keys);
    });

    const buildDisambiguatedSourceLabel = (row: RequestEventRow) => {
      const labelKeyCount = sourceLabelKeyMap.get(row.source)?.size ?? 0;
      if (labelKeyCount <= 1) {
        return row.source;
      }

      if (row.authIndex !== '-') {
        return `${row.source} · ${row.authIndex}`;
      }

      if (row.sourceType) {
        return `${row.source} · ${row.sourceType}`;
      }

      return `${row.source} · ${row.sourceKey}`;
    };

    return baseRows
      .map((row) => ({
        ...row,
        source: buildDisambiguatedSourceLabel(row)
      }))
      .sort((a, b) => b.timestampMs - a.timestampMs);
  }, [authFileMap, i18n.language, modelPrices, sourceInfoMap, usage]);

  const hasLatencyData = useMemo(() => rows.some((row) => row.latencyMs !== null), [rows]);
  const hasCostData = useMemo(() => rows.some((row) => row.cost > 0), [rows]);

  const modelOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(new Set(rows.map((row) => row.model))).map((model) => ({
        value: model,
        label: model
      }))
    ],
    [rows, t]
  );

  const sourceOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    rows.forEach((row) => {
      if (!optionMap.has(row.sourceKey)) {
        const label =
          row.sourceType || row.sourceKey.startsWith('openai:') || row.sourceKey.startsWith('type:')
            ? row.source
            : formatHistoryOptionLabel(historicalSourceLabel, row.source);
        optionMap.set(row.sourceKey, label);
      }
    });

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...sortFilterOptions(
        Array.from(optionMap.entries()).map(([value, label]) => ({
          value,
          label
        })),
        historicalSourceLabel
      )
    ];
  }, [historicalSourceLabel, rows, t]);

  const authIndexOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...sortFilterOptions(
        Array.from(new Set(rows.map((row) => row.authIndex))).map((authIndex) => ({
          value: authIndex,
          label:
            authIndex === DETAIL_FIELD_NOT_AVAILABLE
              ? authIndex
              : authFileMap.get(authIndex)?.name ||
                formatHistoryOptionLabel(historicalAuthIndexLabel, authIndex)
        })),
        historicalAuthIndexLabel
      )
    ],
    [authFileMap, historicalAuthIndexLabel, rows, t]
  );

  const resultOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      { value: RESULT_FILTER_SUCCESS, label: t('stats.success') },
      { value: RESULT_FILTER_FAILURE, label: t('stats.failure') }
    ],
    [t]
  );

  const statusCodeOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...sortStatusCodeValues(Array.from(new Set(rows.map((row) => row.statusCode)))).map((statusCode) => ({
        value: statusCode,
        label: statusCode
      }))
    ],
    [rows, t]
  );

  const reasoningEffortOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...sortReasoningValues(Array.from(new Set(rows.map((row) => row.reasoningEffort)))).map((reasoningEffort) => ({
        value: reasoningEffort,
        label: reasoningEffort
      }))
    ],
    [rows, t]
  );

  const serviceTierOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...sortStringValues(Array.from(new Set(rows.map((row) => row.serviceTier)))).map((serviceTier) => ({
        value: serviceTier,
        label: serviceTier
      }))
    ],
    [rows, t]
  );

  const requestMethodOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...sortStringValues(Array.from(new Set(rows.map((row) => row.endpointMethod)))).map((requestMethod) => ({
        value: requestMethod,
        label: requestMethod
      }))
    ],
    [rows, t]
  );

  const modelOptionSet = useMemo(() => new Set(modelOptions.map((option) => option.value)), [modelOptions]);
  const sourceOptionSet = useMemo(() => new Set(sourceOptions.map((option) => option.value)), [sourceOptions]);
  const authIndexOptionSet = useMemo(
    () => new Set(authIndexOptions.map((option) => option.value)),
    [authIndexOptions]
  );
  const resultOptionSet = useMemo(() => new Set(resultOptions.map((option) => option.value)), [resultOptions]);
  const statusCodeOptionSet = useMemo(
    () => new Set(statusCodeOptions.map((option) => option.value)),
    [statusCodeOptions]
  );
  const reasoningEffortOptionSet = useMemo(
    () => new Set(reasoningEffortOptions.map((option) => option.value)),
    [reasoningEffortOptions]
  );
  const serviceTierOptionSet = useMemo(
    () => new Set(serviceTierOptions.map((option) => option.value)),
    [serviceTierOptions]
  );
  const requestMethodOptionSet = useMemo(
    () => new Set(requestMethodOptions.map((option) => option.value)),
    [requestMethodOptions]
  );

  const effectiveModelFilter = modelOptionSet.has(modelFilter) ? modelFilter : ALL_FILTER;
  const effectiveSourceFilter = sourceOptionSet.has(sourceFilter) ? sourceFilter : ALL_FILTER;
  const effectiveAuthIndexFilter = authIndexOptionSet.has(authIndexFilter)
    ? authIndexFilter
    : ALL_FILTER;
  const effectiveResultFilter = resultOptionSet.has(resultFilter) ? resultFilter : ALL_FILTER;
  const effectiveStatusCodeFilter = statusCodeOptionSet.has(statusCodeFilter)
    ? statusCodeFilter
    : ALL_FILTER;
  const effectiveReasoningEffortFilter = reasoningEffortOptionSet.has(reasoningEffortFilter)
    ? reasoningEffortFilter
    : ALL_FILTER;
  const effectiveServiceTierFilter = serviceTierOptionSet.has(serviceTierFilter)
    ? serviceTierFilter
    : ALL_FILTER;
  const effectiveRequestMethodFilter = requestMethodOptionSet.has(requestMethodFilter)
    ? requestMethodFilter
    : ALL_FILTER;

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const modelMatched =
          effectiveModelFilter === ALL_FILTER || row.model === effectiveModelFilter;
        const sourceMatched =
          effectiveSourceFilter === ALL_FILTER || row.sourceKey === effectiveSourceFilter;
        const authIndexMatched =
          effectiveAuthIndexFilter === ALL_FILTER || row.authIndex === effectiveAuthIndexFilter;
        const resultMatched =
          effectiveResultFilter === ALL_FILTER ||
          (effectiveResultFilter === RESULT_FILTER_SUCCESS ? !row.failed : row.failed);
        const statusCodeMatched =
          effectiveStatusCodeFilter === ALL_FILTER || row.statusCode === effectiveStatusCodeFilter;
        const reasoningEffortMatched =
          effectiveReasoningEffortFilter === ALL_FILTER ||
          row.reasoningEffort === effectiveReasoningEffortFilter;
        const serviceTierMatched =
          effectiveServiceTierFilter === ALL_FILTER || row.serviceTier === effectiveServiceTierFilter;
        const requestMethodMatched =
          effectiveRequestMethodFilter === ALL_FILTER || row.endpointMethod === effectiveRequestMethodFilter;

        return (
          modelMatched &&
          sourceMatched &&
          authIndexMatched &&
          resultMatched &&
          statusCodeMatched &&
          reasoningEffortMatched &&
          serviceTierMatched &&
          requestMethodMatched
        );
      }),
    [
      effectiveAuthIndexFilter,
      effectiveModelFilter,
      effectiveReasoningEffortFilter,
      effectiveRequestMethodFilter,
      effectiveResultFilter,
      effectiveServiceTierFilter,
      effectiveSourceFilter,
      effectiveStatusCodeFilter,
      rows
    ]
  );

  const renderedRows = useMemo(() => filteredRows.slice(0, MAX_RENDERED_EVENTS), [filteredRows]);
  const detailColumnCount = hasLatencyData ? 12 : 11;

  const hasActiveFilters =
    effectiveModelFilter !== ALL_FILTER ||
    effectiveSourceFilter !== ALL_FILTER ||
    effectiveAuthIndexFilter !== ALL_FILTER ||
    effectiveResultFilter !== ALL_FILTER ||
    effectiveStatusCodeFilter !== ALL_FILTER ||
    effectiveReasoningEffortFilter !== ALL_FILTER ||
    effectiveServiceTierFilter !== ALL_FILTER ||
    effectiveRequestMethodFilter !== ALL_FILTER;

  const handleClearFilters = () => {
    setModelFilter(ALL_FILTER);
    setSourceFilter(ALL_FILTER);
    setAuthIndexFilter(ALL_FILTER);
    setResultFilter(ALL_FILTER);
    setStatusCodeFilter(ALL_FILTER);
    setReasoningEffortFilter(ALL_FILTER);
    setServiceTierFilter(ALL_FILTER);
    setRequestMethodFilter(ALL_FILTER);
  };

  useEffect(() => {
    const visibleIds = new Set(renderedRows.map((row) => row.id));
    setExpandedRowIds((prev) => {
      const nextIds = Array.from(prev).filter((id) => visibleIds.has(id));
      return nextIds.length === prev.size ? prev : new Set(nextIds);
    });
  }, [renderedRows]);

  const toggleExpandedRow = (rowId: string) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  const handleExportCsv = () => {
    if (!filteredRows.length) return;

    const csvHeader = [
      'timestamp',
      'model',
      'source',
      'source_raw',
      'auth_index',
      'result',
      ...(hasLatencyData ? ['latency_ms'] : []),
      ...(hasCostData ? ['cost_usd'] : []),
      'input_tokens',
      'output_tokens',
      'reasoning_tokens',
      'cached_tokens',
      'total_tokens'
    ];

    const csvRows = filteredRows.map((row) =>
      [
        row.timestamp,
        row.model,
        row.source,
        row.sourceRaw ?? '',
        row.authIndex,
        row.failed ? 'failed' : 'success',
        ...(hasLatencyData ? [row.latencyMs ?? ''] : []),
        ...(hasCostData ? [row.cost > 0 ? row.cost.toFixed(8) : ''] : []),
        row.inputTokens,
        row.outputTokens,
        row.reasoningTokens,
        row.cachedTokens,
        row.totalTokens
      ]
        .map((value) => encodeCsv(value))
        .join(',')
    );

    const content = [csvHeader.join(','), ...csvRows].join('\n');
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.csv`,
      blob: new Blob([content], { type: 'text/csv;charset=utf-8' })
    });
  };

  const handleExportJson = () => {
    if (!filteredRows.length) return;

    const payload = filteredRows.map((row) => ({
      timestamp: row.timestamp,
      model: row.model,
      source: row.source,
      source_raw: row.sourceRaw ?? '',
      auth_index: row.authIndex,
      failed: row.failed,
      ...(hasLatencyData && row.latencyMs !== null ? { latency_ms: row.latencyMs } : {}),
      ...(hasCostData ? { cost_usd: row.cost > 0 ? row.cost : 0 } : {}),
      tokens: {
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        reasoning_tokens: row.reasoningTokens,
        cached_tokens: row.cachedTokens,
        total_tokens: row.totalTokens
      }
    }));

    const content = JSON.stringify(payload, null, 2);
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.json`,
      blob: new Blob([content], { type: 'application/json;charset=utf-8' })
    });
  };

  const renderDetailTextItem = (
    label: string,
    value: string,
    options: {
      code?: boolean;
      title?: string;
    } = {}
  ) => {
    return (
      <div className={styles.requestEventsDetailItem}>
        <span className={styles.requestEventsDetailLabel}>{label}</span>
        <span
          className={`${styles.requestEventsDetailValue} ${
            options.code ? styles.requestEventsDetailCode : ''
          }`.trim()}
          title={options.title ?? value}
        >
          {value}
        </span>
      </div>
    );
  };

  const handleOpenLogs = (row: RequestEventRow, traceRequested: boolean) => {
    const requestPath = row.endpointPath ?? resolveRequestPathFromEndpoint(row.endpoint);
    const statusCodeNumber = Number.parseInt(row.statusCode, 10);
    const search = buildUsageLogsJumpSearch({
      searchText: row.requestId || requestPath || row.endpoint || row.timestamp,
      method: row.endpointMethod !== DETAIL_FIELD_NOT_AVAILABLE ? row.endpointMethod : null,
      path: requestPath,
      statusCode: Number.isFinite(statusCodeNumber) ? statusCodeNumber : null,
      timestamp: row.timestamp,
      model: row.model !== DETAIL_FIELD_NOT_AVAILABLE ? row.model : null,
      requestId: row.requestId,
      trace: traceRequested
    });

    navigate(search ? `/logs?${search}` : '/logs');
  };

  return (
    <Card
      title={t('usage_stats.request_events_title')}
      extra={
        <div className={styles.requestEventsActions}>
          <Button variant="ghost" size="sm" onClick={handleClearFilters} disabled={!hasActiveFilters}>
            {t('usage_stats.clear_filters')}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExportCsv} disabled={filteredRows.length === 0}>
            {t('usage_stats.export_csv')}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExportJson} disabled={filteredRows.length === 0}>
            {t('usage_stats.export_json')}
          </Button>
        </div>
      }
    >
      <div className={styles.requestEventsToolbar}>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>{t('usage_stats.request_events_filter_model')}</span>
          <Select
            value={effectiveModelFilter}
            options={modelOptions}
            onChange={setModelFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_model')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>{t('usage_stats.request_events_filter_source')}</span>
          <Select
            value={effectiveSourceFilter}
            options={sourceOptions}
            onChange={setSourceFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_source')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_auth_index')}
          </span>
          <Select
            value={effectiveAuthIndexFilter}
            options={authIndexOptions}
            onChange={setAuthIndexFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_auth_index')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>{t('usage_stats.request_events_filter_result')}</span>
          <Select
            value={effectiveResultFilter}
            options={resultOptions}
            onChange={setResultFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_result')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>{t('usage_stats.request_events_filter_status_code')}</span>
          <Select
            value={effectiveStatusCodeFilter}
            options={statusCodeOptions}
            onChange={setStatusCodeFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_status_code')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_reasoning_effort')}
          </span>
          <Select
            value={effectiveReasoningEffortFilter}
            options={reasoningEffortOptions}
            onChange={setReasoningEffortFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_reasoning_effort')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_service_tier')}
          </span>
          <Select
            value={effectiveServiceTierFilter}
            options={serviceTierOptions}
            onChange={setServiceTierFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_service_tier')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_request_method')}
          </span>
          <Select
            value={effectiveRequestMethodFilter}
            options={requestMethodOptions}
            onChange={setRequestMethodFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_request_method')}
            fullWidth={false}
          />
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_empty_title')}
          description={t('usage_stats.request_events_empty_desc')}
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_no_result_title')}
          description={t('usage_stats.request_events_no_result_desc')}
        />
      ) : (
        <>
          <div className={styles.requestEventsMeta}>
            <span>{t('usage_stats.request_events_count', { count: filteredRows.length })}</span>
            {hasLatencyData && <span className={styles.requestEventsLimitHint}>{latencyHint}</span>}
            {filteredRows.length > MAX_RENDERED_EVENTS && (
              <span className={styles.requestEventsLimitHint}>
                {t('usage_stats.request_events_limit_hint', {
                  shown: MAX_RENDERED_EVENTS,
                  total: filteredRows.length
                })}
              </span>
            )}
          </div>

          <div className={styles.requestEventsTableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('usage_stats.request_events_timestamp')}</th>
                  <th>{t('usage_stats.model_name')}</th>
                  <th>{t('usage_stats.request_events_source')}</th>
                  <th>{t('usage_stats.request_events_auth_index')}</th>
                  <th>{t('usage_stats.request_events_result')}</th>
                  {hasLatencyData && <th title={latencyHint}>{t('usage_stats.time')}</th>}
                  <th>{t('usage_stats.request_events_cost')}</th>
                  <th>{t('usage_stats.input_tokens')}</th>
                  <th>{t('usage_stats.output_tokens')}</th>
                  <th>{t('usage_stats.reasoning_tokens')}</th>
                  <th>{t('usage_stats.cached_tokens')}</th>
                  <th>{t('usage_stats.total_tokens')}</th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row) => {
                  const isExpanded = expandedRowIds.has(row.id);

                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={`${styles.requestEventsSummaryRow} ${
                          isExpanded ? styles.requestEventsSummaryRowExpanded : ''
                        }`}
                        onClick={() => toggleExpandedRow(row.id)}
                      >
                        <td title={row.timestamp} className={styles.requestEventsTimestamp}>
                          <button
                            type="button"
                            className={styles.requestEventsToggleButton}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleExpandedRow(row.id);
                            }}
                            aria-expanded={isExpanded}
                            title={
                              isExpanded
                                ? t('usage_stats.request_events_detail_collapse')
                                : t('usage_stats.request_events_detail_expand')
                            }
                          >
                            <span className={styles.requestEventsToggleIndicator}>
                              {isExpanded ? '▼' : '▶'}
                            </span>
                            <span className={styles.requestEventsToggleText}>{row.timestampLabel}</span>
                          </button>
                        </td>
                        <td className={styles.modelCell}>{row.model}</td>
                        <td className={styles.requestEventsSourceCell} title={row.source}>
                          <span>{row.source}</span>
                          {row.sourceType && <span className={styles.credentialType}>{row.sourceType}</span>}
                        </td>
                        <td className={styles.requestEventsAuthIndex} title={row.authIndex}>
                          {row.authIndex}
                        </td>
                        <td>
                          <span
                            className={
                              row.failed
                                ? styles.requestEventsResultFailed
                                : styles.requestEventsResultSuccess
                            }
                          >
                            {row.failed ? t('stats.failure') : t('stats.success')}
                          </span>
                        </td>
                        {hasLatencyData && <td className={styles.durationCell}>{formatDurationMs(row.latencyMs)}</td>}
                        <td className={styles.requestEventsCost}>
                          {row.cost > 0 ? formatRequestEventCost(row.cost) : '--'}
                        </td>
                        <td>{row.inputTokens.toLocaleString()}</td>
                        <td>{row.outputTokens.toLocaleString()}</td>
                        <td>{row.reasoningTokens.toLocaleString()}</td>
                        <td>{row.cachedTokens.toLocaleString()}</td>
                        <td>{row.totalTokens.toLocaleString()}</td>
                      </tr>

                      {isExpanded && (
                        <tr className={styles.requestEventsExpandedRow}>
                          <td colSpan={detailColumnCount} className={styles.requestEventsExpandedCell}>
                            <div className={styles.requestEventsExpandedPanel}>
                              <div className={styles.requestEventsDetailActions}>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleOpenLogs(row, false)}
                                  disabled={!Boolean(row.requestId || row.endpointPath || row.endpoint)}
                                >
                                  {t('usage_stats.request_events_view_logs')}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenLogs(row, true)}
                                  disabled={
                                    !isTraceableRequestPath(
                                      row.endpointPath ?? resolveRequestPathFromEndpoint(row.endpoint) ?? undefined
                                    )
                                  }
                                >
                                  {t('usage_stats.request_events_open_trace')}
                                </Button>
                              </div>

                              <div className={styles.requestEventsExpandedGrid}>
                                {renderDetailTextItem(
                                  t('usage_stats.request_events_detail_status'),
                                  row.rawStatus
                                )}
                                {renderDetailTextItem(
                                  t('usage_stats.request_events_detail_status_code'),
                                  row.statusCode
                                )}
                                {renderDetailTextItem(
                                  t('usage_stats.request_events_detail_reasoning_effort'),
                                  row.reasoningEffort
                                )}
                                {renderDetailTextItem(
                                  t('usage_stats.request_events_detail_endpoint'),
                                  row.endpointDisplay,
                                  { code: true }
                                )}
                                {renderDetailTextItem(
                                  t('usage_stats.request_events_detail_source_raw'),
                                  row.sourceRawDisplay,
                                  { code: true }
                                )}
                                {renderDetailTextItem(
                                  t('usage_stats.request_events_detail_service_tier'),
                                  row.serviceTier
                                )}
                                {renderDetailTextItem(
                                  t('usage_stats.request_events_detail_request_path'),
                                  row.endpointPathDisplay,
                                  { code: true }
                                )}
                                {renderDetailTextItem(
                                  t('usage_stats.request_events_detail_request_method'),
                                  row.endpointMethod
                                )}
                              </div>

                              {row.additionalFields.length > 0 && (
                                <div className={styles.requestEventsAdditionalSection}>
                                  <div className={styles.requestEventsAdditionalTitle}>
                                    {t('usage_stats.request_events_detail_additional')}
                                  </div>
                                  <div className={styles.requestEventsExpandedGrid}>
                                    {row.additionalFields.map((field) => (
                                      <div key={`${row.id}-${field.key}`} className={styles.requestEventsDetailItem}>
                                        <span className={styles.requestEventsDetailLabel}>{field.label}</span>
                                        <span
                                          className={`${styles.requestEventsDetailValue} ${styles.requestEventsDetailCode}`}
                                          title={field.value}
                                        >
                                          {field.value}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
