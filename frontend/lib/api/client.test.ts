// @vitest-environment node
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import {
  API_BASE_URL,
  ApiError,
  createProject,
  listProjects,
  getState,
  listQuestionFiles,
  listArtifacts,
  readArtifact,
  getPending,
  getHistory,
  uploadFile,
  getProject,
  listApprovalGates,
  getTurn,
} from "./client";

describe("Content-Type header behavior", () => {
  it("omits Content-Type on bodyless GET but sets it on POST", async () => {
    let getCT: string | null = "unset";
    let postCT: string | null = "unset";
    server.use(
      http.get(`${API_BASE_URL}/projects/p1/state`, ({ request }) => {
        getCT = request.headers.get("content-type");
        return HttpResponse.json({ project_type: null, current_stage: null, stages: [] });
      }),
      http.post(`${API_BASE_URL}/projects`, ({ request }) => {
        postCT = request.headers.get("content-type");
        return HttpResponse.json({ project_id: "p1", name: null });
      }),
    );
    await getState("p1");
    await createProject("p1");
    expect(getCT).toBeNull();
    expect(postCT).toContain("application/json");
  });
});

describe("api client request shaping + response typing", () => {
  it("createProject POSTs {project_id,name} and returns the summary", async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/projects`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({ project_id: "p1", name: "기획전 AI 어시스턴트" });
      }),
    );
    const r = await createProject("p1", "기획전 AI 어시스턴트");
    expect(seenBody).toEqual({ project_id: "p1", name: "기획전 AI 어시스턴트" });
    expect(r).toEqual({ project_id: "p1", name: "기획전 AI 어시스턴트" });
  });

  it("createProject omits name when not given", async () => {
    let seenBody: any;
    server.use(
      http.post(`${API_BASE_URL}/projects`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({ project_id: "p2", name: null });
      }),
    );
    await createProject("p2");
    expect(seenBody).toEqual({ project_id: "p2" });
  });

  it("createProject maps 409 to ApiError(409)", async () => {
    server.use(
      http.post(`${API_BASE_URL}/projects`, () =>
        HttpResponse.json({ detail: "project exists" }, { status: 409 }),
      ),
    );
    await expect(createProject("dup")).rejects.toMatchObject({ status: 409, detail: "project exists" });
    await expect(createProject("dup")).rejects.toBeInstanceOf(ApiError);
  });

  it("listProjects requests ?page&size and returns the full page", async () => {
    let seenUrl: string | undefined;
    server.use(
      http.get(`${API_BASE_URL}/projects`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({
          projects: [{ project_id: "a", name: "A" }, { project_id: "b", name: null }],
          total: 2,
          page: 2,
          size: 5,
        });
      }),
    );
    const r = await listProjects(2, 5);
    expect(seenUrl).toBe(`${API_BASE_URL}/projects?page=2&size=5`);
    expect(r).toEqual({
      projects: [{ project_id: "a", name: "A" }, { project_id: "b", name: null }],
      total: 2,
      page: 2,
      size: 5,
    });
  });

  it("getState returns ProjectState", async () => {
    server.use(
      http.get(`${API_BASE_URL}/projects/p1/state`, () =>
        HttpResponse.json({ project_type: "Greenfield", current_stage: "Product Strategy", stages: [] }),
      ),
    );
    expect((await getState("p1")).project_type).toBe("Greenfield");
  });

  it("listApprovalGates unwraps the gates", async () => {
    const gate = {
      path: "aiplc-docs/discovery/envision/envision-approval-questions.md",
      gate: "aiplc-docs/discovery/envision/envision-approval-questions.md",
      stage: "envision", round: 1, status: "answered",
      answers: [{ number: 1, question: "승인하십니까?", answer: "A. 승인한다" }],
      headline: "A. 승인한다", answered_at: "2026-11-18T04:36:58+00:00",
    };
    server.use(
      http.get(`${API_BASE_URL}/projects/p1/approval-gates`, () => HttpResponse.json({ gates: [gate] })),
    );
    expect(await listApprovalGates("p1")).toEqual([gate]);
  });

  it("getTurn unwraps the current turn (or null)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/projects/p1/turn`, () =>
        HttpResponse.json({ turn: { turn_id: "t1", kind: "message",
                                    state: "running", last_seq: 3 } })),
      http.get(`${API_BASE_URL}/projects/p2/turn`, () =>
        HttpResponse.json({ turn: null })),
    );
    expect(await getTurn("p1")).toEqual(
      { turn_id: "t1", kind: "message", state: "running", last_seq: 3 });
    expect(await getTurn("p2")).toBeNull();
  });

  it("listQuestionFiles / listArtifacts unwrap their arrays", async () => {
    server.use(
      http.get(`${API_BASE_URL}/projects/p1/questions`, () =>
        HttpResponse.json({ questions: ["aiplc-docs/a-questions.md"] }),
      ),
      http.get(`${API_BASE_URL}/projects/p1/artifacts`, () =>
        HttpResponse.json({ artifacts: ["aiplc-docs/audit.md"] }),
      ),
    );
    expect(await listQuestionFiles("p1")).toEqual(["aiplc-docs/a-questions.md"]);
    expect(await listArtifacts("p1")).toEqual(["aiplc-docs/audit.md"]);
  });

  it("readArtifact encodes a slash-bearing path but keeps separators and unwraps {content}", async () => {
    const path = "aiplc-docs/discovery/discovery-document.md";
    server.use(
      http.get(`${API_BASE_URL}/projects/p1/files/${path}`, () =>
        HttpResponse.json({ content: "# Doc" }),
      ),
    );
    expect(await readArtifact("p1", path)).toBe("# Doc");
  });

  it("readArtifact maps 403 to ApiError(403)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/projects/p1/files/uploads/x.md`, () =>
        HttpResponse.json({ detail: "artifacts only" }, { status: 403 }),
      ),
    );
    await expect(readArtifact("p1", "uploads/x.md")).rejects.toMatchObject({ status: 403 });
  });

  it("getPending unwraps {pending} to the raw JSON string (or null)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/projects/p1/pending`, () =>
        HttpResponse.json({ pending: '{"interrupt_id":"i-1","questions":{}}' }),
      ),
    );
    expect(await getPending("p1")).toBe('{"interrupt_id":"i-1","questions":{}}');

    server.use(
      http.get(`${API_BASE_URL}/projects/p2/pending`, () => HttpResponse.json({ pending: null })),
    );
    expect(await getPending("p2")).toBeNull();
  });

  it("getHistory GETs /history and returns items", async () => {
    server.use(
      http.get(`${API_BASE_URL}/projects/p1/history`, () =>
        HttpResponse.json({ items: [{ role: "user", text: "hi", card: null, name: null }] }),
      ),
    );
    expect(await getHistory("p1")).toEqual([{ role: "user", text: "hi", card: null, name: null }]);
  });

  it("uploadFile POSTs multipart and returns the stored path", async () => {
    let form: FormData | undefined;
    server.use(
      http.post(`${API_BASE_URL}/projects/p1/uploads`, async ({ request }) => {
        form = await request.formData();
        return HttpResponse.json({ path: "uploads/a.md", chars: 3, truncated: false });
      }),
    );
    const r = await uploadFile("p1", new File(["abc"], "a.md", { type: "text/markdown" }));
    expect((form!.get("file") as File).name).toBe("a.md");
    expect(r.path).toBe("uploads/a.md");
  });

  it("uploadFile maps a non-OK response to ApiError", async () => {
    server.use(
      http.post(`${API_BASE_URL}/projects/p1/uploads`, () =>
        HttpResponse.text("file too large", { status: 413 }),
      ),
    );
    await expect(uploadFile("p1", new File(["abc"], "a.md"))).rejects.toMatchObject({ status: 413 });
  });

  it("createProject sends model_id when given", async () => {
    let body: any;
    server.use(http.post(`${API_BASE_URL}/projects`, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ project_id: "p1", name: null, model_id: body.model_id });
    }));
    await createProject("p1", undefined, "global.anthropic.claude-opus-5");
    expect(body).toEqual({ project_id: "p1",
                           model_id: "global.anthropic.claude-opus-5" });
  });

  it("createProject omits model_id when not given", async () => {
    let body: any;
    server.use(http.post(`${API_BASE_URL}/projects`, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ project_id: "p1", name: null, model_id: null });
    }));
    await createProject("p1");
    expect(body).toEqual({ project_id: "p1" });
  });

  it("getProject returns the project's metadata", async () => {
    server.use(http.get(`${API_BASE_URL}/projects/p1`, () =>
      HttpResponse.json({ project_id: "p1", name: "이름", created_at: null,
                          model_id: "global.anthropic.claude-opus-5" })));
    expect(await getProject("p1")).toEqual({
      project_id: "p1", name: "이름", created_at: null,
      model_id: "global.anthropic.claude-opus-5",
    });
  });
});
