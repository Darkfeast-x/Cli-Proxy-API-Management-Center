export interface UsageLogsJumpPayload {
  searchText?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | string | null;
  timestamp?: string | null;
  model?: string | null;
  requestId?: string | null;
  trace?: boolean;
}

export interface ParsedUsageLogsJump {
  searchText: string;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  timestamp: string | null;
  model: string | null;
  requestId: string | null;
  trace: boolean;
  hasPayload: boolean;
  signature: string;
}

export const USAGE_LOGS_JUMP_QUERY_KEYS = {
  searchText: 'usage_q',
  method: 'usage_method',
  path: 'usage_path',
  statusCode: 'usage_status',
  timestamp: 'usage_ts',
  model: 'usage_model',
  requestId: 'usage_request_id',
  trace: 'usage_trace'
} as const;

const normalizeTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const buildUsageLogsJumpSearch = (payload: UsageLogsJumpPayload): string => {
  const params = new URLSearchParams();
  const searchText = normalizeTrimmedString(payload.searchText);
  const method = normalizeTrimmedString(payload.method);
  const path = normalizeTrimmedString(payload.path);
  const timestamp = normalizeTrimmedString(payload.timestamp);
  const model = normalizeTrimmedString(payload.model);
  const requestId = normalizeTrimmedString(payload.requestId);
  const statusCode =
    typeof payload.statusCode === 'number'
      ? String(payload.statusCode)
      : normalizeTrimmedString(payload.statusCode);

  if (searchText) {
    params.set(USAGE_LOGS_JUMP_QUERY_KEYS.searchText, searchText);
  }
  if (method) {
    params.set(USAGE_LOGS_JUMP_QUERY_KEYS.method, method);
  }
  if (path) {
    params.set(USAGE_LOGS_JUMP_QUERY_KEYS.path, path);
  }
  if (statusCode) {
    params.set(USAGE_LOGS_JUMP_QUERY_KEYS.statusCode, statusCode);
  }
  if (timestamp) {
    params.set(USAGE_LOGS_JUMP_QUERY_KEYS.timestamp, timestamp);
  }
  if (model) {
    params.set(USAGE_LOGS_JUMP_QUERY_KEYS.model, model);
  }
  if (requestId) {
    params.set(USAGE_LOGS_JUMP_QUERY_KEYS.requestId, requestId);
  }
  if (payload.trace) {
    params.set(USAGE_LOGS_JUMP_QUERY_KEYS.trace, '1');
  }

  return params.toString();
};

export const readUsageLogsJump = (searchParams: URLSearchParams): ParsedUsageLogsJump => {
  const searchText =
    normalizeTrimmedString(searchParams.get(USAGE_LOGS_JUMP_QUERY_KEYS.searchText)) ?? '';
  const method = normalizeTrimmedString(searchParams.get(USAGE_LOGS_JUMP_QUERY_KEYS.method));
  const path = normalizeTrimmedString(searchParams.get(USAGE_LOGS_JUMP_QUERY_KEYS.path));
  const timestamp = normalizeTrimmedString(searchParams.get(USAGE_LOGS_JUMP_QUERY_KEYS.timestamp));
  const model = normalizeTrimmedString(searchParams.get(USAGE_LOGS_JUMP_QUERY_KEYS.model));
  const requestId = normalizeTrimmedString(searchParams.get(USAGE_LOGS_JUMP_QUERY_KEYS.requestId));
  const statusCodeRaw = normalizeTrimmedString(searchParams.get(USAGE_LOGS_JUMP_QUERY_KEYS.statusCode));
  const parsedStatusCode = statusCodeRaw ? Number.parseInt(statusCodeRaw, 10) : Number.NaN;
  const statusCode = Number.isFinite(parsedStatusCode) ? parsedStatusCode : null;
  const trace = searchParams.get(USAGE_LOGS_JUMP_QUERY_KEYS.trace) === '1';
  const hasPayload = Boolean(
    searchText || method || path || timestamp || model || requestId || statusCode !== null || trace
  );

  return {
    searchText,
    method,
    path,
    statusCode,
    timestamp,
    model,
    requestId,
    trace,
    hasPayload,
    signature: JSON.stringify({
      searchText,
      method,
      path,
      statusCode,
      timestamp,
      model,
      requestId,
      trace
    })
  };
};
