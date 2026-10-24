import { ApiError } from "@/lib/api-client";

const SHARE_ERROR_COPY: Record<string, string> = {
  SHARE_EXPIRED: "分享链接已过期，请让分享者重新生成",
  SHARE_NOT_FOUND: "分享链接不存在，请检查地址是否完整",
  INVALID_INPUT: "分享链接格式不正确",
};

/** Read-only visitors get an actionable message per share failure code. */
export function shareErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code) {
    const copy = SHARE_ERROR_COPY[error.code];
    if (copy) return copy;
  }
  return "分享链接不可用，请稍后重试";
}
