// verification/verifiers/artifact.ts —— ArtifactVerifier：核实产物文件真实存在且内容合规（Phase 1）。
//
// ── 判定口径（fail-closed）────────────────────────────────────────────────
// 每条产物声明（路径 + 可选 contains 子串断言）独立成一条检查：
//   · 路径存在（stat 成功）且 contains 命中          → passed；
//   · 路径不存在（ENOENT）                           → failed（确定性的坏消息）；
//   · 其余 fs 错误（EACCES / EISDIR / 权限、读失败） → skipped：**读不动 ≠ 不存在**，
//     把「无法验证」折算成任何一态都是撒谎——必查时聚合成 inconclusive。
// contains 断言只在文件真的被读到之后才有发言权：读不出来就不判 contains，
// 永不出现「读失败但算通过」的路径。
//
// ── 真实文件系统、离线可用 ────────────────────────────────────────────────
// 与 guardrails/audit.ts 同款取舍：直接用 node:fs/promises，测试用临时目录
// 夹具（同 evals.spec.ts 的 mkdtemp 纪律）——本地文件操作不触网，零依赖可离线。

import { readFile, stat } from "node:fs/promises";
import type { Verifier, VerifierCheck } from "../types.js";

/** 产物声明：要求存在的路径 + 可选的「内容必须包含该子串」断言 */
export interface ArtifactExpectation {
  path: string;
  contains?: string;
}

export interface ArtifactVerifierOptions {
  artifacts: readonly ArtifactExpectation[];
  id?: string;
  version?: string;
  required?: boolean;
}

export const ARTIFACT_VERIFIER_ID = "artifact";

/** 从 unknown 错误里安全取出 Node fs 的 errno 文本（如 "ENOENT"），取不到返回 undefined */
function errnoOf(err: unknown): string | undefined {
  if (err instanceof Error && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

export function createArtifactVerifier(options: ArtifactVerifierOptions): Verifier {
  const { artifacts, required } = options;
  const id = options.id ?? ARTIFACT_VERIFIER_ID;
  const version = options.version ?? "1";
  return {
    id,
    version,
    required,
    // 证据面是文件系统本身，不消费 context（参数少于接口签名即可满足 Verifier 契约）
    async verify(): Promise<readonly VerifierCheck[]> {
      if (artifacts.length === 0) {
        return [
          {
            id: `${id}:no-artifacts`,
            status: "skipped",
            message: "未配置任何产物校验项（artifacts 为空），无产物可核",
          },
        ];
      }
      const checks: VerifierCheck[] = [];
      for (const artifact of artifacts) {
        checks.push(await verifyOne(id, artifact));
      }
      return checks;
    },
  };
}

async function verifyOne(id: string, artifact: ArtifactExpectation): Promise<VerifierCheck> {
  const checkId = `${id}:${artifact.path}`;
  let info;
  try {
    info = await stat(artifact.path);
  } catch (err) {
    if (errnoOf(err) === "ENOENT") {
      // 确定性结论：文件不存在 → failed（产物缺失是可判定的验收失败）
      return {
        id: checkId,
        status: "failed",
        message: `产物不存在：${artifact.path}`,
        evidence: { path: artifact.path, errno: "ENOENT" },
      };
    }
    // 其余 fs 错误：无法判定 → skipped（fail-closed，绝不折算成通过）
    return {
      id: checkId,
      status: "skipped",
      message: `产物校验无法执行（${artifact.path}）：${err instanceof Error ? err.message : String(err)}`,
      evidence: { path: artifact.path, errno: errnoOf(err) },
    };
  }
  if (artifact.contains === undefined) {
    return {
      id: checkId,
      status: "passed",
      message: `产物存在：${artifact.path}${info.isDirectory() ? "（目录）" : ""}`,
      evidence: { path: artifact.path },
    };
  }
  let content: string;
  try {
    content = await readFile(artifact.path, "utf8");
  } catch (err) {
    // 存在但读不动（目录 / 权限）：contains 断言无从执行 → skipped，不判通过
    return {
      id: checkId,
      status: "skipped",
      message: `产物存在但内容不可读（${artifact.path}），contains 断言无法执行：${err instanceof Error ? err.message : String(err)}`,
      evidence: { path: artifact.path, errno: errnoOf(err) },
    };
  }
  if (content.includes(artifact.contains)) {
    return {
      id: checkId,
      status: "passed",
      message: `产物 ${artifact.path} 包含期望内容（${artifact.contains.length} 字符）`,
      evidence: { path: artifact.path, contains: artifact.contains },
    };
  }
  return {
    id: checkId,
    status: "failed",
    message: `产物 ${artifact.path} 不包含期望子串：「${artifact.contains}」`,
    evidence: { path: artifact.path, contains: artifact.contains, contentLength: content.length },
  };
}
