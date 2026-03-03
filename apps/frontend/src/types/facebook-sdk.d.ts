// Global type augmentation for the Facebook JavaScript SDK (loaded via CDN)
interface FBLoginOptions {
  config_id?: string;
  response_type?: string;
  override_default_response_type?: boolean;
  scope?: string;
  extras?: Record<string, unknown>;
}

interface FBAuthResponse {
  code: string;
  accessToken: string;
  userID: string;
  expiresIn: number;
}

interface FBLoginStatusResponse {
  status: 'connected' | 'not_authorized' | 'unknown';
  authResponse?: FBAuthResponse;
}

interface Window {
  FB?: {
    init: (params: Record<string, unknown>) => void;
    login: (
      callback: (response: FBLoginStatusResponse) => void,
      options?: FBLoginOptions,
    ) => void;
  };
  fbAsyncInit?: () => void;
}
