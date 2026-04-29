import type { AuthFileItem } from '@/types/authFile';

export const getAuthFileIndexValue = (file: AuthFileItem): unknown =>
  file['auth-index'] ?? file['auth_index'] ?? file.authIndex;
