# backend/aipds/auth/models.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

# Three roles, and their source is Cognito group membership (cognito:groups). role is not
# kept as a custom attribute — having the truth in two places makes them drift.
#
#   admin   every project + user management
#   pm      projects they own (writes) and projects they are a member of (reads)
#   viewer  reads every project, writes nothing — the shared account workshop participants use to
#           follow along while one person types (project_access.access_of, auth/deps.require_writer)
Role = Literal["admin", "pm", "viewer"]

ROLE_ADMIN: Role = "admin"
ROLE_PM: Role = "pm"
ROLE_VIEWER: Role = "viewer"


@dataclass(frozen=True)
class Principal:
    """A requester that passed verification.

    The absence of email is intentional: Cognito **access** tokens have no email claim
    (the default payload is sub/username/cognito:groups/client_id/token_use/scope).
    The email shown on screen is read by the frontend from the id token.
    """
    username: str
    sub: str
    role: Role
    #: The token's `iat` (epoch seconds). Identifies tokens from sessions an admin cut off (auth/revocation.py).
    #: None for requesters that did not come from a token (local development).
    issued_at: float | None = None
