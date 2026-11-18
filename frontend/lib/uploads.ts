// frontend/lib/uploads.ts — rules for attachment uploads (accepted formats, size) and failure reasons.
//
// The backend (ALLOWED and MAX_UPLOAD_BYTES in backend/aipds/parsers/uploads.py) is the
// source of truth for the accepted extensions and the size cap. A second copy lives here to
// filter **before** uploading — so the user does not hear "unsupported format" only after sending
// all 10MB. backend/tests/test_uploads_parser.py checks that the two match.
import { ApiError } from "@/lib/api/client";
import type { Dict } from "@/lib/i18n";

/** Accepted extensions grouped for display to the user. The attachment modal's hint draws them in this order. */
export const UPLOAD_GROUPS = [
  { label: "upload.groupDocs",
    extensions: [".md", ".txt", ".csv", ".xlsx", ".docx", ".pptx", ".hwpx", ".pdf"] },
  { label: "upload.groupWeb", extensions: [".html", ".htm"] },
  { label: "upload.groupTranscripts", extensions: [".vtt", ".srt"] },
  { label: "upload.groupImages", extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp"] },
] as const satisfies readonly { label: keyof Dict; extensions: readonly string[] }[];

export const UPLOAD_EXTENSIONS: readonly string[] = UPLOAD_GROUPS.flatMap((g) => g.extensions);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Not accepted, but fixed by re-saving in a newer format — that hint is shown separately. */
const LEGACY_EXTENSIONS = [".doc", ".ppt", ".xls", ".hwp"];

/** The `<input type="file" accept>` value. */
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.join(",");

export type UploadProblem = "legacy" | "type" | "size" | "expanded" | "damaged" | "failed";

/** Message keys. The backend does not know the UI language, so reasons are turned into codes and picked here. */
export const UPLOAD_PROBLEM_KEY: Record<UploadProblem, keyof Dict> = {
  legacy: "upload.problemLegacy",
  type: "upload.problemType",
  size: "upload.problemSize",
  expanded: "upload.problemExpanded",
  damaged: "upload.problemDamaged",
  failed: "upload.problemFailed",
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/** What one attachment entry point accepts and how its modal explains it. */
export interface UploadRules {
  groups: readonly { label: keyof Dict; extensions: readonly string[] }[];
  extensions: readonly string[];
  maxBytes: number;
  accept: string;
  introKey: keyof Dict;
  howReadKey: keyof Dict;
  limitKey: keyof Dict;
  noticeKey: keyof Dict;
}

export const WORKSPACE_UPLOAD_RULES: UploadRules = {
  groups: UPLOAD_GROUPS,
  extensions: UPLOAD_EXTENSIONS,
  maxBytes: MAX_UPLOAD_BYTES,
  accept: UPLOAD_ACCEPT,
  introKey: "upload.intro",
  howReadKey: "upload.howRead",
  limitKey: "upload.limit",
  noticeKey: "upload.dataNotice",
};

// Build-chat attachments (backend proto/attachments.py is the source of truth; its tests check
// these two constants). **Images and Markdown only**: what enters the build tree reaches source
// generations, downloads, exports and — once the builder copies it into the prototype — the preview
// shared with survey participants, so real data files are not accepted here at all.
export const BUILD_ATTACH_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".md"] as const;
export const BUILD_ATTACH_MAX_BYTES = 5 * 1024 * 1024;

export const BUILD_ATTACH_RULES: UploadRules = {
  groups: [
    { label: "upload.groupImages", extensions: BUILD_ATTACH_EXTENSIONS.filter((e) => e !== ".md") },
    { label: "upload.groupMarkdown", extensions: [".md"] },
  ],
  extensions: BUILD_ATTACH_EXTENSIONS,
  maxBytes: BUILD_ATTACH_MAX_BYTES,
  accept: BUILD_ATTACH_EXTENSIONS.join(","),
  introKey: "upload.buildIntro",
  howReadKey: "upload.buildHowRead",
  limitKey: "upload.buildLimit",
  noticeKey: "upload.buildNotice",
};

/** A problem detectable before uploading. null if none. */
export function checkUpload(file: File, rules: UploadRules = WORKSPACE_UPLOAD_RULES): UploadProblem | null {
  const ext = extensionOf(file.name);
  if (LEGACY_EXTENSIONS.includes(ext) && rules.extensions === UPLOAD_EXTENSIONS) return "legacy";
  if (!rules.extensions.includes(ext)) return "type";
  if (file.size > rules.maxBytes) return "size";
  return null;
}

/** Upload failure → reason. nginx can also return 413 (with an HTML body) — judge by status only.
 *  The 415 body is the sentence backend/aipds/parsers/uploads.py writes. */
export function problemFromError(err: unknown): UploadProblem {
  if (!(err instanceof ApiError)) return "failed";
  if (err.status === 413) return "size";
  if (err.status === 415) {
    if (err.detail.includes("expands beyond")) return "expanded";
    if (err.detail.includes("unsupported extension")) return "type";
    return "damaged";
  }
  return "failed";
}

/** The sentence for a failure reason. `{mb}` is the cap — the number is not baked into two copies of the text. */
export function uploadProblemText(t: (key: keyof Dict) => string, problem: UploadProblem,
                                  maxBytes: number = MAX_UPLOAD_BYTES): string {
  return t(UPLOAD_PROBLEM_KEY[problem]).replace("{mb}", String(maxBytes / (1024 * 1024)));
}
