import { describe, expect, it } from "vitest";
import { shareErrorMessage } from "@/features/share/share-error";
import { ApiError } from "@/lib/api-client";

describe("share error copy", () => {
  it("tells an expired-link visitor to ask for a new link", () => {
    expect(shareErrorMessage(new ApiError("gone", "SHARE_EXPIRED", 410))).toBe("分享链接已过期，请让分享者重新生成");
  });

  it("distinguishes a missing link from an expired one", () => {
    expect(shareErrorMessage(new ApiError("missing", "SHARE_NOT_FOUND", 404))).toBe("分享链接不存在，请检查地址是否完整");
    expect(shareErrorMessage(new ApiError("bad token", "INVALID_INPUT", 400))).toBe("分享链接格式不正确");
  });

  it("falls back to the generic copy for network and unknown errors", () => {
    expect(shareErrorMessage(new ApiError("网络异常，请重试"))).toBe("分享链接不可用，请稍后重试");
    expect(shareErrorMessage(new ApiError("boom", "SOMETHING_ELSE", 500))).toBe("分享链接不可用，请稍后重试");
    expect(shareErrorMessage(undefined)).toBe("分享链接不可用，请稍后重试");
  });
});
