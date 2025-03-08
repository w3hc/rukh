export interface SiweMessageResponse {
  message: string;
  nonce: string;
}

export interface SiweVerifyResponse {
  success: boolean;
  address?: string;
  error?: string;
}
