# backend/aipds/routes/uploads.py
import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request, UploadFile
from aipds.routes.deps import ensure_workspace
from aipds.parsers.uploads import prepare, MAX_UPLOAD_BYTES

router = APIRouter()
_log = logging.getLogger(__name__)
_TOO_BIG = f"file exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit"

@router.post("/projects/{pid}/uploads")
async def upload_file(pid: str, file: UploadFile, request: Request):
    ws = await ensure_workspace(pid)
    # Cheap pre-check: reject oversized uploads before reading the body.
    # Content-Length is client-controlled (not a security boundary — the
    # post-read check below remains authoritative) but stops honest large
    # uploads from spooling to disk first.
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_UPLOAD_BYTES + 10_000:  # multipart overhead margin
        raise HTTPException(status_code=413, detail=_TOO_BIG)
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=_TOO_BIG)
    # Document parsing (up to 10MB) uses CPU — running it on the loop would stall every SSE stream
    # in the meantime.
    try:
        upload = await asyncio.to_thread(prepare, file.filename or "", data)
    except ValueError as e:
        raise HTTPException(status_code=415, detail=str(e))
    duplicate = await _same_upload(ws.runner, upload)
    if duplicate is not None:
        return duplicate
    # No list-then-name step: the keys carry a fresh uuid, so there is no
    # window for two concurrent uploads to agree on one key. A False write is
    # impossible in practice for the same reason -- surfaced as a retryable
    # conflict rather than a silent overwrite.
    if upload.original_key is not None and not await ws.runner.write_bytes_if_absent(
            upload.original_key, upload.original):
        raise HTTPException(status_code=409, detail="upload key already exists")
    if upload.text_key is not None and not await ws.runner.write_file_if_absent(
            upload.text_key, upload.text):
        raise HTTPException(status_code=409, detail="upload key already exists")
    # `path` is the file the agent should read first, and `original` is the original kept
    # alongside the converted copy (PDF — read when charts or scanned pages are needed). If
    # there is only the original, it is the `path`.
    return {
        "path": upload.text_key or upload.original_key,
        "original": upload.original_key if upload.text_key else None,
        "chars": len(upload.text or ""),
        "truncated": upload.truncated,
        "duplicate": False,
    }


async def _same_upload(runner, upload) -> dict | None:
    """The earlier upload this one repeats, as the response the route would return. None if new.

    **Why.** A document attached twice landed in two uuid folders, so the agent was
    pointed at two copies of one document. A
    repeat is recognised only when **both the name and the converted text match** -- a file
    re-uploaded under the same name with new content is a new version and is stored as
    usual, so nothing is ever overwritten (the uuid folders keep that guarantee).

    Only uploads with a converted text copy are compared. An original-only upload (an
    image, a scanned PDF) would need a byte read the runner does not offer, and those are
    rarely re-sent as context; they keep the plain path.
    """
    if upload.text_key is None:
        return None
    name = upload.text_key.rsplit("/", 1)[-1]
    try:
        candidates = await runner.list_files(f"uploads/*/{name}")
    except Exception:
        _log.exception("duplicate-upload lookup failed for %s", name)
        return None
    for key in candidates:
        if key.count("/") != 2:
            continue
        try:
            if await runner.read_file(key) != upload.text:
                continue
        except Exception:
            continue
        original = None
        if upload.original_key is not None:
            folder = key.rsplit("/", 1)[0]
            sibling = f"{folder}/{upload.original_key.rsplit('/', 1)[-1]}"
            if sibling in await runner.list_files(f"{folder}/*"):
                original = sibling
        return {"path": key, "original": original, "chars": len(upload.text or ""),
                "truncated": upload.truncated, "duplicate": True}
    return None
