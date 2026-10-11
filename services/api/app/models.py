from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class ConvertOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pages: str = Field(default="", max_length=2000)
    angle: Literal[90, 180, 270] = 90
    dpi: Literal[96, 144, 192] = 144
    password: str = Field(default="", max_length=128)
    new_password: str = Field(default="", max_length=128)
    text: str = Field(default="", max_length=120)
    start: int = Field(default=1, ge=1, le=100000)
    format: Literal["png", "jpg", "webp"] = "webp"
    quality: int = Field(default=85, ge=30, le=100)
    width: int = Field(default=1920, ge=16, le=8000)
    height: int = Field(default=1080, ge=16, le=8000)
    page_size: Literal["original", "a4"] = "original"
    language: Literal["eng", "rus", "eng+rus"] = "eng+rus"


class ConversionError(Exception):
    """A safe, user-facing conversion failure; never include file contents or secrets."""
