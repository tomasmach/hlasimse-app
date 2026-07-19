export interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  date_joined: string;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface ApiErrorBody {
  detail?: string;
  error?: { status?: number; details?: string };
  [field: string]: unknown;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
